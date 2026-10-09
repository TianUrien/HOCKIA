/**
 * B2 · Club reminders — the three publisher emails (club-reminder-email.ts).
 *
 * Pinned here: every member value is HTML-escaped, avatars only from https,
 * the founder copy is in the HTML, Last call comes first when combined, the
 * decline link deep-links into the Decline sheet, the "N players" count and
 * the rows never include hidden people, and no token action buttons remain.
 */
Deno.env.set('PUBLIC_SITE_URL', 'https://staging.inhockia.com')

import { assert, assertEquals, assertFalse, assertStringIncludes } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { type CandidateRow, planPublisherReminders, toApplicantItems, toItems } from './club-reminders.ts'
import { renderNewApplicationsEmail, renderReminderEmail } from './club-reminder-email.ts'

const BASE = 'https://staging.inhockia.com'
const TZ = 'America/Argentina/Buenos_Aires'
const NOW = new Date('2026-10-09T12:05:00Z') // 09:05 Friday in Buenos Aires
const ROLE = '00000000-0000-4000-8000-0000000000b1'

let seq = 0
function row(over: Partial<CandidateRow> = {}): CandidateRow {
  seq += 1
  return {
    publisher_id: 'pub', publisher_email: 'club@example.com', publisher_full_name: 'Club', publisher_role: 'club',
    publisher_country_code: 'AR', publisher_notify_applications: true, answered_last_24h: false,
    last_reminder_email_date: null, last_reminder_push_date: null, last_new_applications_email_at: null,
    application_id: `app-${seq}`, opportunity_id: ROLE, role_title: 'First team midfielder', role_position: 'midfielder',
    org_name: 'Club Atlético Rosario', applicant_id: `pl-${seq}`, applicant_full_name: 'Ana Pérez',
    applicant_avatar_url: null, applicant_role: 'player', applicant_position: 'midfielder', applicant_country: 'Argentina',
    applicant_is_blocked: false, applicant_frozen_minor_at: null, applicant_known_minor: false,
    applied_at: '2026-09-25T15:00:00Z', closes_at: '2026-10-13T08:00:00Z', fit_state: 'green',
    email_closing_soon_logged: false, email_last_call_logged: false, push_closing_soon_logged: false, push_last_call_logged: false,
    ...over,
  }
}

const EVIL = '<script>alert("x")</script> O\'Brien & Co'

Deno.test('every member value is escaped in the HTML (names, role, organisation, country)', () => {
  const items = toItems([
    row({ applicant_full_name: EVIL, role_title: '<b>Role</b> "quoted"', org_name: '<img src=x onerror=1>', applicant_country: '<i>Land</i>', closes_at: '2026-10-10T08:00:00Z' }),
    row({ applicant_full_name: 'Ben Ito', org_name: '<img src=x onerror=1>' }),
  ], TZ, NOW)
  const html = [
    renderReminderEmail({ lastCall: [items[0]], closingSoon: [items[1]], pending: items, baseUrl: BASE }).html,
    renderReminderEmail({ lastCall: [], closingSoon: items, pending: items, baseUrl: BASE }).html,
    renderNewApplicationsEmail({ items, baseUrl: BASE }).html,
  ].join('\n')
  assertFalse(html.includes('<script>'))
  assertFalse(html.includes('<b>Role</b>'))
  assertFalse(html.includes('<img src=x'))
  assertFalse(html.includes('<i>Land</i>'))
  assertStringIncludes(html, '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; O&#39;Brien &amp; Co')
  assertStringIncludes(html, '&lt;b&gt;Role&lt;/b&gt; &quot;quoted&quot;')
})

Deno.test('avatars render only from https URLs; anything else falls back to initials', () => {
  const items = toApplicantItems([
    row({ applicant_avatar_url: 'https://cdn.example.com/a.png' }),
    row({ applicant_full_name: 'Ben Ito', applicant_avatar_url: 'http://insecure.example.com/b.png' }),
    row({ applicant_full_name: 'Cara Diaz', applicant_avatar_url: 'javascript:alert(1)' }),
  ], TZ)
  const { html } = renderNewApplicationsEmail({ items, baseUrl: BASE })
  assertStringIncludes(html, 'src="https://cdn.example.com/a.png"')
  assertFalse(html.includes('insecure.example.com'))
  assertFalse(html.includes('javascript:'))
  assertStringIncludes(html, '>BI<') // initials
})

Deno.test('Last call email: founder copy, Review + Decline with a kind note deep link, footer', () => {
  const items = toItems([
    row({ closes_at: '2026-10-10T08:00:00Z' }),
    row({ applicant_full_name: 'Ben Ito', closes_at: '2026-10-15T08:00:00Z' }),
  ], TZ, NOW)
  const email = renderReminderEmail({ lastCall: [items[0]], closingSoon: [], pending: items, baseUrl: BASE })
  assertEquals(email.subject, 'Last day to answer Ana')
  assertStringIncludes(email.html, 'Ana applied on 25 Sep. Tomorrow the application closes on its own and Ana is told you didn&#39;t reply. A short answer either way is better than none.')
  assertStringIncludes(email.html, '>Review Ana<')
  assertStringIncludes(email.html, `${BASE}/dashboard/opportunities/${ROLE}/applicants/${items[0].applicationId}?decline=1`)
  assertStringIncludes(email.html, '>Decline with a kind note<')
  assertStringIncludes(email.html, '1 more is waiting: Ben.')
  assertStringIncludes(email.html, 'Last reminder for Ana.')
  assertStringIncludes(email.html, 'Change emails in Settings → Notifications.')
  assertStringIncludes(email.text, `Decline with a kind note: ${BASE}/dashboard/opportunities/${ROLE}/applicants/${items[0].applicationId}?decline=1`)
  // No token triage buttons any more.
  assertFalse(email.html.includes('/email-action'))
  assertFalse(/Good fit|Not a fit|Maybe/.test(email.html))
})

Deno.test('Closing soon email: N players waiting, soonest first, fit badges, amber chip only ≤5 days, Review N players', () => {
  const items = toItems([
    row({ applicant_full_name: 'Late Closer', closes_at: '2026-10-20T08:00:00Z', fit_state: 'grey' }),
    row({ applicant_full_name: 'Ana Pérez', closes_at: '2026-10-13T08:00:00Z', fit_state: 'green' }),
    row({ applicant_full_name: 'Ben Ito', closes_at: '2026-10-14T08:00:00Z', fit_state: 'yellow' }),
  ], TZ, NOW)
  const email = renderReminderEmail({ lastCall: [], closingSoon: [items[0]], pending: items, baseUrl: BASE })
  // Subject names the most urgent applicant; the "N players" line is the headline inside.
  assert(/^[^ ]+'s application closes /.test(email.subject), email.subject)
  assertStringIncludes(email.html, '3 players are waiting for your answer')
  const order = ['Ana Pérez', 'Ben Ito', 'Late Closer'].map((n) => email.html.indexOf(n))
  assert(order[0] < order[1] && order[1] < order[2], 'soonest-closing first')
  assertStringIncludes(email.html, '>Strong fit<')
  // Possible fit is neutral (surface/muted, ink-secondary), never yellow (design review 9 Oct).
  assertStringIncludes(email.html, 'background:#f4f4f7;color:#5b5b6b;font-size:12px;font-weight:600;line-height:18px;">Possible fit<')
  assertFalse(email.html.includes('#fef7c3'))
  assertEquals((email.html.match(/>Strong fit</g) ?? []).length + (email.html.match(/>Possible fit</g) ?? []).length, 2)
  assertStringIncludes(email.html, `href="${BASE}/settings/notifications"`)
  assertStringIncludes(email.html, 'background:#fffaeb;color:#b54708;font-size:12px;font-weight:600;line-height:18px;white-space:nowrap;">Closes Tuesday')
  assertStringIncludes(email.html, 'background:#f2f4f7;color:#475467;font-size:12px;font-weight:600;line-height:18px;white-space:nowrap;">Closes 20 Oct')
  assertStringIncludes(email.html, '>Review 3 players<')
  assertStringIncludes(email.html, `href="${BASE}/dashboard/opportunities/${ROLE}/applicants"`)
  assertStringIncludes(email.html, 'Not the right fit? Declining takes one tap, and Hockia AI drafts a kind note you can edit.')
  assertStringIncludes(email.html, 'Player · Midfielder · Argentina')
})

Deno.test('Closing soon for one applicant: "<First name>\'s application closes on <weekday>"', () => {
  const items = toItems([row()], TZ, NOW)
  const email = renderReminderEmail({ lastCall: [], closingSoon: items, pending: items, baseUrl: BASE })
  assertEquals(email.subject, "Ana's application closes on Tuesday")
  assertStringIncludes(email.html, '>Review Ana<')
  assertStringIncludes(email.html, `${BASE}/dashboard/opportunities/${ROLE}/applicants/${items[0].applicationId}"`)
})

Deno.test('combined day: Last call first, then the Closing soon list; one subject', () => {
  const plan = planPublisherReminders([
    row({ applicant_full_name: 'Ana Pérez', closes_at: '2026-10-13T08:00:00Z' }),
    row({ applicant_full_name: 'Ben Ito', closes_at: '2026-10-10T08:00:00Z' }),
  ], NOW)!
  const email = renderReminderEmail({ lastCall: plan.email!.lastCall, closingSoon: plan.email!.closingSoon, pending: plan.pending, baseUrl: BASE })
  assertEquals(email.subject, 'Last day to answer Ben')
  assert(email.html.indexOf('Ben applied on') < email.html.indexOf('Closing soon'))
  assert(email.html.indexOf('Closing soon') < email.html.indexOf('Ana Pérez'))
  assertStringIncludes(email.html, '1 player is waiting for your answer')
  assertFalse(email.html.includes('more is waiting'))
})

Deno.test('hidden applicants are in neither the rows nor the "N players" count', () => {
  const plan = planPublisherReminders([
    row({ applicant_full_name: 'Ana Pérez' }),
    row({ applicant_full_name: 'Hidden Banned', applicant_is_blocked: true }),
    row({ applicant_full_name: 'Hidden Minor', applicant_known_minor: true }),
    row({ applicant_full_name: 'Ben Ito' }),
  ], NOW)!
  const email = renderReminderEmail({ lastCall: [], closingSoon: plan.email!.closingSoon, pending: plan.pending, baseUrl: BASE })
  assertFalse(email.subject.includes('Hidden'))
  assertStringIncludes(email.html, '2 players are waiting for your answer')
  assertFalse(email.html.includes('Hidden'))
  assertFalse(email.text.includes('Hidden'))
  assertStringIncludes(email.html, '>Review 2 players<')
})

Deno.test('new-applications batch: one Review link (applicant when one, Applicants when one role, Opportunities otherwise)', () => {
  const one = renderNewApplicationsEmail({ items: toApplicantItems([row()], TZ), baseUrl: BASE })
  assertEquals(one.subject, 'Ana applied for First team midfielder')
  assertEquals((one.html.match(/>Review</g) ?? []).length, 1)
  assertStringIncludes(one.html, `href="${BASE}/dashboard/opportunities/${ROLE}/applicants/app-`)
  const two = renderNewApplicationsEmail({ items: toApplicantItems([row(), row({ applicant_full_name: 'Ben Ito' })], TZ), baseUrl: BASE })
  assertStringIncludes(two.html, `href="${BASE}/dashboard/opportunities/${ROLE}/applicants"`)
  const roles = renderNewApplicationsEmail({ items: toApplicantItems([row(), row({ opportunity_id: 'other-role', role_title: 'Goalkeeper' })], TZ), baseUrl: BASE })
  assertEquals(roles.subject, '2 new applicants for your roles')
  assertStringIncludes(roles.html, `href="${BASE}/opportunities"`)
  for (const e of [one, two, roles]) {
    assertFalse(e.html.includes('/email-action'))
    assertStringIncludes(e.html, 'Change emails in Settings → Notifications.')
  }
})
