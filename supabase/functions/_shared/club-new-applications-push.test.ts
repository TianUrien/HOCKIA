/**
 * Grouped new-application push (20261021160000) — the pure rules.
 *
 * Founder, 21 Oct 2026: at most one new-application push per club per hour.
 * Pinned here:
 *   1. one / one role / several roles copy and tap target
 *   2. no grouped push in quiet hours (22:00–08:00 publisher local)
 *   3. send-push stands down only for individual rows from the switch on
 *   4. the grouped record renders as the grouped copy in send-push
 */
import { assert, assertEquals, assertFalse } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import {
  buildNewApplicationsPush,
  type CandidateRow,
  newApplicationsCopyFromMetadata,
  newApplicationsPushAllowedNow,
  pushStandsDownForBatch,
  toApplicantItems,
} from './club-reminders.ts'
import { buildPushPayload } from '../send-push/push-payload.ts'

const PUB = '00000000-0000-4000-8000-0000000000aa'
const ROLE_A = '00000000-0000-4000-8000-0000000000b1'
const ROLE_B = '00000000-0000-4000-8000-0000000000b2'
const TZ = 'America/Argentina/Buenos_Aires'
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
    applied_at: `2026-10-21T15:${String(seq % 60).padStart(2, '0')}:00Z`,
    closes_at: null,
    fit_state: 'green',
    email_closing_soon_logged: false,
    email_last_call_logged: false,
    push_closing_soon_logged: false,
    push_last_call_logged: false,
    ...over,
  } as CandidateRow
}

Deno.test('one application: named push, tap opens the applicant, applicant is the actor', () => {
  const items = toApplicantItems([row()], TZ)
  const push = buildNewApplicationsPush(PUB, items)
  assertEquals(push.title, 'Ana applied for First team midfielder')
  assertEquals(push.summary, 'Tap to review the application.')
  assertEquals(push.target_url, `/dashboard/opportunities/${ROLE_A}/applicants/${items[0].applicationId}`)
  assertEquals(push.record.recipient_profile_id, PUB)
  assertEquals(push.record.actor_profile_id, items[0].applicantId)
  assertEquals(push.record.kind, 'vacancy_application_received')
  assertEquals(push.record.metadata.batched, true)
  assertEquals(push.record.metadata.count, 1)
})

Deno.test('several applications to one role: one push, count and names, tap opens the role', () => {
  const items = toApplicantItems([
    row({ applicant_full_name: 'Ana Pérez' }),
    row({ applicant_full_name: 'Ben Ito' }),
    row({ applicant_full_name: 'Cleo Ruiz' }),
  ], TZ)
  const push = buildNewApplicationsPush(PUB, items)
  assertEquals(push.title, '3 new applicants for First team midfielder')
  assertEquals(push.summary, 'Ana and 2 more applied.')
  assertEquals(push.target_url, `/dashboard/opportunities/${ROLE_A}/applicants`)
  assertEquals(push.record.actor_profile_id, null)
  assertEquals(push.record.metadata.opportunity_id, ROLE_A)
  assertEquals(push.record.metadata.application_id, undefined)
})

Deno.test('several roles: one push for all of them, tap opens Opportunities', () => {
  const items = toApplicantItems([
    row({ applicant_full_name: 'Ana Pérez' }),
    row({ applicant_full_name: 'Ben Ito', opportunity_id: ROLE_B, role_title: 'Goalkeeper' }),
  ], TZ)
  const push = buildNewApplicationsPush(PUB, items)
  assertEquals(push.title, '2 new applicants for your roles')
  assertEquals(push.summary, 'Ana and Ben applied.')
  assertEquals(push.target_url, '/opportunities')
  assertEquals(push.record.metadata.opportunity_id, undefined)
})

Deno.test('hidden applicants are in neither the push nor its count', () => {
  const items = toApplicantItems([
    row({ applicant_full_name: 'Ana Pérez' }),
    row({ applicant_full_name: 'Hidden Person', applicant_is_blocked: true }),
    row({ applicant_full_name: 'Minor Person', applicant_known_minor: true }),
  ], TZ)
  const push = buildNewApplicationsPush(PUB, items)
  assertEquals(push.record.metadata.count, 1)
  assertEquals(push.title, 'Ana applied for First team midfielder')
})

Deno.test('a missing first name never starts the body in lower case', () => {
  const items = toApplicantItems([row({ applicant_full_name: null }), row({ applicant_full_name: 'Ben Ito' })], TZ)
  assertEquals(buildNewApplicationsPush(PUB, items).summary, 'An applicant and Ben applied.')
})

Deno.test('quiet hours: no grouped push 22:00–08:00 publisher local time', () => {
  // Buenos Aires is UTC-3.
  assertFalse(newApplicationsPushAllowedNow(new Date('2026-10-21T02:00:00Z'), TZ)) // 23:00 local
  assertFalse(newApplicationsPushAllowedNow(new Date('2026-10-21T10:59:00Z'), TZ)) // 07:59 local
  assert(newApplicationsPushAllowedNow(new Date('2026-10-21T11:00:00Z'), TZ)) // 08:00 local
  assert(newApplicationsPushAllowedNow(new Date('2026-10-21T00:59:00Z'), TZ)) // 21:59 local
})

Deno.test('send-push stands down only for individual new-application rows from the switch on', () => {
  const since = '2026-10-21T16:00:00Z'
  // Switch off → never stands down.
  assertFalse(pushStandsDownForBatch('vacancy_application_received', {}, '2026-10-21T17:00:00Z', null))
  // Before the switch → the old immediate push.
  assertFalse(pushStandsDownForBatch('vacancy_application_received', {}, '2026-10-21T15:59:59Z', since))
  // From the switch → stands down.
  assert(pushStandsDownForBatch('vacancy_application_received', {}, '2026-10-21T16:00:00Z', since))
  assert(pushStandsDownForBatch('vacancy_application_received', {}, null, since))
  // The grouped push itself always goes.
  assertFalse(pushStandsDownForBatch('vacancy_application_received', { batched: true }, '2026-10-21T17:00:00Z', since))
  // Other kinds are untouched.
  assertFalse(pushStandsDownForBatch('applicant_last_call', {}, '2026-10-21T17:00:00Z', since))
  assertFalse(pushStandsDownForBatch('message_received', {}, '2026-10-21T17:00:00Z', since))
  // An unreadable switch fails open (push as before).
  assertFalse(pushStandsDownForBatch('vacancy_application_received', {}, '2026-10-21T17:00:00Z', 'not a date'))
})

Deno.test('send-push renders the grouped record with its own copy and tap target', () => {
  const items = toApplicantItems([row({ applicant_full_name: 'Ana Pérez' }), row({ applicant_full_name: 'Ben Ito' })], TZ)
  const push = buildNewApplicationsPush(PUB, items)
  const payload = buildPushPayload(push.record.kind, push.record.metadata, 'A HOCKIA member', null)
  assertEquals(payload.title, '2 new applicants for First team midfielder')
  assertEquals(payload.body, 'Ana and Ben applied.')
  assertEquals(payload.url, `/dashboard/opportunities/${ROLE_A}/applicants`)
  assertEquals(payload.tag, 'application')
})

Deno.test('send-push never takes an unsafe tap target from the grouped metadata', () => {
  const payload = buildPushPayload('vacancy_application_received', {
    batched: true, title: 'x', summary: 'y', target_url: 'https://evil.example', opportunity_id: ROLE_A,
  }, 'A HOCKIA member', null)
  assertEquals(payload.url, `/dashboard/opportunities/${ROLE_A}/applicants`)
})

Deno.test('the individual new-application push is unchanged', () => {
  const payload = buildPushPayload('vacancy_application_received', {
    opportunity_title: 'First team midfielder', opportunity_id: ROLE_A,
  }, 'Ana Pérez', null)
  assertEquals(payload.title, 'New Applicant')
  assertEquals(payload.body, 'Ana Pérez applied for First team midfielder')
})

Deno.test('grouped copy fallbacks are never empty', () => {
  assertEquals(newApplicationsCopyFromMetadata({}), { title: 'New applicants', body: 'New applications are waiting for you.' })
})
