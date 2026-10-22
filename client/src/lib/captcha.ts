/**
 * Bot check for sign-in, sign-up and password emails (Cloudflare Turnstile,
 * free). Ruling 2026-10-19 after an automated password-guessing burst (116
 * attempts from 4 addresses in an hour): two steps, nobody locked out —
 * 1. the app sends a Turnstile token with every auth call (this file);
 * 2. Supabase Auth enforces it only once store builds carrying step 1 are out.
 *
 * One invisible widget for the whole app: `getCaptchaToken(action)` renders a
 * fresh single-use token on demand. It stays invisible for real people; only
 * when Cloudflare wants a human check does a small card appear at the bottom.
 * Keys: the real HOCKIA key against production; Cloudflare's always-pass
 * test key on staging and local dev (Supabase staging enforces with the
 * matching test secret), so automation keeps working.
 *
 * 2026-10-21 (sign-in timeouts): the host box stays rendered (an iframe in a
 * display:none box may never run its check in some WebViews), a widget that
 * a newer one replaces is settled quietly instead of timing out, a failed
 * attempt is retried once with a fresh widget and a fresh script tag, and
 * Sentry hears about it once per request with the attempt count and reasons.
 * Callers still send their auth request without a token (the server
 * decides); the screens turn a captcha refusal into a "Try again" state.
 */

import * as Sentry from '@sentry/react'

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string
  remove: (id: string) => void
}
declare global { interface Window { turnstile?: TurnstileApi } }

export type CaptchaAction = 'login' | 'signup' | 'reset' | 'magic_link' | 'resend' | 'reverify'

/** Outcome of asking for a token: the token, or why there is none, and how many widgets were tried. */
export type CaptchaResult = { token?: string; reason?: string; attempts: number }

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
const SCRIPT_TIMEOUT_MS = 10000
/** No token and no visible check: give up on this widget and try a fresh one. */
const TOKEN_TIMEOUT_MS = 12000
/** A visible "confirm you're human" check is on screen: the person is responding, give them time. */
const INTERACTIVE_TIMEOUT_MS = 60000
/** Widgets tried per request before the server decides (one retry with a fresh widget). */
const MAX_ATTEMPTS = 2

/**
 * Not a fault: the person left a visible check unanswered, the app went to
 * the background, or a newer request replaced the widget. None is reported;
 * the first two are not retried either.
 */
const QUIET_REASONS = new Set(['interactive_timeout', 'superseded', 'page_hidden'])
const NO_RETRY_REASONS = new Set(['interactive_timeout', 'page_hidden'])

let scriptPromise: Promise<void> | null = null
let scriptEl: HTMLScriptElement | null = null
let widgetId: string | null = null
let host: HTMLDivElement | null = null
/** The widget currently waiting for a token; a newer render settles it as "superseded". */
let active: { cancel: () => void } | null = null

/** HOCKIA's widget (Cloudflare account HOCKIA, "HOCKIA auth": managed; inhockia.com,
 *  www, staging, localhost). Site keys are public by design — every browser gets it. */
const PRODUCTION_SITE_KEY = '0x4AAAAAAFbbx3EJbwS2Zs-d'
/** Cloudflare's documented always-pass test key: staging and local dev, where our
 *  automated browsers (CI E2E, device lab) would otherwise be challenged. */
const TEST_SITE_KEY = '1x00000000000000000000AA'
const PRODUCTION_SUPABASE_REF = 'xtertgftujnebubxgqit'

/** Override → production key against the production project → test key elsewhere. */
function siteKey(): string | undefined {
  const override = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined)?.trim()
  if (override) return override
  if (import.meta.env.MODE === 'test') return undefined
  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? ''
  return supabaseUrl.includes(PRODUCTION_SUPABASE_REF) ? PRODUCTION_SITE_KEY : TEST_SITE_KEY
}

export function captchaConfigured(): boolean {
  return Boolean(siteKey())
}

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve()
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = SCRIPT_SRC
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => { forgetScript(); reject(new Error('turnstile script failed')) }
    scriptEl = s
    document.head.appendChild(s)
  })
  return scriptPromise
}

/** A failed or stalled script load must not stick: the next attempt adds a new tag. */
function forgetScript(): void {
  scriptPromise = null
  if (scriptEl) { try { scriptEl.remove() } catch { /* already gone */ } }
  scriptEl = null
}

/* Only the card chrome toggles; "interaction-only" keeps the widget itself
   invisible until Cloudflare asks for a human. */
const HOST_BASE = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483000;display:block;'
const HOST_IDLE_STYLE = `${HOST_BASE}pointer-events:none;background:transparent;padding:0`
const HOST_CARD_STYLE = `${HOST_BASE}pointer-events:auto;background:#fff;border-radius:16px;padding:8px;box-shadow:0 8px 30px rgba(15,15,20,.18)`

function ensureHost(): HTMLDivElement {
  if (host && document.body.contains(host)) return host
  host = document.createElement('div')
  host.setAttribute('data-testid', 'captcha-host')
  host.setAttribute('aria-live', 'polite')
  host.style.cssText = HOST_IDLE_STYLE
  document.body.appendChild(host)
  return host
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms)
    p.then((v) => { clearTimeout(t); resolve(v) }, (e) => { clearTimeout(t); reject(e) })
  })
}

function removeWidget(api: TurnstileApi | undefined): void {
  if (widgetId && api) { try { api.remove(widgetId) } catch { /* already gone */ } }
  widgetId = null
}

/** A token prepared when the form opened, so the tap doesn't wait (tokens live 300 s; reuse within 240 s). */
let warm: { action: CaptchaAction; at: number; result: Promise<CaptchaResult> } | null = null
const WARM_MAX_AGE_MS = 240_000

/** Start getting a token as soon as a sign-in / sign-up / reset form opens. */
export function warmCaptcha(action: CaptchaAction): void {
  if (!siteKey() || typeof window === 'undefined') return
  if (warm && warm.action === action && Date.now() - warm.at < WARM_MAX_AGE_MS) return
  warm = { action, at: Date.now(), result: attemptToken(action) }
}

/** Drop the warmed token and the widget so the next request starts clean (the "Try again" button). */
export function resetCaptcha(): void {
  warm = null
  if (active) active.cancel()
  active = null
  if (typeof window !== 'undefined') removeWidget(window.turnstile)
}

/** A single-use Turnstile token, or undefined when unavailable (never throws). */
export async function getCaptchaToken(action: CaptchaAction): Promise<string | undefined> {
  return (await getCaptchaTokenResult(action)).token
}

/**
 * A single-use token, or the reason there is none (never throws). Uses the
 * warmed token when fresh; otherwise renders a widget, and after a failure
 * renders one more fresh widget before giving up.
 */
export async function getCaptchaTokenResult(action: CaptchaAction): Promise<CaptchaResult> {
  if (!siteKey() || typeof window === 'undefined' || typeof document === 'undefined') return { attempts: 0 }
  const reasons: string[] = []
  let attempts = 0
  if (warm && warm.action === action && Date.now() - warm.at < WARM_MAX_AGE_MS) {
    const pending = warm.result
    warm = null // single use
    const first = await pending
    if (first.token) return { token: first.token, attempts: 1 }
    // A warm widget replaced by a newer one is not a real attempt.
    if (first.reason && first.reason !== 'superseded') { attempts = 1; reasons.push(first.reason) }
  }
  while (attempts < MAX_ATTEMPTS && !NO_RETRY_REASONS.has(reasons[reasons.length - 1] ?? '')) {
    attempts += 1
    const r = await attemptToken(action)
    if (r.token) return { token: r.token, attempts }
    reasons.push(r.reason ?? 'no_token')
  }
  const reason = reasons[reasons.length - 1] ?? 'no_token'
  if (!QUIET_REASONS.has(reason)) reportUnavailable(action, reason, attempts, reasons)
  return { reason, attempts }
}

/** One widget, one token. Never reports: the caller decides after its retries. */
async function attemptToken(action: CaptchaAction): Promise<CaptchaResult> {
  const key = siteKey()
  if (!key) return { attempts: 0 }
  try {
    await withTimeout(loadScript(), SCRIPT_TIMEOUT_MS)
  } catch (e) {
    forgetScript()
    return { reason: e instanceof Error && e.message === 'timeout' ? 'script_timeout' : 'script_failed', attempts: 1 }
  }
  const api = window.turnstile
  if (!api) return { reason: 'script_failed', attempts: 1 }
  if (active) active.cancel()
  const el = ensureHost()
  removeWidget(api)
  return new Promise<CaptchaResult>((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const me = { cancel: () => done(undefined, 'superseded') }
    function done(token?: string, failure?: string) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (active === me) active = null
      el.style.cssText = HOST_IDLE_STYLE
      if (token) { resolve({ token, attempts: 1 }); return }
      const hidden = failure === 'timeout' && document.visibilityState === 'hidden'
      resolve({ reason: hidden ? 'page_hidden' : (failure ?? 'no_token'), attempts: 1 })
    }
    active = me
    timer = setTimeout(() => done(undefined, 'timeout'), TOKEN_TIMEOUT_MS)
    try {
      widgetId = api.render(el, {
        sitekey: key,
        action,
        appearance: 'interaction-only',
        callback: (token: string) => done(token),
        'error-callback': (code?: string) => done(undefined, `error_${code ?? 'unknown'}`),
        'timeout-callback': () => done(undefined, 'challenge_timeout'),
        'expired-callback': () => done(undefined, 'expired'),
        'before-interactive-callback': () => {
          el.style.cssText = HOST_CARD_STYLE
          clearTimeout(timer)
          timer = setTimeout(() => done(undefined, 'interactive_timeout'), INTERACTIVE_TIMEOUT_MS)
        },
        'after-interactive-callback': () => { el.style.cssText = HOST_IDLE_STYLE },
      })
    } catch {
      done(undefined, 'render_failed')
    }
  })
}

/**
 * How often a real browser couldn't get a token after its retries. Counted
 * as an expected outcome (sentryFilters: "captcha", sampled, info). Quiet
 * reasons (a check left unanswered, the app in the background) are skipped.
 */
function reportUnavailable(action: CaptchaAction, reason: string, attempts: number, reasons: string[]): void {
  try {
    Sentry.captureMessage(`captcha token unavailable (${action}: ${reason})`, {
      level: 'info',
      tags: { captcha_action: action, captcha_reason: reason, captcha_attempts: String(attempts) },
      extra: { captcha_reasons: reasons.join(',') },
    })
  } catch { /* never block sign-in on reporting */ }
}

/** "We couldn't run the bot check" in plain words: what happened and what to do. */
export const CAPTCHA_FAILED_COPY = 'We couldn’t finish the security check. Check your connection and try again.'

/** Supabase's refusal when the token is missing or invalid, in plain words (null for other errors). */
export function captchaErrorMessage(message: string | undefined): string | null {
  if (!message) return null
  return /captcha/i.test(message) ? CAPTCHA_FAILED_COPY : null
}
