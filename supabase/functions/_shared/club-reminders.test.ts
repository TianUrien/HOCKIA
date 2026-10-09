/**
 * B2 · Club reminders — the pure rules (club-reminders.ts).
 *
 * Pinned here:
 *   1. timezone from the publisher's country, and the 09:00 local selection
 *   2. quiet hours: no push 22:00–08:00 local, deferred to 08:00
 *   3. the day-10 skip rule
 *   4. one email per publisher per local day, Last call + Closing soon combined
 *   5. subjects / bodies / push copy with first names, never a pronoun
 *   6. hidden people (banned, frozen, known minors) in neither rows nor counts
 */
import { assert, assertEquals, assertFalse } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import {
  buildReminderNotification,
  type CandidateRow,
  closesChip,
  closingSoonSubject,
  chipIsAmber,
  isQuietHour,
  isReminderHour,
  isVisibleApplicant,
  lastCallBody,
  lastCallSubject,
  localParts,
  namesPhrase,
  newApplicationsDue,
  newApplicationsSubject,
  nextPushTime,
  planPublisherReminders,
  reminderCopyFromMetadata,
  reminderRouteFromMetadata,
  reviewTarget,
  shouldSkipClosingSoon,
  timezoneForCountry,
  toApplicantItems,
  toItems,
  waitingLine,
} from './club-reminders.ts'

const PUB = '00000000-0000-4000-8000-0000000000aa'
const ROLE_A = '00000000-0000-4000-8000-0000000000b1'
const ROLE_B = '00000000-0000-4000-8000-0000000000b2'

let seq = 0
function row(over: Partial<CandidateRow> = {}): CandidateRow {
  seq += 1
  return {
    publisher_id: PUB,
    publisher_email: 'club@example.com',
    publisher_full_name: 'Club Atlético Rosario',
    publisher_role: 'club',
    publisher_country_code: 'AR',
    publisher_notify_applications: true,
    answered_last_24h: false,
    last_reminder_email_date: null,
    last_reminder_push_date: null,
    last_new_applications_email_at: null,
    application_id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    opportunity_id: ROLE_A,
    role_title: 'First team midfielder',
    role_position: 'midfielder',
    org_name: 'Club Atlético Rosario',
    applicant_id: `10000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    applicant_full_name: 'Ana Pérez',
    applicant_avatar_url: null,
    applicant_role: 'player',
    applicant_position: 'midfielder',
    applicant_country: 'Argentina',
    applicant_is_blocked: false,
    applicant_frozen_minor_at: null,
    applicant_known_minor: false,
    applied_at: '2026-09-29T15:00:00Z',
    closes_at: '2026-10-13T08:00:00Z',
    fit_state: 'green',
    email_closing_soon_logged: false,
    email_last_call_logged: false,
    push_closing_soon_logged: false,
    push_last_call_logged: false,
    ...over,
  }
}

// Friday 9 Oct 2026, 12:05 UTC = 09:05 in Buenos Aires (UTC-3).
const AR_9AM = new Date('2026-10-09T12:05:00Z')
// Closes Tuesday 13 Oct (08:00 UTC sweep = 05:00 AR): 4 local days left.
const CLOSES_TUE = '2026-10-13T08:00:00Z'
// Closes Saturday 10 Oct: 1 local day left.
const CLOSES_SAT = '2026-10-10T08:00:00Z'

// ── 1 · timezone + 09:00 selection ──────────────────────────────────────────

Deno.test('timezone comes from the country code; unknown or missing → UTC', () => {
  assertEquals(timezoneForCountry('AR'), 'America/Argentina/Buenos_Aires')
  assertEquals(timezoneForCountry('nl'), 'Europe/Amsterdam')
  assertEquals(timezoneForCountry('GB-ENG'), 'Europe/London')
  assertEquals(timezoneForCountry('XE'), 'Europe/London')
  assertEquals(timezoneForCountry('IN'), 'Asia/Kolkata')
  assertEquals(timezoneForCountry('ZZ'), 'UTC')
  assertEquals(timezoneForCountry(null), 'UTC')
  assertEquals(timezoneForCountry(''), 'UTC')
})

Deno.test('the 09:00 local hour is selected per publisher timezone (DST-aware, half-hour zones)', () => {
  assert(isReminderHour(localParts(AR_9AM, 'America/Argentina/Buenos_Aires')))
  assertFalse(isReminderHour(localParts(AR_9AM, 'Europe/Madrid'))) // 14:05 CEST
  // Spain in October (CEST, UTC+2) vs November (CET, UTC+1).
  assert(isReminderHour(localParts(new Date('2026-10-09T07:05:00Z'), 'Europe/Madrid')))
  assert(isReminderHour(localParts(new Date('2026-11-02T08:05:00Z'), 'Europe/Madrid')))
  // India (UTC+5:30): the :05 UTC run lands on 09:35 local.
  assert(isReminderHour(localParts(new Date('2026-10-09T04:05:00Z'), 'Asia/Kolkata')))
  assertFalse(isReminderHour(localParts(new Date('2026-10-09T03:05:00Z'), 'Asia/Kolkata')))
  // A publisher with no country is on UTC.
  assert(isReminderHour(localParts(new Date('2026-10-09T09:05:00Z'), timezoneForCountry(null))))
})

Deno.test('the plan emails only in the publisher’s 09:00 hour', () => {
  const rows = [row({ closes_at: CLOSES_TUE })]
  assert(planPublisherReminders(rows, AR_9AM)?.email)
  assertEquals(planPublisherReminders(rows, new Date('2026-10-09T13:05:00Z'))?.email, null) // 10:05 AR
  assertEquals(planPublisherReminders(rows, new Date('2026-10-09T11:05:00Z'))?.email, null) // 08:05 AR
  // Same instant, a Dutch publisher: 14:05 there → nothing.
  assertEquals(planPublisherReminders([row({ publisher_country_code: 'NL', closes_at: CLOSES_TUE })], AR_9AM)?.email, null)
})

Deno.test('days left are counted in local calendar days; 4 = Closing soon, 1 = Last call', () => {
  const items = toItems([row({ closes_at: CLOSES_TUE }), row({ closes_at: CLOSES_SAT })], 'America/Argentina/Buenos_Aires', AR_9AM)
  assertEquals(items.map((i) => i.daysLeft), [1, 4]) // soonest first
  assertEquals(closesChip(items[0].daysLeft, items[0].closesLocal), 'Closes tomorrow')
  assertEquals(closesChip(items[1].daysLeft, items[1].closesLocal), 'Closes Tuesday')
  assert(chipIsAmber(5))
  assertFalse(chipIsAmber(6))
})

// ── 2 · quiet hours ─────────────────────────────────────────────────────────

Deno.test('quiet hours are 22:00–07:59 local', () => {
  assert(isQuietHour(22))
  assert(isQuietHour(23))
  assert(isQuietHour(0))
  assert(isQuietHour(7))
  assertFalse(isQuietHour(8))
  assertFalse(isQuietHour(21))
})

Deno.test('a push asked for in quiet hours is deferred to 08:00 local', () => {
  // 00:00 Saturday in Buenos Aires → 08:00 there = 11:00 UTC.
  assertEquals(nextPushTime(new Date('2026-10-10T03:00:00Z'), 'America/Argentina/Buenos_Aires').toISOString(), '2026-10-10T11:00:00.000Z')
  // 23:30 in India → 08:00 IST next morning = 02:30 UTC.
  assertEquals(nextPushTime(new Date('2026-10-09T18:00:00Z'), 'Asia/Kolkata').toISOString(), '2026-10-10T02:30:00.000Z')
  // Outside quiet hours: now.
  const at = new Date('2026-10-09T15:00:00Z')
  assertEquals(nextPushTime(at, 'America/Argentina/Buenos_Aires'), at)
})

Deno.test('the plan never pushes in quiet hours; a left-over push goes from 08:00, a fresh one with the 09:00 email', () => {
  const fresh = [row({ closes_at: CLOSES_SAT })] // 1 day left: Last call due today
  assertEquals(planPublisherReminders(fresh, new Date('2026-10-10T02:05:00Z'))?.push, null) // 23:05 AR
  assertEquals(planPublisherReminders(fresh, new Date('2026-10-09T11:05:00Z'))?.push, null) // 08:05 AR, fresh → waits for 09:00
  assertEquals(planPublisherReminders(fresh, AR_9AM)?.push?.kind, 'applicant_last_call')
  // Closes today and never pushed (yesterday's run missed it): left over → 08:05 is allowed.
  const leftover = [row({ closes_at: '2026-10-09T23:00:00Z' })]
  assertEquals(planPublisherReminders(leftover, new Date('2026-10-09T11:05:00Z'))?.push?.kind, 'applicant_last_call')
  assertEquals(planPublisherReminders(leftover, new Date('2026-10-09T09:05:00Z'))?.push, null) // 06:05 AR
})

// ── 3 · skip rule ───────────────────────────────────────────────────────────

Deno.test('day-10 skip rule: answered in the last 24 h AND nothing closes within 2 days', () => {
  assert(shouldSkipClosingSoon(true, [{ daysLeft: 4 }, { daysLeft: 3 }]))
  assertFalse(shouldSkipClosingSoon(true, [{ daysLeft: 4 }, { daysLeft: 2 }]))
  assertFalse(shouldSkipClosingSoon(false, [{ daysLeft: 4 }]))
})

Deno.test('a skipped Closing soon sends nothing and is reported for logging', () => {
  const plan = planPublisherReminders([row({ closes_at: CLOSES_TUE, answered_last_24h: true })], AR_9AM)!
  assertEquals(plan.email, null)
  assertEquals(plan.push, null)
  assertEquals(plan.skippedClosingSoon.length, 1)
  // Something closing within two days keeps the reminder.
  const busy = planPublisherReminders([
    row({ closes_at: CLOSES_TUE, answered_last_24h: true }),
    row({ closes_at: CLOSES_SAT, answered_last_24h: true, applicant_full_name: 'Ben Ito' }),
  ], AR_9AM)!
  assertEquals(busy.skippedClosingSoon.length, 0)
  assert(busy.email)
})

// ── 4 · one email per day, combined ─────────────────────────────────────────

Deno.test('Last call and Closing soon combine into ONE email (Last call first) and ONE push', () => {
  const plan = planPublisherReminders([
    row({ closes_at: CLOSES_TUE, applicant_full_name: 'Ana Pérez' }),
    row({ closes_at: CLOSES_SAT, applicant_full_name: 'Ben Ito' }),
  ], AR_9AM)!
  assert(plan.email)
  assertEquals(plan.email.items.map((i) => i.kind), ['last_call', 'closing_soon'])
  assertEquals(plan.email.lastCall.map((i) => i.firstName), ['Ben'])
  assertEquals(plan.email.closingSoon.map((i) => i.firstName), ['Ana'])
  assertEquals(plan.push?.kind, 'applicant_last_call')
  assertEquals(plan.push?.items.length, 2)
})

Deno.test('no second reminder email the same local day, and nothing already logged is re-sent', () => {
  const sentToday = planPublisherReminders([row({ closes_at: CLOSES_TUE, last_reminder_email_date: '2026-10-09', last_reminder_push_date: '2026-10-09' })], AR_9AM)!
  assertEquals(sentToday.email, null)
  assertEquals(sentToday.push, null)
  const logged = planPublisherReminders([row({ closes_at: CLOSES_TUE, email_closing_soon_logged: true, push_closing_soon_logged: true })], AR_9AM)!
  assertEquals(logged.email, null)
  assertEquals(logged.push, null)
  // Yesterday's email does not block today's.
  assert(planPublisherReminders([row({ closes_at: CLOSES_TUE, last_reminder_email_date: '2026-10-08' })], AR_9AM)?.email)
})

Deno.test('email respects notify_applications and a missing address; the push still follows its own preferences', () => {
  const off = planPublisherReminders([row({ closes_at: CLOSES_TUE, publisher_notify_applications: false })], AR_9AM)!
  assertEquals(off.email, null)
  assert(off.push) // send-push drops it when notify_applications / notify_push are off
  assertEquals(planPublisherReminders([row({ closes_at: CLOSES_TUE, publisher_email: null })], AR_9AM)?.email, null)
})

Deno.test('applications closing in 5+ days are listed but trigger nothing on their own', () => {
  const plan = planPublisherReminders([row({ closes_at: '2026-10-15T08:00:00Z' })], AR_9AM)!
  assertEquals(plan.email, null)
  assertEquals(plan.pending.length, 1)
})

// ── 5 · copy ────────────────────────────────────────────────────────────────

const PRONOUN = /\b(he|she|his|her|hers|him|himself|herself)\b/i

Deno.test('Last call copy: first name only, exact founder wording', () => {
  const [item] = toItems([row({ closes_at: CLOSES_SAT, applicant_full_name: 'Ana María Pérez', applied_at: '2026-09-25T15:00:00Z' })], 'America/Argentina/Buenos_Aires', AR_9AM)
  assertEquals(lastCallSubject([item]), 'Last day to answer Ana')
  assertEquals(lastCallBody(item), "Ana applied on 25 Sep. Tomorrow the application closes on its own and Ana is told you didn't reply. A short answer either way is better than none.")
  assertFalse(PRONOUN.test(lastCallBody(item)))
  assertEquals(lastCallSubject([item, { ...item, firstName: 'Ben' }]), 'Last day to answer Ana and Ben')
  assertEquals(namesPhrase(['Ana', 'Ben', 'Cara']), 'Ana and 2 more')
  assertEquals(namesPhrase([null]), 'an applicant')
})

Deno.test('Closing soon copy: "<First name>\'s application closes on <weekday>" for one, "N players are waiting" for several', () => {
  const items = toItems([row({ closes_at: CLOSES_TUE })], 'America/Argentina/Buenos_Aires', AR_9AM)
  assertEquals(closingSoonSubject(items), "Ana's application closes on Tuesday")
  assertEquals(waitingLine(3), '3 players are waiting for your answer')
  assertEquals(waitingLine(1), '1 player is waiting for your answer')
  assertEquals(waitingLine(2, false), '2 applicants are waiting for your answer')
})

Deno.test('push copy for both reminders (founder wording) and its tap target', () => {
  const tz = 'America/Argentina/Buenos_Aires'
  const pending = toItems([
    row({ closes_at: CLOSES_SAT, applicant_full_name: 'Ana Pérez' }),
    row({ closes_at: CLOSES_TUE, applicant_full_name: 'Ben Ito', opportunity_id: ROLE_B }),
  ], tz, AR_9AM)
  const last = buildReminderNotification('applicant_last_call', [pending[0]], pending)
  assertEquals(last.title, 'Last day to answer Ana')
  assertEquals(last.summary, 'The application to First team midfielder closes tomorrow.')
  assertEquals(last.target_url, `/dashboard/opportunities/${ROLE_A}/applicants/${pending[0].applicationId}`)

  const soon = buildReminderNotification('applicants_closing_soon', [], pending)
  assertEquals(soon.title, '2 players are waiting for Club Atlético Rosario')
  assertEquals(soon.summary, "Ana's application closes tomorrow.")
  assertEquals(soon.target_url, '/opportunities') // several roles
  for (const t of [last.title, last.summary, soon.title, soon.summary]) assertFalse(PRONOUN.test(t))

  const oneRole = buildReminderNotification('applicants_closing_soon', [], toItems([
    row({ closes_at: CLOSES_TUE }), row({ closes_at: CLOSES_TUE, applicant_full_name: 'Cara Diaz' }),
  ], tz, AR_9AM))
  assertEquals(oneRole.target_url, `/dashboard/opportunities/${ROLE_A}/applicants`)
  assertEquals(oneRole.summary, "Ana's application closes on Tuesday.")
})

Deno.test('a stored reminder notification routes and reads the same from its metadata (push = in-app)', () => {
  assertEquals(reminderRouteFromMetadata({ opportunity_id: ROLE_A, application_id: 'app1' }), `/dashboard/opportunities/${ROLE_A}/applicants/app1`)
  assertEquals(reminderRouteFromMetadata({ opportunity_id: ROLE_A }), `/dashboard/opportunities/${ROLE_A}/applicants`)
  assertEquals(reminderRouteFromMetadata({}), '/opportunities')
  assertEquals(reminderCopyFromMetadata('applicant_last_call', {}).title, 'Last day to answer an applicant')
  assertEquals(reminderCopyFromMetadata('applicants_closing_soon', { title: 'T', summary: 'S' }), { title: 'T', body: 'S' })
})

Deno.test('new-applications subject and the hourly gap', () => {
  const items = toApplicantItems([row(), row({ applicant_full_name: 'Ben Ito' })], 'UTC')
  assertEquals(newApplicationsSubject([items[0]]), 'Ana applied for First team midfielder')
  assertEquals(newApplicationsSubject(items), '2 new applicants for First team midfielder')
  assertEquals(newApplicationsSubject([items[0], { ...items[1], opportunityId: ROLE_B }]), '2 new applicants for your roles')
  const now = new Date('2026-10-09T12:00:00Z')
  assert(newApplicationsDue(null, now))
  assert(newApplicationsDue('2026-10-09T11:00:00Z', now))
  assertFalse(newApplicationsDue('2026-10-09T11:30:00Z', now))
  assertEquals(reviewTarget([items[0]]), `/dashboard/opportunities/${ROLE_A}/applicants/${items[0].applicationId}`)
})

// ── 6 · hidden people ───────────────────────────────────────────────────────

Deno.test('banned, frozen and known-minor applicants are in neither the rows nor any count', () => {
  assertFalse(isVisibleApplicant({ applicant_is_blocked: true, applicant_frozen_minor_at: null, applicant_known_minor: false }))
  assertFalse(isVisibleApplicant({ applicant_is_blocked: false, applicant_frozen_minor_at: '2026-09-01T00:00:00Z', applicant_known_minor: false }))
  assertFalse(isVisibleApplicant({ applicant_is_blocked: false, applicant_frozen_minor_at: null, applicant_known_minor: true }))
  assert(isVisibleApplicant({ applicant_is_blocked: false, applicant_frozen_minor_at: null, applicant_known_minor: false }))

  const rows = [
    row({ closes_at: CLOSES_TUE, applicant_full_name: 'Ana Pérez' }),
    row({ closes_at: CLOSES_TUE, applicant_full_name: 'Banned Person', applicant_is_blocked: true }),
    row({ closes_at: CLOSES_TUE, applicant_full_name: 'Frozen Person', applicant_frozen_minor_at: '2026-09-01T00:00:00Z' }),
    row({ closes_at: CLOSES_TUE, applicant_full_name: 'Young Person', applicant_known_minor: true }),
    row({ closes_at: CLOSES_TUE, applicant_full_name: 'Ben Ito' }),
  ]
  const plan = planPublisherReminders(rows, AR_9AM)!
  assertEquals(plan.pending.map((i) => i.firstName), ['Ana', 'Ben'])
  assertEquals(plan.email?.items.length, 2)
  const n = buildReminderNotification('applicants_closing_soon', [], plan.pending)
  assertEquals(n.metadata.count, 2)
  assert(n.title.startsWith('2 players'))
  // A publisher whose only applicant is hidden gets nothing.
  const hiddenOnly = planPublisherReminders([row({ closes_at: CLOSES_TUE, applicant_is_blocked: true })], AR_9AM)!
  assertEquals(hiddenOnly.email, null)
  assertEquals(hiddenOnly.push, null)
  assertEquals(toApplicantItems([row({ applicant_frozen_minor_at: '2026-01-01T00:00:00Z' })], 'UTC').length, 0)
})
