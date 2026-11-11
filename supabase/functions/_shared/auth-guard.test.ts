import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { clientIp, deviceLabel, parseGuardRequest, verifyTurnstile } from './auth-guard.ts'

Deno.test('parseGuardRequest accepts a check and keeps only known values', () => {
  const r = parseGuardRequest({
    action: 'check', kind: 'oauth_start', provider: 'apple', captchaToken: ' tok ',
    client: { platform: 'android', appVersion: '1.26', installId: 'abc', extra: 'x' },
  })
  assertEquals(r, {
    action: 'check', kind: 'oauth_start', provider: 'apple', captchaToken: 'tok',
    platform: 'android', appVersion: '1.26', installId: 'abc',
  })
})

Deno.test('parseGuardRequest drops unknown providers and platforms', () => {
  const r = parseGuardRequest({ action: 'check', kind: 'signup', provider: 'discord', client: { platform: 'tv' } })
  assertEquals(r?.provider, null)
  assertEquals(r?.platform, null)
})

Deno.test('parseGuardRequest refuses unknown actions and kinds', () => {
  assertEquals(parseGuardRequest(null), null)
  assertEquals(parseGuardRequest({ action: 'delete', kind: 'signup' }), null)
  assertEquals(parseGuardRequest({ action: 'check', kind: 'password_signin_failed' }), null)
  assertEquals(parseGuardRequest({ action: 'report', kind: 'signup' }), null)
  assertEquals(parseGuardRequest({ action: 'report', kind: 'password_signin_failed' })?.action, 'report')
})

Deno.test('parseGuardRequest caps long values', () => {
  const r = parseGuardRequest({ action: 'check', kind: 'signup', client: { installId: 'x'.repeat(500), appVersion: 'y'.repeat(99) } })
  assertEquals(r?.installId?.length, 64)
  assertEquals(r?.appVersion?.length, 20)
})

Deno.test('clientIp prefers the address Cloudflare sets', () => {
  assertEquals(clientIp(new Headers({ 'cf-connecting-ip': '203.0.113.8' })), '203.0.113.8')
  assertEquals(
    clientIp(new Headers({ 'cf-connecting-ip': '203.0.113.8', 'x-forwarded-for': '203.0.113.8' })),
    '203.0.113.8',
  )
})

Deno.test('clientIp ignores a forged leading forwarded entry', () => {
  // A caller-supplied entry in front of the real one must not become the identity.
  assertEquals(
    clientIp(new Headers({ 'cf-connecting-ip': '203.0.113.8', 'x-forwarded-for': '198.51.100.99, 203.0.113.8' })),
    '203.0.113.8',
  )
  assertEquals(
    clientIp(new Headers({ 'cf-connecting-ip': '203.0.113.8', 'x-forwarded-for': '198.51.100.99' })),
    '203.0.113.8',
  )
})

Deno.test('clientIp falls back to the first forwarded address, then to none', () => {
  assertEquals(clientIp(new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' })), '203.0.113.7')
  assertEquals(clientIp(new Headers({ 'cf-connecting-ip': '  ', 'x-forwarded-for': '203.0.113.7' })), '203.0.113.7')
  assertEquals(clientIp(new Headers()), null)
})

Deno.test('deviceLabel is coarse: system, major version, Android model', () => {
  assertEquals(
    deviceLabel('Mozilla/5.0 (Linux; Android 11; IN2023 Build/RP1A.201005.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/91.0 Mobile Safari/537.36'),
    'Android 11 · IN2023 · WebView',
  )
  assertEquals(
    deviceLabel('Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'),
    'Android 10 · model hidden',
  )
  assertEquals(
    deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'),
    'iPhone · iOS 18',
  )
  assertEquals(
    deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'),
    'Mac · Safari',
  )
  assertEquals(deviceLabel('curl/8.4.0'), 'other')
  assertEquals(deviceLabel(null), 'unknown')
})

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (() => Promise.resolve(new Response(JSON.stringify(body), { status }))) as unknown as typeof fetch
}

Deno.test('verifyTurnstile: no token is "none", no secret is "unavailable"', async () => {
  assertEquals(await verifyTurnstile(null, 'secret', null, fakeFetch(200, { success: true })), 'none')
  assertEquals(await verifyTurnstile('tok', undefined, null, fakeFetch(200, { success: true })), 'unavailable')
})

Deno.test('verifyTurnstile: Cloudflare decides valid or invalid', async () => {
  assertEquals(await verifyTurnstile('tok', 'secret', '203.0.113.7', fakeFetch(200, { success: true })), 'valid')
  assertEquals(await verifyTurnstile('tok', 'secret', null, fakeFetch(200, { success: false, 'error-codes': ['timeout-or-duplicate'] })), 'invalid')
})

Deno.test('verifyTurnstile: an outage never counts against the person', async () => {
  assertEquals(await verifyTurnstile('tok', 'secret', null, fakeFetch(503, {})), 'unavailable')
  const failing = (() => Promise.reject(new Error('network'))) as unknown as typeof fetch
  assertEquals(await verifyTurnstile('tok', 'secret', null, failing), 'unavailable')
})

Deno.test('verifyTurnstile sends the secret, the token and the address', async () => {
  let sent: URLSearchParams | null = null
  const spy = ((_url: string, init: RequestInit) => {
    sent = init.body as URLSearchParams
    return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }))
  }) as unknown as typeof fetch
  await verifyTurnstile('tok', 'secret', '203.0.113.7', spy)
  assertEquals(sent!.get('secret'), 'secret')
  assertEquals(sent!.get('response'), 'tok')
  assertEquals(sent!.get('remoteip'), '203.0.113.7')
})
