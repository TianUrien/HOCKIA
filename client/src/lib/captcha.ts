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
 * With no site key configured (local dev without one) it returns undefined
 * and auth calls go out without a token — fine until enforcement is on.
 */

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string
  remove: (id: string) => void
}
declare global { interface Window { turnstile?: TurnstileApi } }

export type CaptchaAction = 'login' | 'signup' | 'reset' | 'magic_link' | 'resend' | 'reverify'

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
const SCRIPT_TIMEOUT_MS = 8000
const TOKEN_TIMEOUT_MS = 45000

let scriptPromise: Promise<void> | null = null
let widgetId: string | null = null
let host: HTMLDivElement | null = null

function siteKey(): string | undefined {
  const k = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined
  return k && k.trim() ? k.trim() : undefined
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
      const done = (token?: string) => {
        if (settled) return
        settled = true
        el.style.display = 'none'
        resolve(token)
      }
      setTimeout(() => done(undefined), TOKEN_TIMEOUT_MS)
      widgetId = api.render(el, {
        sitekey: key,
        action,
        appearance: 'interaction-only',
        callback: (token: string) => done(token),
        'error-callback': () => done(undefined),
        'timeout-callback': () => done(undefined),
        'expired-callback': () => done(undefined),
        'before-interactive-callback': () => { el.style.display = 'block' },
        'after-interactive-callback': () => { el.style.display = 'none' },
      })
    })
  } catch {
    return undefined
  }
}

/** Supabase's refusal when the token is missing or invalid, in plain words (null for other errors). */
export function captchaErrorMessage(message: string | undefined): string | null {
  if (!message) return null
  return /captcha/i.test(message)
    ? 'We couldn’t confirm you’re not a bot. Please try again — if it keeps happening, check your connection or try another browser.'
    : null
}
