/**
 * Pure helpers for the auth-guard function: request parsing, a coarse device
 * label, and the Cloudflare Turnstile check. No Deno or Supabase imports, so
 * they run under `deno test` without a network.
 */

export const GUARD_KINDS = ['oauth_start', 'password_signin', 'signup', 'magic_link', 'password_reset'] as const
export type GuardKind = typeof GUARD_KINDS[number]

export const REPORT_KINDS = ['password_signin_failed'] as const
export type ReportKind = typeof REPORT_KINDS[number]

const PROVIDERS = new Set(['apple', 'google', 'facebook'])
const PLATFORMS = new Set(['web', 'pwa', 'ios', 'android'])

export interface GuardRequest {
  action: 'check' | 'report'
  kind: GuardKind | ReportKind
  provider: string | null
  captchaToken: string | null
  platform: string | null
  appVersion: string | null
  installId: string | null
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : null
}

/** The request body as the function understands it, or null when it is not one. */
export function parseGuardRequest(body: unknown): GuardRequest | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  const action = b.action === 'report' ? 'report' : b.action === 'check' ? 'check' : null
  if (!action) return null
  const kinds: readonly string[] = action === 'check' ? GUARD_KINDS : REPORT_KINDS
  if (typeof b.kind !== 'string' || !kinds.includes(b.kind)) return null
  const client = (b.client && typeof b.client === 'object' ? b.client : {}) as Record<string, unknown>
  const provider = text(b.provider, 20)
  const platform = text(client.platform, 12)
  return {
    action,
    kind: b.kind as GuardKind | ReportKind,
    provider: provider && PROVIDERS.has(provider) ? provider : null,
    captchaToken: text(b.captchaToken, 4096),
    platform: platform && PLATFORMS.has(platform) ? platform : null,
    appVersion: text(client.appVersion, 20),
    installId: text(client.installId, 64),
  }
}

/** The caller's address as the platform reports it (never stored; hashed in the database). */
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || headers.get('cf-connecting-ip') || null
}

/**
 * A short, coarse description of the device from its user agent: system,
 * major version and, on Android, the model. Meant for an admin to recognise
 * "the same kind of device again", not to identify a person.
 */
export function deviceLabel(userAgent: string | null): string {
  const ua = userAgent ?? ''
  if (!ua) return 'unknown'
  const android = ua.match(/Android (\d+)[^;)]*;\s*([^;)]+?)(?:\s+Build\/[^;)]*)?[;)]/)
  if (android) {
    const model = android[2].trim()
    const webview = /; wv\)/.test(ua) ? ' · WebView' : ''
    return `Android ${android[1]} · ${model === 'K' ? 'model hidden' : model}${webview}`.slice(0, 80)
  }
  const ios = ua.match(/(iPhone|iPad|iPod)[^)]*OS (\d+)/)
  if (ios) return `${ios[1]} · iOS ${ios[2]}`
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : null
  const system = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : null
  if (browser || system) return `${system ?? 'Other'} · ${browser ?? 'other browser'}`
  return 'other'
}

export type CaptchaVerdict = 'none' | 'valid' | 'invalid' | 'unavailable'

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/**
 * Ask Cloudflare whether a Turnstile token is good.
 *   no token             -> 'none'
 *   no secret configured -> 'unavailable' (a missing setting must not lock people out)
 *   Cloudflare unreachable or answering 5xx -> 'unavailable'
 */
export async function verifyTurnstile(
  token: string | null,
  secret: string | undefined,
  ip: string | null,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 4000,
): Promise<CaptchaVerdict> {
  if (!token) return 'none'
  if (!secret) return 'unavailable'
  const form = new URLSearchParams({ secret, response: token })
  if (ip) form.set('remoteip', ip)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(SITEVERIFY_URL, { method: 'POST', body: form, signal: controller.signal })
    if (res.status >= 500) return 'unavailable'
    const data = await res.json() as { success?: boolean }
    return data?.success === true ? 'valid' : 'invalid'
  } catch {
    return 'unavailable'
  } finally {
    clearTimeout(timer)
  }
}
