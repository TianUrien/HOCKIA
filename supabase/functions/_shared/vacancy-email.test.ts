/**
 * Founder ruling E (2026-09-26): the new-role email goes out ONLY the first
 * time a role is published. Reopen / renewal / webhook re-delivery never
 * re-send.
 *
 * Pinned here:
 *   1. isVacancyNewlyPublished still recognises the draft->open first publish
 *      (and INSERT-as-open), so a legit first publish reaches the claim.
 *   2. claimFirstAnnouncement maps the DB claim to send / skip, and fails
 *      CLOSED on every error shape.
 *   3. notify-vacancy actually claims BEFORE fetching recipients or sending,
 *      and no longer relies on a short email_sends time window (the 10-minute
 *      guard that let a club re-mail everyone every ~11 minutes).
 */

import { assert, assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import {
  type AnnouncementRpcClient,
  type VacancyPayload,
  type VacancyRecord,
  ANNOUNCEMENT_FAILED_MESSAGE,
  announcementSendOutcome,
  claimFirstAnnouncement,
  isVacancyNewlyPublished,
  reportAnnouncementFailure,
} from './vacancy-email.ts'

const rec = (status: string): VacancyRecord => ({
  id: '00000000-0000-0000-0000-000000000001',
  club_id: '00000000-0000-0000-0000-000000000002',
  title: 'Goalkeeper',
  position: 'goalkeeper',
  location_city: 'Amsterdam',
  location_country: 'Netherlands',
  description: null,
  status,
  opportunity_type: 'player',
})

const payload = (
  type: 'INSERT' | 'UPDATE',
  status: string,
  oldStatus?: string,
): VacancyPayload => ({
  type,
  table: 'opportunities',
  schema: 'public',
  record: rec(status),
  old_record: oldStatus === undefined ? null : rec(oldStatus),
})

// ── 1. transition detection ─────────────────────────────────────────────────

Deno.test('draft -> open is a publish transition (first publish must still email)', () => {
  assertEquals(isVacancyNewlyPublished(payload('UPDATE', 'open', 'draft')), true)
})

Deno.test('INSERT as open is a publish transition', () => {
  assertEquals(isVacancyNewlyPublished(payload('INSERT', 'open')), true)
})

Deno.test('closed -> open is a transition too — the claim, not this, blocks the re-send', () => {
  assertEquals(isVacancyNewlyPublished(payload('UPDATE', 'open', 'closed')), true)
})

Deno.test('open -> open edit and non-open states are not transitions', () => {
  assertEquals(isVacancyNewlyPublished(payload('UPDATE', 'open', 'open')), false)
  assertEquals(isVacancyNewlyPublished(payload('UPDATE', 'closed', 'open')), false)
  assertEquals(isVacancyNewlyPublished(payload('INSERT', 'draft')), false)
})

// ── 2. claim mapping ────────────────────────────────────────────────────────

function client(
  result: { data: unknown; error: { message: string } | null } | Error,
  calls: unknown[] = [],
): AnnouncementRpcClient {
  return {
    rpc(fn, args) {
      calls.push({ fn, args })
      if (result instanceof Error) return Promise.reject(result)
      return Promise.resolve(result as { data: boolean | null; error: { message: string } | null })
    },
  }
}

Deno.test('first publish: DB claim true -> claimed, with the right RPC + id', async () => {
  const calls: unknown[] = []
  const r = await claimFirstAnnouncement(client({ data: true, error: null }, calls), 'opp-1')
  assertEquals(r, { outcome: 'claimed' })
  assertEquals(calls, [
    { fn: 'claim_opportunity_announcement_email', args: { p_opportunity_id: 'opp-1' } },
  ])
})

Deno.test('reopen / renewal / duplicate delivery: DB claim false -> already_announced', async () => {
  const r = await claimFirstAnnouncement(client({ data: false, error: null }), 'opp-1')
  assertEquals(r, { outcome: 'already_announced' })
})

Deno.test('RPC error fails closed', async () => {
  const r = await claimFirstAnnouncement(client({ data: null, error: { message: 'boom' } }), 'x')
  assertEquals(r, { outcome: 'error', message: 'boom' })
})

Deno.test('thrown error fails closed', async () => {
  const r = await claimFirstAnnouncement(client(new Error('network')), 'x')
  assertEquals(r, { outcome: 'error', message: 'network' })
})

Deno.test('null / non-boolean data fails closed', async () => {
  for (const data of [null, 'true', 1, {}]) {
    const r = await claimFirstAnnouncement(client({ data, error: null }), 'x')
    assertEquals(r.outcome, 'error')
  }
})

// ── 3. structural guard on notify-vacancy ───────────────────────────────────

Deno.test('notify-vacancy claims before fetching recipients or sending', async () => {
  const src = await Deno.readTextFile(new URL('../notify-vacancy/index.ts', import.meta.url))
  const serveAt = src.indexOf('Deno.serve(')
  const body = src.slice(serveAt)
  const claimAt = body.indexOf('await claimFirstAnnouncement(')
  const fetchAt = body.indexOf('await fetchEligibleRecipients(')
  const sendAt = body.indexOf('await sendTrackedBatch(')
  assert(claimAt > 0, 'notify-vacancy must call claimFirstAnnouncement')
  assert(fetchAt > claimAt, 'claim must happen before recipients are fetched')
  assert(sendAt > claimAt, 'claim must happen before any email is sent')
  assert(
    body.includes("claim.outcome === 'already_announced'") && body.includes("claim.outcome === 'error'"),
    'both skip outcomes must be handled',
  )
})

Deno.test('notify-vacancy no longer dedupes with a short email_sends time window', async () => {
  const src = await Deno.readTextFile(new URL('../notify-vacancy/index.ts', import.meta.url))
  assert(!/\.from\('email_sends'\)/.test(src), 'dedupe must use the DB claim, not an email_sends lookback')
})

// ── 4. post-claim failure alerting (founder 2026-09-26) ─────────────────────
// No automatic retry after the claim, so a failed send must reach Sentry with
// the opportunity + club ids and a "resend manually" message.

Deno.test('announcementSendOutcome: all failed / partial / ok / recipient query failed', () => {
  assertEquals(announcementSendOutcome({ sent: 0, failed: 5 }), 'failed')
  assertEquals(announcementSendOutcome({ sent: 3, failed: 2 }), 'partial')
  assertEquals(announcementSendOutcome({ sent: 5, failed: 0 }), 'ok')
  // Everything suppressed/filtered: nothing sent, nothing failed -> not an error.
  assertEquals(announcementSendOutcome({ sent: 0, failed: 0 }), 'ok')
  // Recipient page query failed part-way: audience incomplete.
  assertEquals(announcementSendOutcome({ sent: 4, failed: 0 }, 'timeout'), 'partial')
  assertEquals(announcementSendOutcome({ sent: 0, failed: 0 }, 'timeout'), 'failed')
})

type Captured = { error: unknown; context?: { tags?: Record<string, string>; extra?: Record<string, unknown>; functionName?: string } }

Deno.test('reportAnnouncementFailure sends a "resend manually" alert tagged with opportunity + club ids', () => {
  const captured: Captured[] = []
  reportAnnouncementFailure((error, context) => captured.push({ error, context }), {
    opportunityId: 'opp-1',
    clubId: 'club-9',
    correlationId: 'abcd1234',
    stage: 'send',
    sent: 0,
    failed: 12,
    totalRecipients: 12,
    cause: 'Resend 500',
  })
  assertEquals(captured.length, 1)
  const { error, context } = captured[0]
  assert(error instanceof Error)
  assert(error.message.startsWith(ANNOUNCEMENT_FAILED_MESSAGE), error.message)
  assert(error.message.includes('opp-1'))
  assertEquals(context?.functionName, 'notify-vacancy')
  assertEquals(context?.tags?.opportunity_id, 'opp-1')
  assertEquals(context?.tags?.club_id, 'club-9')
  assertEquals(context?.tags?.stage, 'send')
  assertEquals(context?.extra?.opportunityId, 'opp-1')
  assertEquals(context?.extra?.clubId, 'club-9')
  assertEquals(context?.extra?.failed, 12)
  assertEquals(context?.extra?.cause, 'Resend 500')
})

Deno.test('reportAnnouncementFailure marks a partial send and never throws', () => {
  const captured: Captured[] = []
  reportAnnouncementFailure((error, context) => captured.push({ error, context }), {
    opportunityId: 'opp-2', clubId: 'club-2', stage: 'send', sent: 8, failed: 2, totalRecipients: 10,
  })
  assert((captured[0].error as Error).message.includes('partial: 8 sent, 2 failed'))
  // A throwing reporter must not break the function.
  reportAnnouncementFailure(() => { throw new Error('sentry down') }, {
    opportunityId: 'opp-3', clubId: 'club-3', stage: 'exception', cause: 'x',
  })
})

Deno.test('notify-vacancy alerts on every post-claim failure path', async () => {
  const src = await Deno.readTextFile(new URL('../notify-vacancy/index.ts', import.meta.url))
  const body = src.slice(src.indexOf('Deno.serve('))
  const claimAt = body.indexOf('await claimFirstAnnouncement(')
  const afterClaim = body.slice(claimAt)
  // recipients query failure, failed/partial send, and the catch-all exception
  assert(afterClaim.includes("stage: 'recipients'"), 'recipient-fetch failure must be reported')
  assert(afterClaim.includes('announcementSendOutcome(emailResult.stats'), 'send outcome must be checked')
  assert(afterClaim.includes("stage: 'exception'"), 'exceptions after the claim must be reported')
  assert(body.includes('claimedVacancy = vacancy'), 'the catch block must know the claim was won')
  assert(
    (body.match(/reportAnnouncementFailure\(captureException/g) ?? []).length >= 3,
    'all three failure paths report via captureException',
  )
})
