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
 */

import * as Sentry from '@sentry/react'

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string
  remove: (id: string) => void
}
declare global { interface Window { turnstile?: TurnstileApi } }

export type CaptchaAction = 'login' | 'signup' | 'reset' | 'magic_link' | 'resend' | 'reverify'

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
const SCRIPT_TIMEOUT_MS = 8000
/** No token and no visible check: give up quickly (the server decides) rather than stall sign-in. */
const TOKEN_TIMEOUT_MS = 12000
/** A visible "confirm you're human" check is on screen: the person is responding, give them time. */
const INTERACTIVE_TIMEOUT_MS = 60000

let scriptPromise: Promise<void> | null = null
let widgetId: string | null = null
let host: HTMLDivElement | null = null

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
    s.onerror = () => { scriptPromise = null; reject(new Error('turnstile script failed')) }
    document.head.appendChild(s)
  })
  return scriptPromise
}

function ensureHost(): HTMLDivElement {
  if (host && document.body.contains(host)) return host
  host = document.createElement('div')
  host.setAttribute('data-testid', 'captcha-host')
  host.setAttribute('aria-live', 'polite')
  // Hidden until Cloudflare asks for an interaction; then a small card above the keyboard area.
  host.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483000;display:none;background:#fff;border-radius:16px;padding:8px;box-shadow:0 8px 30px rgba(15,15,20,.18)'
  document.body.appendChild(host)
  return host
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms)
    p.then((v) => { clearTimeout(t); resolve(v) }, (e) => { clearTimeout(t); reject(e) })
  })
}

/** A token prepared when the form opened, so the tap doesn't wait (tokens live 300 s; reuse within 240 s). */
let warm: { action: CaptchaAction; at: number; token: Promise<string | undefined> } | null = null
const WARM_MAX_AGE_MS = 240_000

/** Start getting a token as soon as a sign-in / sign-up / reset form opens. */
export function warmCaptcha(action: CaptchaAction): void {
  if (!siteKey() || (warm && warm.action === action && Date.now() - warm.at < WARM_MAX_AGE_MS)) return
  warm = { action, at: Date.now(), token: freshToken(action) }
}

/** A single-use Turnstile token, or undefined when unavailable (never throws). Uses the warmed one when fresh. */
export async function getCaptchaToken(action: CaptchaAction): Promise<string | undefined> {
  if (warm && warm.action === action && Date.now() - warm.at < WARM_MAX_AGE_MS) {
    const pending = warm.token
    warm = null // single use
    const token = await pending
    if (token) return token
  }
  return freshToken(action)
}

async function freshToken(action: CaptchaAction): Promise<string | undefined> {
  const key = siteKey()
  if (!key || typeof window === 'undefined' || typeof document === 'undefined') return undefined
  try {
    await withTimeout(loadScript(), SCRIPT_TIMEOUT_MS)
    const api = window.turnstile
    if (!api) return undefined
    const el = ensureHost()
    if (widgetId) { try { api.remove(widgetId) } catch { /* already gone */ } widgetId = null }
    return await new Promise<string | undefined>((resolve) => {
      let settled = false
      const done = (token?: string, failure?: string) => {
        if (settled) return
        settled = true
        el.style.display = 'none'
        if (!token) reportUnavailable(action, failure ?? 'no_token')
        resolve(token)
      }
      let timer = setTimeout(() => done(undefined, 'timeout'), TOKEN_TIMEOUT_MS)
      widgetId = api.render(el, {
        sitekey: key,
        action,
        appearance: 'interaction-only',
        callback: (token: string) => done(token),
        'error-callback': (code?: string) => done(undefined, `error_${code ?? 'unknown'}`),
        'timeout-callback': () => done(undefined, 'challenge_timeout'),
        'expired-callback': () => done(undefined, 'expired'),
        'before-interactive-callback': () => {
          el.style.display = 'block'
          clearTimeout(timer)
          timer = setTimeout(() => done(undefined, 'interactive_timeout'), INTERACTIVE_TIMEOUT_MS)
        },
        'after-interactive-callback': () => { el.style.display = 'none' },
      })
    })
  } catch {
    reportUnavailable(action, 'script_failed')
    return undefined
  }
}

/**
 * How often a real browser couldn't get a token. Counted as an expected
 * outcome (sentryFilters: "captcha", sampled, info) — before production
 * enforces, this says whether enforcing would block real members.
 */
function reportUnavailable(action: CaptchaAction, reason: string): void {
  try {
    Sentry.captureMessage(`captcha token unavailable (${action}: ${reason})`, { level: 'info', tags: { captcha_action: action, captcha_reason: reason } })
  } catch { /* never block sign-in on reporting */ }
}

/** Supabase's refusal when the token is missing or invalid, in plain words (null for other errors). */
export function captchaErrorMessage(message: string | undefined): string | null {
  if (!message) return null
  return /captcha/i.test(message)
    ? 'We couldn’t confirm you’re not a bot. Please try again — if it keeps happening, check your connection or try another browser.'
    : null
}
