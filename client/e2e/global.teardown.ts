import { createClient } from '@supabase/supabase-js'

/**
 * Hard-deletes the messages the smoke / messaging specs send as the E2E
 * accounts (walkthrough finding #3): they used to pile up as "E2E smoke
 * message" + "Message deleted" pairs in the test player's conversations.
 *
 * Runs with the SERVICE ROLE (E2E_SERVICE_ROLE_KEY — a CI secret, never a
 * client permission: messages are soft-deleted on purpose so moderation keeps
 * the record). Scoped to the E2E accounts' own rows by sender. Skipped
 * silently when the key is not in the environment.
 */
const PATTERNS = ['E2E smoke message %', 'E2E messaging test %', 'Mobile E2E %', 'E2E edit/delete %', 'Trigger test __dbtest_%', 'Enter key test %', 'QA test msg %']

export default async function globalTeardown() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const serviceKey = process.env.E2E_SERVICE_ROLE_KEY
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  const emails = ['E2E_PLAYER_EMAIL', 'E2E_CLUB_EMAIL', 'E2E_COACH_EMAIL', 'E2E_BRAND_EMAIL', 'E2E_UMPIRE_EMAIL'].map((k) => process.env[k]).filter((v): v is string => Boolean(v))
  if (!url || !serviceKey || !anonKey || emails.length === 0) {
    console.log('[e2e teardown] skipped — E2E_SERVICE_ROLE_KEY not set')
    return
  }
  try {
    // Resolve the E2E account ids from their credentials (anon sign-in), then
    // delete with the service role — only rows those accounts sent.
    const anon = createClient(url, anonKey, { auth: { persistSession: false } })
    const senderIds: string[] = []
    for (const email of emails) {
      const password = process.env[`${email === process.env.E2E_PLAYER_EMAIL ? 'E2E_PLAYER' : email === process.env.E2E_CLUB_EMAIL ? 'E2E_CLUB' : email === process.env.E2E_COACH_EMAIL ? 'E2E_COACH' : email === process.env.E2E_BRAND_EMAIL ? 'E2E_BRAND' : 'E2E_UMPIRE'}_PASSWORD`]
      if (!password) continue
      const { data } = await anon.auth.signInWithPassword({ email, password })
      if (data.user) senderIds.push(data.user.id)
      await anon.auth.signOut().catch(() => undefined)
    }
    if (senderIds.length === 0) return
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
    let removed = 0
    for (const pattern of PATTERNS) {
      const { data, error } = await admin.from('messages').delete().in('sender_id', senderIds).like('content', pattern).select('id')
      if (error) throw error
      removed += data?.length ?? 0
    }
    const { data: blanks, error: blankErr } = await admin.from('messages').delete().in('sender_id', senderIds).not('deleted_at', 'is', null).select('id')
    if (blankErr) throw blankErr
    removed += blanks?.length ?? 0
    console.log(`[e2e teardown] removed ${removed} test message(s) from ${senderIds.length} E2E account(s)`)
  } catch (err) {
    console.warn('[e2e teardown] cleanup skipped:', err instanceof Error ? err.message : err)
  }
}
