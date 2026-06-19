/**
 * GA4 Data API client (read-only) for the Admin acquisition funnel.
 *
 * Uses a Google Service Account to obtain an OAuth2 access token, then calls the
 * Analytics Data API `runReport` endpoint. Pure Web Crypto — no SDK, no deps.
 * The JWT/OAuth flow is cloned from send-push/fcm.ts (same pattern, in prod today).
 *
 * Required secrets (all three, or it stays not-configured and the function
 * returns a clean sentinel instead of erroring):
 *   - GA4_PROPERTY_ID       numeric GA4 property id (NOT the G- measurement id)
 *   - GA4_SA_CLIENT_EMAIL   service account email
 *   - GA4_SA_PRIVATE_KEY    PEM PKCS8 private key (with literal \n escapes)
 */

const GA4_PROPERTY_ID = Deno.env.get('GA4_PROPERTY_ID')
const GA4_SA_CLIENT_EMAIL = Deno.env.get('GA4_SA_CLIENT_EMAIL')
const GA4_SA_PRIVATE_KEY_RAW = Deno.env.get('GA4_SA_PRIVATE_KEY')

/** True only when all three GA4 secrets are present. */
export function isGa4Configured(): boolean {
  return !!(GA4_PROPERTY_ID && GA4_SA_CLIENT_EMAIL && GA4_SA_PRIVATE_KEY_RAW)
}

// ── JWT / OAuth2 helpers (cloned from send-push/fcm.ts) ──

let cachedAccessToken: string | null = null
let tokenExpiresAt = 0

async function createServiceAccountJwt(): Promise<string> {
  if (!GA4_SA_CLIENT_EMAIL || !GA4_SA_PRIVATE_KEY_RAW) {
    throw new Error('GA4 service account credentials not configured')
  }

  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = {
    iss: GA4_SA_CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/analytics.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }

  const encode = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

  const signingInput = `${encode(header)}.${encode(payload)}`

  // Google SA keys are PKCS8 (-----BEGIN PRIVATE KEY-----). Un-escape literal \n.
  const pemBody = GA4_SA_PRIVATE_KEY_RAW.replace(/\\n/g, '\n')
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '')

  const binaryDer = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0))

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryDer.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const signatureBuffer = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(signingInput),
  )

  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

  return `${signingInput}.${signatureB64}`
}

async function getAccessToken(): Promise<string> {
  const now = Date.now()
  if (cachedAccessToken && now < tokenExpiresAt - 60_000) return cachedAccessToken

  const jwt = await createServiceAccountJwt()
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  })
  if (!res.ok) {
    throw new Error(`OAuth2 token exchange failed (${res.status}): ${await res.text()}`)
  }
  const data = await res.json()
  cachedAccessToken = data.access_token
  tokenExpiresAt = now + (data.expires_in ?? 3600) * 1000
  return cachedAccessToken!
}

// ── runReport ──

export interface Ga4FunnelCounts {
  page_view_landing: number
  signup_cta_click: number
  protected_action_blocked: number
  signup_wall_action_clicked: number
  sign_up_start: number
}

const FUNNEL_EVENTS = [
  'signup_cta_click',
  'protected_action_blocked',
  'signup_wall_action_clicked',
  'sign_up_start',
] as const

interface RunReportResponse {
  rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[]
}

async function runReport(token: string, body: unknown): Promise<RunReportResponse> {
  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${GA4_PROPERTY_ID}:runReport`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  if (!res.ok) throw new Error(`GA4 runReport ${res.status}: ${await res.text()}`)
  return await res.json() as RunReportResponse
}

/**
 * Fetch the anonymous top-of-funnel event counts over the last `days`.
 * Two reports: one for the four funnel events (eventName inList), one for
 * landing page_view (eventName=page_view AND pagePath=/). Combining them in one
 * report would multiply the eventName×pagePath grid and inflate counts.
 *
 * GA4 omits zero rows, so we zero-seed and overlay — an absent event stays 0,
 * and "(other)" rows can't corrupt counts (we only read expected names).
 */
export async function fetchGa4Funnel(days: number): Promise<Ga4FunnelCounts> {
  const token = await getAccessToken()
  const dateRanges = [{ startDate: `${days}daysAgo`, endDate: 'today' }]

  const reportA = await runReport(token, {
    dateRanges,
    dimensions: [{ name: 'eventName' }],
    metrics: [{ name: 'eventCount' }],
    limit: '50',
    dimensionFilter: {
      filter: {
        fieldName: 'eventName',
        inListFilter: { values: [...FUNNEL_EVENTS], caseSensitive: true },
      },
    },
  })

  const reportB = await runReport(token, {
    dateRanges,
    dimensions: [{ name: 'eventName' }],
    metrics: [{ name: 'eventCount' }],
    limit: '10',
    dimensionFilter: {
      andGroup: {
        expressions: [
          { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'page_view', caseSensitive: true } } },
          { filter: { fieldName: 'pagePath', stringFilter: { matchType: 'EXACT', value: '/' } } },
        ],
      },
    },
  })

  const counts: Ga4FunnelCounts = {
    page_view_landing: 0,
    signup_cta_click: 0,
    protected_action_blocked: 0,
    signup_wall_action_clicked: 0,
    sign_up_start: 0,
  }
  for (const r of (reportA.rows ?? [])) {
    const name = r.dimensionValues[0]?.value
    if (name && name in counts) {
      (counts as unknown as Record<string, number>)[name] = Number(r.metricValues[0]?.value ?? 0)
    }
  }
  counts.page_view_landing = Number(reportB.rows?.[0]?.metricValues[0]?.value ?? 0)
  return counts
}
