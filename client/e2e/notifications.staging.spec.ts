import { test, expect, Page } from '@playwright/test'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import { NotificationsPage } from './fixtures'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Load env (same priority chain as playwright.config.ts)
if (process.env.E2E_STAGING_MODE === '1') {
  dotenv.config({ path: path.join(__dirname, '..', '.env.staging') })
}
dotenv.config({ path: path.join(__dirname, '..', '.env.local') })
dotenv.config({ path: path.join(__dirname, '..', '.env') })

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''

const PLAYER_STORAGE_STATE = path.join(__dirname, '.auth/player.json')
const CLUB_STORAGE_STATE = path.join(__dirname, '.auth/club.json')
const COACH_STORAGE_STATE = path.join(__dirname, '.auth/coach.json')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create an authenticated Supabase client for DB assertions (RLS-scoped). */
async function getAuthClient(email: string, password: string) {
  const tmp = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await tmp.auth.signInWithPassword({ email, password })
  if (error || !data.session) {
    throw new Error(`Auth failed for ${email}: ${error?.message ?? 'No session'}`)
  }
  return {
    client: createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
    }),
    userId: data.user.id,
  }
}

/** Poll `profile_notifications` until a row matching (kind, source_entity_id) appears. */
async function waitForNotification(
  client: SupabaseClient,
  kind: string,
  sourceEntityId: string,
  timeoutMs = 10_000,
): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const { data } = await client
      .from('profile_notifications')
      .select('id')
      .eq('kind', kind)
      .eq('source_entity_id', sourceEntityId)
      .limit(1)
    if (data && data.length > 0) return true
    await new Promise(r => setTimeout(r, 500))
  }
  return false
}

/** Open the notification drawer, assert text exists, close it. */
async function assertNotificationInDrawer(page: Page, textPattern: string | RegExp) {
  const notif = new NotificationsPage(page)
  await notif.openDrawer()
  await notif.expectNotification(textPattern)
  await notif.closeDrawer()
}

// ============================================================================
// NOTIFICATION SYSTEM E2E — STAGING ONLY
// ============================================================================
// Tests the full notification lifecycle across player, club, and coach roles.
//
// Validates:
//   - DB rows in profile_notifications (synchronous triggers)
//   - UI rendering in the notification drawer
//
// Email delivery is async (webhook → edge function → Resend) and CANNOT be
// verified in Playwright. After running this suite, check:
//   1. Resend dashboard for delivery receipts
//   2. Supabase edge function logs for "Email sent successfully"
//   3. Gmail inboxes of the 4 whitelisted E2E accounts
// ============================================================================

test.describe.serial('Notification System E2E', () => {
  let playerSb: SupabaseClient
  let clubSb: SupabaseClient
  let coachSb: SupabaseClient
  let playerId: string
  let clubId: string
  let coachId: string

  // Fresh entities created during this run
  let freshPlayerVacancyId: string
  let freshCoachVacancyId: string
  let friendshipId: string | null = null

  // ------------------------------------------------------------------
  // Setup: authenticate users + clean stale state
  // ------------------------------------------------------------------
  test.beforeAll(async () => {
    const player = await getAuthClient(
      process.env.E2E_PLAYER_EMAIL!,
      process.env.E2E_PLAYER_PASSWORD!,
    )
    const club = await getAuthClient(
      process.env.E2E_CLUB_EMAIL!,
      process.env.E2E_CLUB_PASSWORD!,
    )
    const coach = await getAuthClient(
      process.env.E2E_COACH_EMAIL!,
      process.env.E2E_COACH_PASSWORD!,
    )

    playerSb = player.client
    clubSb = club.client
    coachSb = coach.client
    playerId = player.userId
    clubId = club.userId
    coachId = coach.userId

    // Clean stale friendship between player and coach (both parties can DELETE)
    await playerSb
      .from('profile_friendships')
      .delete()
      .or(
        `and(user_one.eq.${playerId},user_two.eq.${coachId}),` +
        `and(user_one.eq.${coachId},user_two.eq.${playerId})`,
      )

    // Attempt to revoke any active reference so re-insert is possible.
    // May silently fail if RLS blocks — the test handles the duplicate fallback.
    await playerSb
      .from('profile_references')
      .update({
        status: 'revoked',
        revoked_by: playerId,
        revoked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('requester_id', playerId)
      .eq('reference_id', coachId)
      .in('status', ['pending', 'accepted'])
  })

  // ------------------------------------------------------------------
  // 1. Club publishes player-type vacancy → Player gets notified
  // ------------------------------------------------------------------
  test('vacancy publish → player in-app notification', async ({ browser }) => {
    test.skip(process.env.E2E_STAGING_MODE !== '1', 'Requires E2E_STAGING_MODE=1')
    test.setTimeout(60_000)

    const title = `E2E Notif Player ${Date.now()}`
    const { data: vacancy, error } = await clubSb
      .from('opportunities')
      .insert({
        club_id: clubId,
        title,
        opportunity_type: 'player',
        position: 'midfielder',
        gender: 'Men',
        description: 'E2E notification test — player vacancy',
        location_city: 'London',
        location_country: 'United Kingdom',
        duration_text: '1 season',
        requirements: ['E2E'],
        benefits: ['housing'],
        priority: 'medium',
        status: 'open',
        published_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    expect(error).toBeNull()
    freshPlayerVacancyId = vacancy!.id

    // DB: fan-out trigger creates notification for the player
    const found = await waitForNotification(playerSb, 'opportunity_published', freshPlayerVacancyId)
    expect(found).toBe(true)

    // UI: player sees the notification in the drawer
    const ctx = await browser.newContext({ storageState: PLAYER_STORAGE_STATE })
    const page = await ctx.newPage()
    await page.goto('/opportunities')
    await page.waitForLoadState('networkidle')
    await assertNotificationInDrawer(page, title)
    await ctx.close()
  })

  // ------------------------------------------------------------------
  // 2. Club publishes coach-type vacancy → Coach gets notified
  // ------------------------------------------------------------------
  test('vacancy publish → coach in-app notification', async ({ browser }) => {
    test.skip(process.env.E2E_STAGING_MODE !== '1', 'Requires E2E_STAGING_MODE=1')
    test.setTimeout(60_000)

    const title = `E2E Notif Coach ${Date.now()}`
    const { data: vacancy, error } = await clubSb
      .from('opportunities')
      .insert({
        club_id: clubId,
        title,
        opportunity_type: 'coach',
        position: 'head_coach',
        gender: 'Men',
        description: 'E2E notification test — coach vacancy',
        location_city: 'London',
        location_country: 'United Kingdom',
        duration_text: '1 season',
        requirements: ['E2E'],
        benefits: ['housing'],
        priority: 'medium',
        status: 'open',
        published_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    expect(error).toBeNull()
    freshCoachVacancyId = vacancy!.id

    const found = await waitForNotification(coachSb, 'opportunity_published', freshCoachVacancyId, 20_000)
    expect(found).toBe(true)

    const ctx = await browser.newContext({ storageState: COACH_STORAGE_STATE })
    const page = await ctx.newPage()
    await page.goto('/opportunities')
    await page.waitForLoadState('networkidle')
    await assertNotificationInDrawer(page, title)
    await ctx.close()
  })

  // ------------------------------------------------------------------
  // 3. Player applies to player vacancy → Club gets notified
  // ------------------------------------------------------------------
  test('player application → club in-app notification', async ({ browser }) => {
    test.skip(process.env.E2E_STAGING_MODE !== '1', 'Requires E2E_STAGING_MODE=1')
    test.setTimeout(60_000)

    const { data: application, error } = await playerSb.from('opportunity_applications').insert({
      opportunity_id: freshPlayerVacancyId,
      applicant_id: playerId,
      status: 'pending',
    }).select('id').single()
    expect(error).toBeNull()

    // DB: trigger creates notification for the club (source_entity_id = application ID)
    const found = await waitForNotification(
      clubSb,
      'vacancy_application_received',
      application!.id,
    )
    expect(found).toBe(true)

    // UI: club sees "New applicant" in the drawer
    const ctx = await browser.newContext({ storageState: CLUB_STORAGE_STATE })
    const page = await ctx.newPage()
    await page.goto('/opportunities')
    await page.waitForLoadState('networkidle')
    await assertNotificationInDrawer(page, /new applicant/i)
    await ctx.close()
  })

  // ------------------------------------------------------------------
  // 4. Coach applies to coach vacancy → Club gets notified
  // ------------------------------------------------------------------
  test('coach application → club in-app notification', async () => {
    test.skip(process.env.E2E_STAGING_MODE !== '1', 'Requires E2E_STAGING_MODE=1')
    test.setTimeout(60_000)

    const { data: application, error } = await coachSb.from('opportunity_applications').insert({
      opportunity_id: freshCoachVacancyId,
      applicant_id: coachId,
      status: 'pending',
    }).select('id').single()
    expect(error).toBeNull()

    // DB-only assertion (UI already verified in step 3)
    // source_entity_id = application ID (not opportunity ID)
    const found = await waitForNotification(
      clubSb,
      'vacancy_application_received',
      application!.id,
    )
    expect(found).toBe(true)
  })

  // ------------------------------------------------------------------
  // 5. Player sends friend request to Coach → Coach gets notified
  // ------------------------------------------------------------------
  test('friend request → coach in-app notification', async ({ browser }) => {
    test.skip(process.env.E2E_STAGING_MODE !== '1', 'Requires E2E_STAGING_MODE=1')
    test.setTimeout(60_000)

    const { data: friendship, error } = await playerSb
      .from('profile_friendships')
      .insert({
        user_one: playerId,
        user_two: coachId,
        requester_id: playerId,
        status: 'pending',
      })
      .select('id')
      .single()

    expect(error).toBeNull()
    friendshipId = friendship!.id

    // DB: trigger creates notification for the coach
    const found = await waitForNotification(coachSb, 'friend_request_received', friendshipId!)
    expect(found).toBe(true)

    // UI: coach sees "friend request" in the drawer
    const ctx = await browser.newContext({ storageState: COACH_STORAGE_STATE })
    const page = await ctx.newPage()
    await page.goto('/opportunities')
    await page.waitForLoadState('networkidle')
    await assertNotificationInDrawer(page, /friend request/i)
    await ctx.close()
  })

  // ------------------------------------------------------------------
  // 6. Coach accepts friend request → Player gets notified
  // ------------------------------------------------------------------
  test('friend accept → player in-app notification', async ({ browser }) => {
    test.skip(process.env.E2E_STAGING_MODE !== '1', 'Requires E2E_STAGING_MODE=1')
    test.setTimeout(60_000)

    expect(friendshipId).toBeTruthy()

    const { error } = await coachSb
      .from('profile_friendships')
      .update({ status: 'accepted' })
      .eq('id', friendshipId!)
    expect(error).toBeNull()

    // DB: trigger creates friend_request_accepted for the player
    const found = await waitForNotification(playerSb, 'friend_request_accepted', friendshipId!)
    expect(found).toBe(true)

    // UI: player sees "accepted your friend request"
    const ctx = await browser.newContext({ storageState: PLAYER_STORAGE_STATE })
    const page = await ctx.newPage()
    await page.goto('/opportunities')
    await page.waitForLoadState('networkidle')
    await assertNotificationInDrawer(page, /accepted your friend request/i)
    await ctx.close()
  })

  // ------------------------------------------------------------------
  // 7. Player requests reference from Coach → Coach gets notified
  //    (requires accepted friendship from step 6)
  // ------------------------------------------------------------------
  test('reference request → coach in-app notification', async ({ browser }) => {
    test.skip(process.env.E2E_STAGING_MODE !== '1', 'Requires E2E_STAGING_MODE=1')
    test.setTimeout(60_000)

    const { data: ref, error } = await playerSb
      .from('profile_references')
      .insert({
        requester_id: playerId,
        reference_id: coachId,
        relationship_type: 'Teammate',
        request_note: 'E2E notification test reference request',
        status: 'pending',
      })
      .select('id')
      .single()

    // Handle duplicate from a previous run (unique constraint on active pair)
    if (error?.code === '23505') {
      console.log('[Notification E2E] Reference already exists — verifying existing notification')
      const { data: existing } = await playerSb
        .from('profile_references')
        .select('id')
        .eq('requester_id', playerId)
        .eq('reference_id', coachId)
        .in('status', ['pending', 'accepted'])
        .limit(1)
        .single()

      expect(existing).toBeTruthy()
      // Notification was created on original insert — just verify DB
      const { data: notifs } = await coachSb
        .from('profile_notifications')
        .select('id')
        .eq('kind', 'reference_request_received')
        .eq('source_entity_id', existing!.id)
      expect(notifs!.length).toBeGreaterThanOrEqual(1)
      return
    }

    expect(error).toBeNull()

    const found = await waitForNotification(coachSb, 'reference_request_received', ref!.id)
    expect(found).toBe(true)

    // UI: coach sees "requested a reference"
    const ctx = await browser.newContext({ storageState: COACH_STORAGE_STATE })
    const page = await ctx.newPage()
    await page.goto('/opportunities')
    await page.waitForLoadState('networkidle')
    await assertNotificationInDrawer(page, /requested a reference/i)
    await ctx.close()
  })

  // ------------------------------------------------------------------
  // 8. Player sends message to Club → Club gets notified
  // ------------------------------------------------------------------
  test('message → club in-app notification', async ({ browser }) => {
    test.skip(process.env.E2E_STAGING_MODE !== '1', 'Requires E2E_STAGING_MODE=1')
    test.setTimeout(60_000)

    // Send a message via the Messages UI (as player)
    const playerCtx = await browser.newContext({ storageState: PLAYER_STORAGE_STATE })
    const playerPage = await playerCtx.newPage()
    await playerPage.goto(`/messages?new=${clubId}`)
    await playerPage.waitForLoadState('networkidle')

    const messageText = `E2E notif test msg ${Date.now()}`
    const textarea = playerPage.getByPlaceholder(/type a message/i)
    await textarea.fill(messageText)
    await playerPage.keyboard.press('Enter')

    // Confirm the message appears in the chat
    await expect(
      playerPage.locator('[data-testid="chat-message-list"]').getByText(messageText),
    ).toBeVisible({ timeout: 10_000 })
    await playerCtx.close()

    // Wait for the message trigger to fire
    await new Promise(r => setTimeout(r, 3000))

    // DB: club should have a message or conversation notification
    const { data: notifs } = await clubSb
      .from('profile_notifications')
      .select('id, kind')
      .in('kind', ['message_received', 'conversation_started'])
      .order('created_at', { ascending: false })
      .limit(5)
    expect(notifs!.length).toBeGreaterThanOrEqual(1)

    // UI: club sees the message notification
    const clubCtx = await browser.newContext({ storageState: CLUB_STORAGE_STATE })
    const clubPage = await clubCtx.newPage()
    await clubPage.goto('/opportunities')
    await clubPage.waitForLoadState('networkidle')
    await assertNotificationInDrawer(clubPage, /sent you a message|started a conversation/i)
    await clubCtx.close()
  })

  // ------------------------------------------------------------------
  // Cleanup
  // ------------------------------------------------------------------
  test.afterAll(async () => {
    // Close the fresh vacancies so they don't trigger fan-out on future runs
    if (freshPlayerVacancyId) {
      await clubSb
        .from('opportunities')
        .update({ status: 'closed' })
        .eq('id', freshPlayerVacancyId)
    }
    if (freshCoachVacancyId) {
      await clubSb
        .from('opportunities')
        .update({ status: 'closed' })
        .eq('id', freshCoachVacancyId)
    }
  })
})
