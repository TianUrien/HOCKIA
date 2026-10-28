Deno.env.set('PUBLIC_SITE_URL', 'https://staging.inhockia.com')
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { DIGEST_SPREAD_MAX_MS, DIGEST_SPREAD_MIN_MS, digestSpreadMs } from './profile-views-email.ts'

Deno.test('digest spread: about 5 sends a second for the batch (2026-10-28)', () => {
  assertEquals(digestSpreadMs(122), 25_000) // the 2026-10-26 batch that hit Resend's 10/s
  assertEquals(digestSpreadMs(300), 60_000)
})

Deno.test('digest spread: never below the old 8 s, never past the cap', () => {
  assertEquals(digestSpreadMs(1), DIGEST_SPREAD_MIN_MS)
  assertEquals(digestSpreadMs(0), DIGEST_SPREAD_MIN_MS)
  assertEquals(digestSpreadMs(5_000), DIGEST_SPREAD_MAX_MS)
})

Deno.test('digest spread: an unknown batch size still spreads wide (30 s)', () => {
  assertEquals(digestSpreadMs(null), 30_000)
})
