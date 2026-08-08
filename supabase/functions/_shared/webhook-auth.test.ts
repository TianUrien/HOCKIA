/**
 * Regression guard for the 2026-08-08 security fix.
 *
 * Two properties are pinned here:
 *   1. assertServiceRole accepts ONLY a service_role JWT.
 *   2. EVERY database-webhook function actually calls it.
 *
 * (2) is the one that matters long-term: the vulnerability existed because
 * the correct fix lived in one function (notify-application, July) and was
 * never ported to its 15 siblings. A structural test is the only thing that
 * stops the next new webhook function from repeating that.
 */

import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { assertServiceRole } from './webhook-auth.ts'

/** Build an unsigned JWT with the given claims (signature is irrelevant here —
 *  the gateway verifies it upstream; we only read the claim). */
function jwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(claims)}.sig`
}

const req = (auth?: string) =>
  new Request('https://x/', { method: 'POST', headers: auth ? { Authorization: auth } : {} })

Deno.test('service_role caller is allowed through', () => {
  assertEquals(assertServiceRole(req(`Bearer ${jwt({ role: 'service_role' })}`)), null)
})

Deno.test('anon key is REJECTED (this was the vulnerability)', async () => {
  const res = assertServiceRole(req(`Bearer ${jwt({ role: 'anon' })}`))
  assertEquals(res?.status, 401)
  assertEquals((await res!.json()).error, 'Unauthorized')
})

Deno.test('a logged-in user token is rejected', () => {
  assertEquals(
    assertServiceRole(req(`Bearer ${jwt({ role: 'authenticated', sub: 'u1' })}`))?.status,
    401,
  )
})

Deno.test('missing / malformed / empty tokens fail closed', () => {
  assertEquals(assertServiceRole(req())?.status, 401)
  assertEquals(assertServiceRole(req('Bearer not-a-jwt'))?.status, 401)
  assertEquals(assertServiceRole(req('Bearer '))?.status, 401)
  assertEquals(assertServiceRole(req(`Bearer ${jwt({})}`))?.status, 401)
})

Deno.test('role claim cannot be smuggled via a nested object', () => {
  assertEquals(
    assertServiceRole(req(`Bearer ${jwt({ role: 'anon', app_metadata: { role: 'service_role' } })}`))
      ?.status,
    401,
  )
})

/**
 * STRUCTURAL: every function invoked by a database webhook must call the
 * guard. Update WEBHOOK_FUNCTIONS when a new webhook trigger is added — the
 * test then forces the guard to be wired up too.
 */
const WEBHOOK_FUNCTIONS = [
  'send-push', 'notify-age-gate', 'notify-vacancy', 'notify-friend-request',
  'notify-reference-request', 'notify-reference-response', 'notify-opportunity-renewal',
  'notify-application-digest', 'notify-message-digest', 'notify-profile-views',
  'notify-application-status', 'notify-application-expiry', 'notify-application',
  'notify-reference-reminder', 'admin-market-digest',
]

Deno.test('every webhook function calls assertServiceRole', async () => {
  const missing: string[] = []
  for (const fn of WEBHOOK_FUNCTIONS) {
    const src = await Deno.readTextFile(new URL(`../${fn}/index.ts`, import.meta.url))
    if (!src.includes('assertServiceRole(req)')) missing.push(fn)
  }
  assertEquals(
    missing,
    [],
    `These webhook functions are callable by anyone holding the PUBLIC anon key: ${missing.join(', ')}`,
  )
})
