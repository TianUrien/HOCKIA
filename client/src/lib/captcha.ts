/**
 * Bot check for sign-in, sign-up and password emails (Cloudflare Turnstile,
 * free). Ruling 2026-10-19 after an automated password-guessing burst (116
 * attempts from 4 addresses in an hour): two steps, nobody locked out —
 * 1. the app sends a Turnstile token with every auth call (this file);
 * 2. Supabase Auth enforces it only once store builds carrying step 1 are out.
 *
 * One invisible widget for the whole app: `getCaptchaToken(action)` renders a
 * fresh single-use token on demand. It stays invisible for real people; only
 * when Cloudflare wants a human check does it appear, in an app sheet (see
 * 2026-11-25 below).
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
 *
 * 2026-10-28 (before enforcing): every request the server ACCEPTS reports
 * whether it carried a token (`reportCaptchaCoverage`), unsampled and with the
 * reason when it didn't. Accepted password sign-ins without a token are the
 * real members enforcement would lock out; the share has to be near zero first.
 *
 * 2026-11-25 (founder: the check looked cheap and floated over the form): the
 * check is still Cloudflare's own box, which cannot be restyled, but it now
 * appears in a sheet in the app's style: a dimmed backdrop, "One moment" and
 * one line of why, and the box at full width (size "flexible") in the
 * interface language. A bottom sheet on phones, a centred card on wider
 * screens. The host stays rendered while idle, as before.
 */

import * as Sentry from '@sentry/react'
import { tAuth } from '@/i18n/ns/auth'

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string
  remove: (id: string) => void
}
declare global { interface Window { turnstile?: TurnstileApi } }

export type CaptchaAction = 'login' | 'signup' | 'reset' | 'magic_link' | 'resend' | 'reverify' | 'guard'

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
/** The last token request per action, read once by `reportCaptchaCoverage` when the server answers. */
const lastResult = new Map<CaptchaAction, CaptchaResult>()

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

/* Only the sheet chrome toggles; "interaction-only" keeps the widget itself
   invisible until Cloudflare asks for a human. The host is never display:none
   (an iframe in a hidden box may never run its check in some WebViews). */
const HOST_IDLE_CLASS = 'pointer-events-none fixed inset-x-0 bottom-0 z-[2147483000] bg-transparent'
const HOST_CARD_CLASS = [
  'pointer-events-auto fixed inset-x-0 bottom-0 z-[2147483000] animate-fadeSlideIn bg-white',
  'rounded-t-[28px] px-5 pb-[calc(20px+env(safe-area-inset-bottom))] pt-5 shadow-[0_-8px_30px_rgba(15,15,20,0.16)]',
  'max-[359px]:px-2.5',
  /* Desktop: a centred dialog. inset-0 + m-auto centres it without a transform,
     which the fadeSlideIn animation would otherwise overwrite. */
  'sm:inset-0 sm:m-auto sm:h-fit sm:w-[400px] sm:rounded-[24px] sm:p-6 sm:shadow-[0_16px_48px_rgba(15,15,20,0.22)]',
].join(' ')
/* Lucide shield-check, static markup (no user input). */
const SHIELD_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/></svg>'
const BACKDROP_CLASS = 'fixed inset-0 z-[2147482999] bg-[rgba(15,15,20,0.32)]'

let slot: HTMLDivElement | null = null
let header: HTMLDivElement | null = null
let backdrop: HTMLDivElement | null = null

/** The host (always rendered), its header (shown with the check) and the slot the widget renders into. */
function ensureHost(): HTMLDivElement {
  if (host && slot && document.body.contains(host)) return slot
  host = document.createElement('div')
  host.setAttribute('data-testid', 'captcha-host')
  host.setAttribute('aria-live', 'polite')
  host.setAttribute('role', 'dialog')
  header = document.createElement('div')
  header.className = 'mb-4 hidden'
  const badge = document.createElement('span')
  badge.className = 'flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-primary'
  badge.setAttribute('aria-hidden', 'true')
  badge.innerHTML = SHIELD_ICON
  const text = document.createElement('div')
  text.className = 'min-w-0'
  const title = document.createElement('h2')
  title.className = 'text-body font-semibold text-ink-1'
  title.setAttribute('data-testid', 'captcha-title')
  const body = document.createElement('p')
  body.className = 'mt-0.5 text-secondary text-ink-2'
  text.append(title, body)
  header.append(badge, text)
  slot = document.createElement('div')
  slot.setAttribute('data-testid', 'captcha-slot')
  host.append(header, slot)
  backdrop = document.createElement('div')
  backdrop.setAttribute('data-testid', 'captcha-backdrop')
  backdrop.setAttribute('aria-hidden', 'true')
  document.body.append(backdrop, host)
  showSheet(false)
  return slot
}

/** Idle: an invisible, click-through host. Sheet: backdrop, "One moment" and the check. */
function showSheet(open: boolean): void {
  if (!host || !header || !backdrop) return
  host.className = open ? HOST_CARD_CLASS : HOST_IDLE_CLASS
  host.style.display = 'block'
  host.setAttribute('aria-modal', open ? 'true' : 'false')
  if (open) {
    const [title, body] = Array.from(header.lastElementChild?.children ?? []) as HTMLElement[]
    title.textContent = tAuth('captcha.sheetTitle')
    body.textContent = tAuth('captcha.sheetBody')
    host.setAttribute('aria-label', tAuth('captcha.sheetTitle'))
  }
  header.className = open ? 'mb-4 flex items-start gap-3' : 'mb-4 hidden'
  backdrop.className = open ? BACKDROP_CLASS : 'hidden'
}

/** Cloudflare's language codes are two letters; anything else lets it choose. */
function widgetLanguage(): string {
  const lang = (typeof document !== 'undefined' ? document.documentElement.lang : '').slice(0, 2).toLowerCase()
  return /^[a-z]{2}$/.test(lang) ? lang : 'auto'
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
  const result = await requestToken(action)
  lastResult.set(action, result)
  return result
}

async function requestToken(action: CaptchaAction): Promise<CaptchaResult> {
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
      showSheet(false)
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
        size: 'flexible',
        theme: 'light',
        language: widgetLanguage(),
        callback: (token: string) => done(token),
        'error-callback': (code?: string) => done(undefined, `error_${code ?? 'unknown'}`),
        'timeout-callback': () => done(undefined, 'challenge_timeout'),
        'expired-callback': () => done(undefined, 'expired'),
        'before-interactive-callback': () => {
          showSheet(true)
          clearTimeout(timer)
          timer = setTimeout(() => done(undefined, 'interactive_timeout'), INTERACTIVE_TIMEOUT_MS)
        },
        'after-interactive-callback': () => { showSheet(false) },
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

/**
 * The server accepted a request for `action`: say whether it carried a token.
 * Unsampled (sentryInit skips the expected-outcome sampling for the
 * `captcha_coverage` tag) and grouped per action and outcome, so the share of
 * accepted requests without a token reads straight off the two groups.
 */
export function reportCaptchaCoverage(action: CaptchaAction): void {
  const result = lastResult.get(action)
  lastResult.delete(action)
  if (!result || !siteKey()) return
  const coverage = result.token ? 'token' : 'missing'
  try {
    Sentry.captureMessage(`captcha coverage (${action}: ${coverage})`, {
      level: 'info',
      tags: {
        captcha_coverage: coverage,
        captcha_action: action,
        captcha_reason: result.reason ?? 'none',
        captcha_attempts: String(result.attempts),
      },
      fingerprint: ['captcha-coverage', action, coverage],
    })
  } catch { /* never block sign-in on reporting */ }
}

/**
 * "We couldn't run the bot check" in plain words: what happened and what to do.
 * @deprecated English only, kept for callers not yet translated; use `captchaFailedCopy()`.
 */
export const CAPTCHA_FAILED_COPY = 'We couldn’t finish the security check. Check your connection and try again.'

/** The same message in the interface language. */
export function captchaFailedCopy(): string {
  return tAuth('captcha.failed')
}

/** Supabase's refusal when the token is missing or invalid, in plain words (null for other errors). */
export function captchaErrorMessage(message: string | undefined): string | null {
  if (!message) return null
  return /captcha/i.test(message) ? captchaFailedCopy() : null
}
