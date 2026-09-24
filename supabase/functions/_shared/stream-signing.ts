// Local signing of Cloudflare Stream playback tokens.
//
// The Stream token API costs a network round trip to Cloudflare per video
// (~0.7–1 s from the edge), which dominated thumbnail time on a cold profile.
// Cloudflare's documented alternative is to sign the token ourselves with a
// Stream signing key: an RS256 JWT whose `kid` names the key and whose `sub`
// is the video UID. Same token, same delivery URLs, no network call.
//
// Keys: POST /accounts/{account}/stream/keys returns { id, jwk } where `jwk`
// is a base64-encoded JWK. Store them as CF_STREAM_KEY_ID / CF_STREAM_JWK.
// Without both secrets the caller falls back to the token API.

function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const enc = new TextEncoder()

let cachedKey: { id: string; key: CryptoKey } | null = null

async function importSigningKey(keyId: string, jwkBase64: string): Promise<CryptoKey> {
  if (cachedKey?.id === keyId) return cachedKey.key
  const jwk = JSON.parse(atob(jwkBase64)) as JsonWebKey
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  cachedKey = { id: keyId, key }
  return key
}

/** Signs a Stream playback token for `videoUid`, valid until `expSeconds` (epoch s). */
export async function signStreamToken(videoUid: string, expSeconds: number, keyId: string, jwkBase64: string): Promise<string> {
  const key = await importSigningKey(keyId, jwkBase64)
  const header = b64url(enc.encode(JSON.stringify({ alg: 'RS256', kid: keyId })))
  const payload = b64url(enc.encode(JSON.stringify({ sub: videoUid, kid: keyId, exp: expSeconds })))
  const data = enc.encode(`${header}.${payload}`)
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, data))
  return `${header}.${payload}.${b64url(sig)}`
}

/** Both secrets present → local signing is on. */
export function localSigningConfig(): { keyId: string; jwk: string } | null {
  const keyId = Deno.env.get('CF_STREAM_KEY_ID')
  const jwk = Deno.env.get('CF_STREAM_JWK')
  return keyId && jwk ? { keyId, jwk } : null
}
