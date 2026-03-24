/**
 * Firebase Cloud Messaging (FCM) HTTP v1 API client.
 *
 * Uses a Google Service Account to obtain an OAuth2 access token,
 * then sends push notifications via the FCM v1 REST endpoint.
 *
 * Required env vars:
 *   - FCM_PROJECT_ID        (Firebase project ID, e.g. "hockia-1ec3c")
 *   - FCM_CLIENT_EMAIL      (service account email)
 *   - FCM_PRIVATE_KEY       (PEM-encoded RSA private key, with literal \n)
 */

import type { PushPayload } from './push-payload.ts'

const FCM_PROJECT_ID = Deno.env.get('FCM_PROJECT_ID')
const FCM_CLIENT_EMAIL = Deno.env.get('FCM_CLIENT_EMAIL')
const FCM_PRIVATE_KEY_RAW = Deno.env.get('FCM_PRIVATE_KEY')

/** Returns true if all FCM env vars are present */
export function isFcmConfigured(): boolean {
  return !!(FCM_PROJECT_ID && FCM_CLIENT_EMAIL && FCM_PRIVATE_KEY_RAW)
}

// ── JWT / OAuth2 helpers ──

let cachedAccessToken: string | null = null
let tokenExpiresAt = 0

/** Create a signed JWT for the FCM service account */
async function createServiceAccountJwt(): Promise<string> {
  if (!FCM_CLIENT_EMAIL || !FCM_PRIVATE_KEY_RAW) {
    throw new Error('FCM service account credentials not configured')
  }

  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = {
    iss: FCM_CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600, // 1 hour
  }

  const encode = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

  const headerB64 = encode(header)
  const payloadB64 = encode(payload)
  const signingInput = `${headerB64}.${payloadB64}`

  // Import the RSA private key
  const pemKey = FCM_PRIVATE_KEY_RAW.replace(/\\n/g, '\n')
  const pemBody = pemKey
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '')

  const binaryDer = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0))

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryDer.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const signatureBuffer = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(signingInput)
  )

  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

  return `${signingInput}.${signatureB64}`
}

/** Exchange the signed JWT for a short-lived Google OAuth2 access token */
async function getAccessToken(): Promise<string> {
  const now = Date.now()
  if (cachedAccessToken && now < tokenExpiresAt - 60_000) {
    return cachedAccessToken
  }

  const jwt = await createServiceAccountJwt()

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`OAuth2 token exchange failed (${res.status}): ${text}`)
  }

  const data = await res.json()
  cachedAccessToken = data.access_token
  tokenExpiresAt = now + (data.expires_in ?? 3600) * 1000

  return cachedAccessToken!
}

// ── FCM send ──

/**
 * Send a push notification to a single device via FCM HTTP v1 API.
 * Returns true on success, false if the token is invalid/expired (should be cleaned up).
 */
export async function sendFcmNotification(
  fcmToken: string,
  payload: PushPayload
): Promise<boolean> {
  if (!FCM_PROJECT_ID) {
    throw new Error('FCM_PROJECT_ID not configured')
  }

  const accessToken = await getAccessToken()

  const fcmPayload = {
    message: {
      token: fcmToken,
      notification: {
        title: payload.title,
        body: payload.body,
      },
      data: {
        url: payload.url,
        ...(payload.tag ? { tag: payload.tag } : {}),
      },
      // Platform-specific overrides
      android: {
        priority: 'high' as const,
        notification: {
          click_action: 'FCM_PLUGIN_ACTIVITY',
          channel_id: 'hockia_notifications',
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          },
        },
      },
    },
  }

  const url = `https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(fcmPayload),
  })

  if (res.ok) {
    return true
  }

  const errorBody = await res.text()

  // Token invalid/expired/unregistered — caller should clean up
  if (res.status === 404 || res.status === 400) {
    const isInvalidToken =
      errorBody.includes('UNREGISTERED') ||
      errorBody.includes('INVALID_ARGUMENT') ||
      errorBody.includes('NOT_FOUND')

    if (isInvalidToken) {
      console.log(`[fcm] Token invalid/unregistered: ${fcmToken.slice(0, 20)}...`)
      return false
    }
  }

  console.error(`[fcm] Send failed (${res.status}): ${errorBody}`)
  throw new Error(`FCM send failed: ${res.status}`)
}
