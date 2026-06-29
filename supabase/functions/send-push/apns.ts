/**
 * Apple Push Notification service (APNs) HTTP/2 client.
 *
 * Sends pushes DIRECTLY to Apple for iOS devices. iOS (via @capacitor/push-
 * notifications) registers an APNs device token — NOT an FCM token — so the
 * FCM path can't deliver to it. This module talks to APNs directly, authed with
 * a JWT signed by an APNs Auth Key (.p8, ES256). No certificates, no Firebase.
 *
 * Required env vars (set via `supabase secrets set`):
 *   - APNS_KEY_ID        the 10-char Key ID of the .p8 auth key
 *   - APNS_PRIVATE_KEY   the .p8 contents (PEM PKCS8 EC P-256 key, literal \n)
 *   - APNS_TEAM_ID       Apple Developer Team ID (default: TXN8KM3Q3B)
 *   - APNS_BUNDLE_ID     apns-topic = app bundle id (default: com.inhockia.app)
 *   - APNS_PRODUCTION    'false' → sandbox host; anything else → production
 *                        (App Store builds use the production APNs environment)
 */

import type { PushPayload } from './push-payload.ts'

const APNS_KEY_ID = Deno.env.get('APNS_KEY_ID')
const APNS_PRIVATE_KEY_RAW = Deno.env.get('APNS_PRIVATE_KEY')
const APNS_TEAM_ID = Deno.env.get('APNS_TEAM_ID') || 'TXN8KM3Q3B'
const APNS_BUNDLE_ID = Deno.env.get('APNS_BUNDLE_ID') || 'com.inhockia.app'
const APNS_HOST = Deno.env.get('APNS_PRODUCTION') === 'false'
  ? 'api.sandbox.push.apple.com'
  : 'api.push.apple.com'

/** True only when the APNs auth key + key id + team id are all present. */
export function isApnsConfigured(): boolean {
  return !!(APNS_KEY_ID && APNS_PRIVATE_KEY_RAW && APNS_TEAM_ID)
}

// ── Provider JWT (ES256). Cached — Apple rejects regenerating too often. ──

let cachedJwt: string | null = null
let jwtGeneratedAt = 0

function b64urlString(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlBytes(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function createProviderJwt(): Promise<string> {
  // APNs provider tokens are valid up to 1h; reuse for 50 min (Apple rate-limits
  // regeneration — too-frequent renewal returns TooManyProviderTokenUpdates).
  const now = Date.now()
  if (cachedJwt && now - jwtGeneratedAt < 50 * 60 * 1000) return cachedJwt

  if (!APNS_KEY_ID || !APNS_PRIVATE_KEY_RAW) {
    throw new Error('APNs credentials not configured')
  }

  const header = b64urlString(JSON.stringify({ alg: 'ES256', kid: APNS_KEY_ID }))
  const claims = b64urlString(JSON.stringify({ iss: APNS_TEAM_ID, iat: Math.floor(now / 1000) }))
  const signingInput = `${header}.${claims}`

  // The .p8 is a PKCS8-wrapped EC (P-256) private key.
  const pemBody = APNS_PRIVATE_KEY_RAW.replace(/\\n/g, '\n')
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '')
  const der = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0))

  const key = await crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )

  // Web Crypto ECDSA returns the raw r||s (IEEE P1363) signature — exactly what
  // JWS ES256 expects (no DER unwrapping needed).
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signingInput),
  )

  cachedJwt = `${signingInput}.${b64urlBytes(new Uint8Array(signature))}`
  jwtGeneratedAt = now
  return cachedJwt
}

/**
 * Send a push to a single iOS device via APNs HTTP/2.
 * Returns true on success, false if the token is invalid/expired (caller should
 * delete it). Throws on a transient/unexpected failure so the caller logs it.
 */
export async function sendApnsNotification(
  deviceToken: string,
  payload: PushPayload,
): Promise<boolean> {
  const jwt = await createProviderJwt()

  const apnsPayload = {
    aps: {
      alert: { title: payload.title, body: payload.body },
      sound: 'default',
      badge: payload.badge ?? 1,
    },
    // Custom keys the app reads on tap (deep-link target + coalescing tag).
    url: payload.url,
    ...(payload.tag ? { tag: payload.tag } : {}),
  }

  const headers: Record<string, string> = {
    authorization: `bearer ${jwt}`,
    'apns-topic': APNS_BUNDLE_ID,
    'apns-push-type': 'alert',
    'apns-priority': '10',
  }
  // collapse-id replaces a prior unread push of the same kind (≤ 64 bytes).
  if (payload.tag) headers['apns-collapse-id'] = payload.tag.slice(0, 64)

  // Deno's fetch negotiates HTTP/2 with api.push.apple.com (APNs requires it).
  const res = await fetch(`https://${APNS_HOST}/3/device/${deviceToken}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(apnsPayload),
  })

  if (res.status === 200) return true

  const bodyText = await res.text()
  // 410 Unregistered, or 400 BadDeviceToken/DeviceTokenNotForTopic → dead token.
  if (
    res.status === 410 ||
    (res.status === 400 && /BadDeviceToken|Unregistered|DeviceTokenNotForTopic/.test(bodyText))
  ) {
    console.log(`[apns] Invalid/expired token ${deviceToken.slice(0, 12)}…: ${res.status} ${bodyText}`)
    return false
  }

  console.error(`[apns] Send failed (${res.status}): ${bodyText}`)
  throw new Error(`APNs send failed: ${res.status}`)
}
