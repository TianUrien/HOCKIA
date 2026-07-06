import { assertEquals, assertMatch, assertNotEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { hashToken, mintRawToken } from './action-tokens.ts'

Deno.test('mintRawToken — base64url, unpadded, unguessable length, unique', () => {
  const a = mintRawToken()
  const b = mintRawToken()
  // 32 bytes → 43 base64url chars, no padding, URL-safe alphabet only
  assertMatch(a, /^[A-Za-z0-9_-]{43}$/)
  assertNotEquals(a, b)
})

Deno.test('hashToken — deterministic SHA-256 hex', async () => {
  // Known vector: sha256("test-token")
  assertEquals(
    await hashToken('test-token'),
    '4c5dc9b7708905f77f5e5d16316b5dfb425e68cb326dcd55a860e90a7707031e',
  )
  const raw = mintRawToken()
  assertEquals(await hashToken(raw), await hashToken(raw))
  assertMatch(await hashToken(raw), /^[0-9a-f]{64}$/)
})
