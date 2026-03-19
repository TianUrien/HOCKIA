import { execSync } from 'node:child_process'
import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const parseSupabaseStatus = () => {
  const raw = execSync('supabase status', { encoding: 'utf8' })

  const pick = (label) => {
    const match = raw.match(new RegExp(`^\\s*${label}\\s*:\\s*(.+)\\s*$`, 'm'))
    return match?.[1]?.trim() ?? null
  }

  const apiUrl = pick('API URL')
  const anonKey = pick('Publishable key')
  const serviceKey = pick('Secret key')

  if (!apiUrl || !anonKey || !serviceKey) {
    throw new Error('Failed to parse supabase status output (missing API URL / Publishable key / Secret key)')
  }

  return { apiUrl, anonKey, serviceKey }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const nowId = () => {
  const ts = new Date().toISOString().replace(/[-:.TZ]/g, '')
  return `${ts}-${crypto.randomBytes(3).toString('hex')}`
}

const countRows = async (service, table, filter) => {
  let query = service.from(table).select('*', { count: 'exact', head: true })
  if (filter) query = filter(query)
  const { count, error } = await query
  if (error) throw error
  return Number(count ?? 0)
}

const listPrefix = async (service, bucket, prefix) => {
  const normalized = prefix.replace(/^\/+/, '').replace(/\/+$/, '')
  if (!normalized) return []
  const { data, error } = await service.storage.from(bucket).list(normalized, { limit: 100, offset: 0 })
  if (error) {
    // storage api may respond 404 when folder doesn't exist
    const msg = String(error.message ?? '').toLowerCase()
    if (msg.includes('not found') || String(error.statusCode ?? '') === '404') return []
    throw error
  }
  return data ?? []
}

const main = async () => {
  const { apiUrl, anonKey, serviceKey } = parseSupabaseStatus()

  const service = createClient(apiUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const anon = createClient(apiUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })

  const runId = nowId()

  const victimPlayerEmail = `e2e-delete-victim-player-${runId}@example.com`
  const victimClubEmail = `e2e-delete-victim-club-${runId}@example.com`
  const otherEmail = `e2e-delete-other-${runId}@example.com`
  const commonPassword = `HockiaE2E!${crypto.randomBytes(6).toString('hex')}`

  const createdUserIds = []

  const createUserWithProfile = async (email, password, role) => {
    const { data, error } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { role },
    })
    if (error) throw error
    const userId = data?.user?.id
    assert(userId, 'Expected created user id')
    createdUserIds.push(userId)

    const { error: profileError } = await service.rpc('create_profile_for_new_user', {
      user_id: userId,
      user_email: email,
      user_role: role,
    })
    if (profileError) throw profileError

    // Mark onboarding completed to simulate a “real” user.
    const { error: patchError } = await service
      .from('profiles')
      .update({ onboarding_completed: true, full_name: role === 'club' ? 'E2E Club' : 'E2E Player' })
      .eq('id', userId)
    if (patchError) throw patchError

    return userId
  }

  const seedStorage = async (userId, buckets) => {
    let uploaded = 0
    for (const bucket of buckets) {
      const path = `${userId}/delete-account-e2e-${runId}.txt`
      const body = new Blob([`bucket=${bucket}; user=${userId}; run=${runId}`], { type: 'text/plain' })
      const { error } = await service.storage.from(bucket).upload(path, body, { upsert: true })
      if (error) throw error
      uploaded += 1
    }
    return uploaded
  }

  const callDeleteAccount = async ({ email, password }) => {
    const { data: signInData, error: signInError } = await anon.auth.signInWithPassword({ email, password })
    if (signInError) throw signInError
    const token = signInData?.session?.access_token
    assert(token, 'Expected access token')

    const res = await fetch(`${apiUrl}/functions/v1/delete-account`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({}),
    })

    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(`delete-account failed: ${res.status} ${JSON.stringify(json)}`)
    }

    return json
  }

  // ---------------------------------------------------------------------------
  // Scenario 1: Player account with messages/friends/comments/references/media
  // ---------------------------------------------------------------------------
  const victimPlayerId = await createUserWithProfile(victimPlayerEmail, commonPassword, 'player')
  const otherId = await createUserWithProfile(otherEmail, commonPassword, 'player')

  // Friends
  {
    const { error } = await service.from('profile_friendships').insert({
      user_one: victimPlayerId,
      user_two: otherId,
      requester_id: victimPlayerId,
      status: 'accepted',
    })
    if (error) throw error
  }

  // References (required relationship_type)
  {
    const { error } = await service.from('profile_references').insert({
      requester_id: victimPlayerId,
      reference_id: otherId,
      status: 'accepted',
      relationship_type: 'Coach',
      endorsement_text: 'Solid teammate and reliable on the pitch.',
    })
    if (error) throw error
  }

  // Comments
  {
    const { error } = await service.from('profile_comments').insert([
      {
        profile_id: victimPlayerId,
        author_profile_id: otherId,
        content: 'Great work ethic and team spirit.',
        rating: 'positive',
      },
      {
        profile_id: otherId,
        author_profile_id: victimPlayerId,
        content: 'Always shows up and communicates well.',
        rating: 'positive',
      },
    ])
    if (error) throw error
  }

  // Conversation + messages
  let conversationId
  {
    const { data: convo, error: convoError } = await service
      .from('conversations')
      .insert({ participant_one_id: victimPlayerId, participant_two_id: otherId })
      .select('id')
      .single()
    if (convoError) throw convoError
    conversationId = convo.id

    const { error: msgError } = await service.from('messages').insert([
      { conversation_id: conversationId, sender_id: victimPlayerId, content: 'Hello from victim', sent_at: new Date().toISOString() },
      { conversation_id: conversationId, sender_id: otherId, content: 'Hello back', sent_at: new Date().toISOString() },
    ])
    if (msgError) throw msgError
  }

  // Media rows + storage objects
  await seedStorage(victimPlayerId, ['avatars', 'gallery', 'journey', 'player-media'])
  {
    const galleryUrl = `${apiUrl}/storage/v1/object/public/gallery/${victimPlayerId}/delete-account-e2e-${runId}.txt`
    const { error } = await service.from('gallery_photos').insert({
      user_id: victimPlayerId,
      photo_url: galleryUrl,
      file_name: 'delete-account-e2e.txt',
      file_size: 10,
      order_index: 0,
    })
    if (error) throw error

    const journeyUrl = `${apiUrl}/storage/v1/object/public/journey/${victimPlayerId}/delete-account-e2e-${runId}.txt`
    const { error: phError } = await service.from('career_history').insert({
      user_id: victimPlayerId,
      club_name: 'E2E Club',
      position_role: 'Midfielder',
      years: '2022-2024',
      division_league: 'Division 1',
      highlights: ['Test highlight'],
      entry_type: 'club',
      image_url: journeyUrl,
      display_order: 0,
    })
    if (phError) throw phError
  }

  // Opportunity inbox state
  {
    const { error } = await service.from('opportunity_inbox_state').upsert({
      user_id: victimPlayerId,
      last_seen_at: '1970-01-01 00:00:00+00',
    })
    if (error) throw error
  }

  // Run delete for victim player
  const deletePlayerResponse = await callDeleteAccount({ email: victimPlayerEmail, password: commonPassword })

  // Give PostgREST/storage a moment to settle
  await sleep(250)

  // Verify: auth deleted
  let playerAuthDeleted = false
  {
    const { data, error } = await service.auth.admin.getUserById(victimPlayerId)
    if (error || !data?.user) playerAuthDeleted = true
  }

  const playerDbCounts = {
    profiles: await countRows(service, 'profiles', (q) => q.eq('id', victimPlayerId)),
    gallery_photos: await countRows(service, 'gallery_photos', (q) => q.eq('user_id', victimPlayerId)),
    career_history: await countRows(service, 'career_history', (q) => q.eq('user_id', victimPlayerId)),
    profile_comments_as_author: await countRows(service, 'profile_comments', (q) => q.eq('author_profile_id', victimPlayerId)),
    profile_comments_on_profile: await countRows(service, 'profile_comments', (q) => q.eq('profile_id', victimPlayerId)),
    profile_friendships: await countRows(service, 'profile_friendships', (q) => q.or(`user_one.eq.${victimPlayerId},user_two.eq.${victimPlayerId}`)),
    profile_references: await countRows(service, 'profile_references', (q) => q.or(`requester_id.eq.${victimPlayerId},reference_id.eq.${victimPlayerId}`)),
    opportunity_inbox_state: await countRows(service, 'opportunity_inbox_state', (q) => q.eq('user_id', victimPlayerId)),
    messages: await countRows(service, 'messages', (q) => q.eq('conversation_id', conversationId)),
    conversations: await countRows(service, 'conversations', (q) => q.eq('id', conversationId)),
    archived_messages: await countRows(service, 'archived_messages', (q) => q.eq('conversation_id', conversationId)),
    unread_counters: await countRows(service, 'user_unread_counters', (q) => q.eq('user_id', victimPlayerId)),
    unread_senders_any: await countRows(service, 'user_unread_senders', (q) => q.or(`user_id.eq.${victimPlayerId},sender_id.eq.${victimPlayerId}`)),
  }

  const playerStorageRemaining = {}
  for (const bucket of ['avatars', 'gallery', 'journey', 'player-media']) {
    playerStorageRemaining[bucket] = (await listPrefix(service, bucket, victimPlayerId)).length
  }

  // ---------------------------------------------------------------------------
  // Scenario 2: Club account with vacancies + applicants + club media
  // ---------------------------------------------------------------------------
  const victimClubId = await createUserWithProfile(victimClubEmail, commonPassword, 'club')
  const applicantEmail = `e2e-delete-applicant-${runId}@example.com`
  const applicantId = await createUserWithProfile(applicantEmail, commonPassword, 'player')

  // club media bucket + row
  await seedStorage(victimClubId, ['club-media'])
  {
    const clubMediaUrl = `${apiUrl}/storage/v1/object/public/club-media/${victimClubId}/delete-account-e2e-${runId}.txt`
    const { error } = await service.from('club_media').insert({
      club_id: victimClubId,
      file_url: clubMediaUrl,
      file_name: 'delete-account-e2e.txt',
      file_size: 10,
      order_index: 0,
      is_featured: false,
    })
    if (error) throw error
  }

  // vacancy + application
  let vacancyId
  {
    const { data, error } = await service
      .from('opportunities')
      .insert({
        club_id: victimClubId,
        title: 'E2E Vacancy',
        location_city: 'Sydney',
        location_country: 'Australia',
        status: 'open',
        opportunity_type: 'player',
      })
      .select('id')
      .single()
    if (error) throw error
    vacancyId = data.id

    const { error: appError } = await service.from('opportunity_applications').insert({
      opportunity_id: vacancyId,
      applicant_id: applicantId,
      cover_letter: 'Excited to apply.',
      status: 'pending',
    })
    if (appError) throw appError
  }

  const deleteClubResponse = await callDeleteAccount({ email: victimClubEmail, password: commonPassword })
  await sleep(250)

  let clubAuthDeleted = false
  {
    const { data, error } = await service.auth.admin.getUserById(victimClubId)
    if (error || !data?.user) clubAuthDeleted = true
  }

  const clubDbCounts = {
    profiles: await countRows(service, 'profiles', (q) => q.eq('id', victimClubId)),
    opportunities: await countRows(service, 'opportunities', (q) => q.eq('club_id', victimClubId)),
    opportunity_applications: await countRows(service, 'opportunity_applications', (q) => q.eq('opportunity_id', vacancyId)),
    club_media: await countRows(service, 'club_media', (q) => q.eq('club_id', victimClubId)),
  }

  const clubStorageRemaining = {
    'club-media': (await listPrefix(service, 'club-media', victimClubId)).length,
  }

  // Cleanup remaining non-deleted users created by this test
  for (const uid of [otherId, applicantId]) {
    await service.auth.admin.deleteUser(uid)
  }

  const report = {
    runId,
    apiUrl,
    deletePlayerResponse,
    player: {
      victimPlayerId,
      authDeleted: playerAuthDeleted,
      dbCounts: playerDbCounts,
      storageRemaining: playerStorageRemaining,
      otherUserStillExists: (await service.auth.admin.getUserById(otherId)).data?.user?.id === otherId,
    },
    deleteClubResponse,
    club: {
      victimClubId,
      authDeleted: clubAuthDeleted,
      dbCounts: clubDbCounts,
      storageRemaining: clubStorageRemaining,
    },
  }

  // Print JSON only (keeps logs clean).
  process.stdout.write(JSON.stringify(report, null, 2))
}

main().catch((error) => {
  console.error('[delete_account_e2e] failed:', error)
  process.exit(1)
})
