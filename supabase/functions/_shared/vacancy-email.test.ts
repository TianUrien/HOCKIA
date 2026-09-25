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
  claimFirstAnnouncement,
  isVacancyNewlyPublished,
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
