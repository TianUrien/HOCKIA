import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { buildPushPayload, isGeneratedHeadline, pushAllowed, pushLanguageOf, pushPreferenceColumn, unnamedActor } from '../send-push/push-payload.ts'

// The push body mirrors client/src/components/notifications/config.ts
// (applicationStatusCopy). Keep both in sync.

Deno.test('shortlisted push names the role by its title', () => {
  const payload = buildPushPayload('vacancy_application_status', {
    status: 'shortlisted',
    club_name: 'Dublin HC',
    vacancy_title: 'Senior men 1st XI midfielder',
    position: 'midfielder',
    opportunity_id: 'opp-1',
  }, 'Dublin HC')
  assertEquals(payload.title, 'Dublin HC shortlisted you')
  assertEquals(payload.body, "You're being considered for Senior men 1st XI midfielder.")
  assertEquals(payload.url, '/opportunities/opp-1')
})

Deno.test('shortlisted push falls back to the position when the title is missing or blank', () => {
  const noTitle = buildPushPayload('vacancy_application_status', {
    status: 'shortlisted',
    club_name: 'Dublin HC',
    position: 'head_coach',
  }, 'Dublin HC')
  assertEquals(noTitle.body, "You're being considered for Head Coach.")

  const blankTitle = buildPushPayload('vacancy_application_status', {
    status: 'shortlisted',
    club_name: 'Dublin HC',
    vacancy_title: '   ',
    position: 'goalkeeper',
  }, 'Dublin HC')
  assertEquals(blankTitle.body, "You're being considered for Goalkeeper.")

  const nothing = buildPushPayload('vacancy_application_status', {
    status: 'shortlisted',
  }, 'Someone')
  assertEquals(nothing.title, 'The club shortlisted you')
  assertEquals(nothing.body, "You're being considered for the opportunity.")
})

Deno.test('the other application statuses keep the position wording', () => {
  const maybe = buildPushPayload('vacancy_application_status', {
    status: 'maybe',
    club_name: 'Dublin HC',
    vacancy_title: 'Senior men 1st XI midfielder',
    position: 'midfielder',
  }, 'Dublin HC')
  assertEquals(maybe.body, 'Open your application for Midfielder to see the update.')

  const filled = buildPushPayload('vacancy_application_status', {
    status: 'filled',
    club_name: 'Dublin HC',
    vacancy_title: 'Senior men 1st XI midfielder',
    position: 'midfielder',
  }, 'Dublin HC')
  assertEquals(filled.body, 'Senior men 1st XI midfielder has been filled. Thanks for applying. New opportunities are open.')
})

// Round 9 (QA re-check item 18): a role posted without a typed title is stored
// under its generated headline ("Men's midfielder", client lib/postRole
// defaultTitle). The founder wants the bare position in the push.
Deno.test('a generated headline names the position, a typed title stays', () => {
  const generated = buildPushPayload('vacancy_application_status', {
    status: 'shortlisted',
    club_name: 'Dublin HC',
    vacancy_title: "Men's midfielder",
    position: 'midfielder',
    opportunity_id: 'opp-1',
  }, 'Dublin HC')
  assertEquals(generated.body, "You're being considered for Midfielder.")

  const curlyApostrophe = buildPushPayload('vacancy_application_status', {
    status: 'shortlisted',
    club_name: 'Dublin HC',
    vacancy_title: 'Women’s head coach',
    position: 'head_coach',
  }, 'Dublin HC')
  assertEquals(curlyApostrophe.body, "You're being considered for Head Coach.")

  const barePosition = buildPushPayload('vacancy_application_status', {
    status: 'filled',
    club_name: 'Dublin HC',
    vacancy_title: 'Goalkeeper',
    position: 'goalkeeper',
  }, 'Dublin HC')
  assertEquals(barePosition.body, 'Goalkeeper has been filled. Thanks for applying. New opportunities are open.')

  const typed = buildPushPayload('vacancy_application_status', {
    status: 'shortlisted',
    club_name: 'Dublin HC',
    vacancy_title: "Men's 1st XI midfielder",
    position: 'midfielder',
  }, 'Dublin HC')
  assertEquals(typed.body, "You're being considered for Men's 1st XI midfielder.")

  assertEquals(isGeneratedHeadline("Men's midfielder", 'Midfielder'), true)
  assertEquals(isGeneratedHeadline('Mixed forward', 'Forward'), true)
  assertEquals(isGeneratedHeadline("Men's midfielder", null), false)
  assertEquals(isGeneratedHeadline('Senior midfielder', 'Midfielder'), false)
})

Deno.test('the removed-account safety notice opens the notification list', () => {
  const payload = buildPushPayload('system_announcement', {
    notice: 'removed_account',
    title: 'A message about your safety',
    summary: 'An account that messaged you has been removed for spam.',
    target_url: '/messages',
  }, 'HOCKIA')
  assertEquals(payload.title, 'A message about your safety')
  assertEquals(payload.body, 'An account that messaged you has been removed for spam.')
  assertEquals(payload.url, '/notifications')

  const other = buildPushPayload('system_announcement', { title: 'New in HOCKIA', summary: 'Hello' }, 'HOCKIA')
  assertEquals(other.url, '/home')
})

// ── B2 · publisher reminders (20261009100000) ──
Deno.test('club reminder pushes use the server copy, route like the bell, and obey notify_applications', () => {
  const opp = '22222222-2222-4222-8222-222222222222'
  const app = '44444444-4444-4444-8444-444444444444'
  const last = buildPushPayload('applicant_last_call', {
    title: 'Last day to answer Ana', summary: 'The application to Midfielder closes tomorrow.',
    opportunity_id: opp, application_id: app,
  }, 'x')
  assertEquals(last.title, 'Last day to answer Ana')
  assertEquals(last.body, 'The application to Midfielder closes tomorrow.')
  assertEquals(last.url, `/dashboard/opportunities/${opp}/applicants/${app}`)
  const soon = buildPushPayload('applicants_closing_soon', { title: '3 players are waiting for Club', summary: "Ana's application closes on Tuesday.", opportunity_id: opp }, 'x')
  assertEquals(soon.url, `/dashboard/opportunities/${opp}/applicants`)
  assertEquals(buildPushPayload('applicants_closing_soon', {}, 'x').url, '/opportunities')
  assertEquals(pushPreferenceColumn('applicant_last_call'), 'notify_applications')
  assertEquals(pushPreferenceColumn('applicants_closing_soon'), 'notify_applications')
  assertEquals(pushAllowed('applicant_last_call', { notify_push: true, notify_applications: false }), false)
})

// ── Spanish (localization Stage 2, 2026-11-16) ──
const SPANISH_KINDS = [
  'friend_request_received', 'friend_request_accepted', 'reference_request_received',
  'reference_request_accepted', 'reference_updated', 'reference_request_rejected',
  'ambassador_request_received', 'ambassador_request_accepted', 'brand_offer_approved',
  'brand_offer_not_approved', 'club_invitation_received', 'club_invitation_accepted',
  'profile_viewed', 'profile_comment_created', 'profile_comment_reply', 'profile_comment_like',
  'user_post_comment_received', 'feed_item_comment_received', 'congrats_received', 'signing_tagged',
  'content_removed', 'message_received', 'conversation_started', 'opportunity_published',
  'vacancy_application_received', 'vacancy_application_status', 'recruiting_update',
  'applications_expired', 'profile_completed', 'account_verified', 'system_announcement', 'unknown_kind',
]

Deno.test('Spanish push: every kind has text, the same route and tag as English, and no English left', () => {
  for (const kind of SPANISH_KINDS) {
    const en = buildPushPayload(kind, {}, 'Ana', 'actor-1')
    const es = buildPushPayload(kind, {}, 'Ana', 'actor-1', 'es')
    assertEquals(es.url, en.url, kind)
    assertEquals(es.tag, en.tag, kind)
    if (!es.title || !es.body) throw new Error(`empty Spanish push for ${kind}`)
    if (kind !== 'content_removed' && kind !== 'unknown_kind') {
      if (es.body === en.body) throw new Error(`Spanish body equals English for ${kind}: ${es.body}`)
    }
  }
})

Deno.test('Spanish push: English stays the default and unknown languages read as English', () => {
  assertEquals(buildPushPayload('friend_request_received', {}, 'Ana').body, 'Ana wants to connect')
  assertEquals(pushLanguageOf('es'), 'es')
  assertEquals(pushLanguageOf('fr'), 'en')
  assertEquals(pushLanguageOf(null), 'en')
  assertEquals(unnamedActor('en'), 'A HOCKIA member')
})

Deno.test('Spanish push: application status reads naturally', () => {
  const p = buildPushPayload('vacancy_application_status', {
    status: 'shortlisted', club_name: 'Club Atlético', vacancy_title: 'Arquera para Primera',
  }, 'x', null, 'es')
  assertEquals(p.title, 'Club Atlético te sumó a su preselección')
  assertEquals(p.body, 'Estás en consideración para Arquera para Primera.')
})
