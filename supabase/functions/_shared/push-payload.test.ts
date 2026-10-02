import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { buildPushPayload } from '../send-push/push-payload.ts'

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
