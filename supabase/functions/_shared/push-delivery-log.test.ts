import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { type DeliveryRow, failureSummary, notificationIdOf, platformOf, providerDetail } from '../send-push/delivery-log.ts'

const row = (platform: DeliveryRow['platform'], outcome: DeliveryRow['outcome'], detail: string | null = null): DeliveryRow =>
  ({ notification_id: null, recipient_profile_id: 'p1', kind: 'message_received', platform, outcome, detail })

Deno.test('platformOf: a native token is ios or android, anything else is web', () => {
  assertEquals(platformOf({ fcm_token: 'abc', platform: 'ios' }), 'ios')
  assertEquals(platformOf({ fcm_token: 'abc', platform: 'android' }), 'android')
  assertEquals(platformOf({ fcm_token: 'abc', platform: null }), 'android')
  assertEquals(platformOf({ fcm_token: 'abc', platform: 'web' }), 'web')
  assertEquals(platformOf({ fcm_token: null, platform: 'ios' }), 'web')
})

Deno.test('notificationIdOf: only a real uuid is kept', () => {
  assertEquals(notificationIdOf({ id: '48111dbd-cce7-4ed3-991d-9d46d2959a48' }), '48111dbd-cce7-4ed3-991d-9d46d2959a48')
  assertEquals(notificationIdOf({ id: 'grouped' }), null)
  assertEquals(notificationIdOf({}), null)
  assertEquals(notificationIdOf(null), null)
})

Deno.test('providerDetail: keeps the status and the reason', () => {
  assertEquals(providerDetail(new Error('APNs send failed: 500')), 'APNs send failed: 500')
  assertEquals(providerDetail({ statusCode: 403, message: 'Received unexpected response code' }), '403 Received unexpected response code')
  assertEquals(providerDetail(undefined), null)
})

Deno.test('providerDetail: never stores a link or a device token', () => {
  const token = 'dQw4w9WgXcQ:APA91bHun4MxP5egoKMwt2KZFBaFUH-1RYqx_abcdefghijklmnop'
  const detail = providerDetail(new Error(`Failed for ${token} at https://fcm.googleapis.com/fcm/send/${token}`))
  assertEquals(detail, 'Failed for [token] at [link]')
  assertEquals((providerDetail(new Error('x '.repeat(400))) ?? '').length <= 200, true)
})

Deno.test('failureSummary: nothing to report when no device failed', () => {
  assertEquals(failureSummary('message_received', [row('ios', 'sent'), row('web', 'rejected'), row('android', 'rate_limited')]), null)
  assertEquals(failureSummary('message_received', []), null)
})

Deno.test('failureSummary: counts failed devices by platform and names the first reason', () => {
  const rows = [row('ios', 'failed', 'APNs send failed: 500'), row('ios', 'failed', 'APNs send failed: 500'), row('android', 'sent'), row('web', 'failed', '403 x')]
  assertEquals(
    failureSummary('message_received', rows),
    'send-push: 3 of 4 device(s) failed for message_received (ios 2, web 1): APNs send failed: 500',
  )
})
