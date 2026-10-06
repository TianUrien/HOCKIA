import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { buildPushPayload, isGeneratedHeadline } from '../send-push/push-payload.ts'

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
  assertEquals(filled.body, 'Senior men 1st XI midfielder has been filled. Thanks for applying — new roles are open.')
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
  assertEquals(barePosition.body, 'Goalkeeper has been filled. Thanks for applying — new roles are open.')

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
