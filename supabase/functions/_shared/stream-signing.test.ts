import { assert, assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { signStreamToken } from './stream-signing.ts'

function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
  return new Uint8Array(Array.from(atob(b64), (c) => c.charCodeAt(0)))
}

Deno.test('signStreamToken produces an RS256 JWT Cloudflare can verify with the public key', async () => {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
  const token = await signStreamToken('video-uid-123', 2_000_000_000, 'key-abc', btoa(JSON.stringify(jwk)))
  const [h, p, s] = token.split('.')
  const header = JSON.parse(new TextDecoder().decode(b64urlDecode(h)))
  const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(p)))
  assertEquals(header, { alg: 'RS256', kid: 'key-abc' })
  assertEquals(payload, { sub: 'video-uid-123', kid: 'key-abc', exp: 2_000_000_000 })
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', pair.publicKey, b64urlDecode(s), new TextEncoder().encode(`${h}.${p}`))
  assert(ok)
})
