/**
 * Asks the auth-guard edge function before a sign-in or sign-up starts, and
 * tells it when a password sign-in fails (brief 2026-11-11, after automated
 * OAuth starts in production).
 *
 * The server records the attempt (network and device as hashes) and, only
 * when a runtime switch is on, may refuse: too many attempts from this device
 * or network, or a bot check is required. Both switches default to off, so
 * today this only measures.
 *
 * It FAILS OPEN: a timeout, a network error, a missing function or any
 * unexpected answer lets the person through. Supabase Auth still enforces its
 * own limits behind it; this must never be the reason a member can't sign in.
 * Store builds that predate this file don't call the function at all.
 */

import { getCaptchaToken, CAPTCHA_FAILED_COPY } from '@/lib/captcha'
import { getAnonymousId } from '@/lib/analyticsIdentity'
import { getAppVersion, getRuntimePlatform } from '@/lib/appVersion'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase'

export type GuardKind = 'oauth_start' | 'password_signin' | 'signup' | 'magic_link' | 'password_reset'

export interface GuardDecision {
  allowed: boolean
  reason?: 'rate_limited' | 'captcha_failed'
  /** Plain words for the screen when refused. */
  message?: string
}

/** Longest the sign-in button waits for the guard before carrying on. */
const GUARD_TIMEOUT_MS = 2500

const ALLOWED: GuardDecision = { allowed: true }

/** Unit tests of other screens must not reach the network; the guard's own tests turn it on. */
let enabledInTests = false
export function setAuthGuardEnabledForTests(on: boolean): void {
  enabledInTests = on
}

function active(): boolean {
  if (import.meta.env.MODE === 'test' && !enabledInTests) return false
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY) && typeof fetch === 'function'
}

async function clientInfo(): Promise<{ platform: string; appVersion: string | null; installId: string | null }> {
  const runtime = getRuntimePlatform()
  const platform = runtime === 'ios-native' ? 'ios' : runtime === 'android-native' ? 'android' : runtime
  let appVersion: string | null = null
  let installId: string | null = null
  try { appVersion = (await getAppVersion())?.version ?? null } catch { /* web has none */ }
  try { installId = getAnonymousId() } catch { /* storage blocked */ }
  return { platform, appVersion, installId }
}

async function post(body: Record<string, unknown>, keepalive = false): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), GUARD_TIMEOUT_MS)
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/auth-guard`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY as string,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      keepalive,
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** "Too many attempts" with the wait the server gave, rounded up to minutes. */
export function rateLimitedCopy(retryAfterSeconds: number | null | undefined): string {
  const minutes = Math.ceil((retryAfterSeconds ?? 0) / 60)
  if (minutes <= 1) return 'Too many attempts. Please try again in a minute.'
  return `Too many attempts. Please try again in ${minutes} minutes.`
}

function decide(answer: unknown): GuardDecision | 'captcha_required' {
  const a = answer as { allowed?: boolean; reason?: string; retryAfter?: number | null } | null
  if (!a || a.allowed !== false) return ALLOWED
  if (a.reason === 'captcha_required') return 'captcha_required'
  if (a.reason === 'captcha_failed') return { allowed: false, reason: 'captcha_failed', message: CAPTCHA_FAILED_COPY }
  if (a.reason === 'rate_limited') return { allowed: false, reason: 'rate_limited', message: rateLimitedCopy(a.retryAfter) }
  return ALLOWED
}

/**
 * May this attempt start? Resolves within a few seconds, always. When the
 * server asks for a bot check, gets one token and asks once more.
 */
export async function guardCheck(kind: GuardKind, provider?: string): Promise<GuardDecision> {
  if (!active()) return ALLOWED
  try {
    const client = await clientInfo()
    const first = decide(await post({ action: 'check', kind, provider, client }))
    if (first !== 'captcha_required') return first
    const captchaToken = await getCaptchaToken('guard')
    if (!captchaToken) return { allowed: false, reason: 'captcha_failed', message: CAPTCHA_FAILED_COPY }
    const second = decide(await post({ action: 'check', kind, provider, captchaToken, client }))
    return second === 'captcha_required' ? ALLOWED : second
  } catch {
    return ALLOWED
  }
}

/** A password sign-in was refused for wrong credentials. Fire-and-forget. */
export function guardReportFailedSignIn(): void {
  if (!active()) return
  void clientInfo()
    .then((client) => post({ action: 'report', kind: 'password_signin_failed', client }, true))
    .catch(() => { /* measurement only */ })
}

/** Thrown by the OAuth start when the guard refuses; `message` is ready for the screen. */
export class AuthGuardRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthGuardRefused'
  }
}
