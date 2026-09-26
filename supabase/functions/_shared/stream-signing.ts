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
  const jwk = JSON.parse(atob(jwkBase64.trim())) as JsonWebKey
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  cachedKey = { id: keyId, key }
  return key
}

/** Signs a Stream playback token for `videoUid`, valid until `expSeconds` (epoch s). */
export async function signStreamToken(videoUid: string, expSeconds: number, rawKeyId: string, jwkBase64: string): Promise<string> {
  const keyId = rawKeyId.trim()
  const key = await importSigningKey(keyId, jwkBase64)
  const header = b64url(enc.encode(JSON.stringify({ alg: 'RS256', kid: keyId })))
  // Same claims as a token from Cloudflare's token API (sub, kid, exp, nbf).
  const nbf = Math.floor(Date.now() / 1000) - 60
  const payload = b64url(enc.encode(JSON.stringify({ sub: videoUid, kid: keyId, exp: expSeconds, nbf })))
  const data = enc.encode(`${header}.${payload}`)
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, data))
  return `${header}.${payload}.${b64url(sig)}`
}

/**
 * Local signing is OPT-IN: both secrets AND CF_STREAM_LOCAL_SIGNING=on.
 * Setting the key secrets alone must never switch production over — on
 * 2026-09-24 a key Cloudflare rejected (401 on every poster and stream)
 * went live the moment the secrets were set. Turn the flag on per project
 * only after a signed poster is verified to load there.
 */
export function localSigningConfig(): { keyId: string; jwk: string } | null {
  if ((Deno.env.get('CF_STREAM_LOCAL_SIGNING') ?? '').toLowerCase() !== 'on') return null
  // Trim: a secret pasted with a trailing newline names a key that doesn't
  // exist, and Cloudflare answers 401 (2026-09-24: 33-char key id).
  const keyId = Deno.env.get('CF_STREAM_KEY_ID')?.trim()
  const jwk = Deno.env.get('CF_STREAM_JWK')?.trim()
  return keyId && jwk ? { keyId, jwk } : null
}
