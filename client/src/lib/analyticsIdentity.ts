/**
 * Analytics identity & context (Phase 0 foundation).
 *
 * Provides the dimensions a professional product-analytics funnel needs but
 * which the DB pipeline lacked: a durable per-browser visitor id (unique /
 * returning), real 30-minute sessionization, device/browser, and first-touch
 * referrer + UTM attribution.
 *
 * Consent-aware: durable identifiers are only persisted to localStorage once
 * the user accepts analytics cookies. Before that (or on decline) we fall back
 * to a per-tab sessionStorage id, so we still measure sessions without setting
 * a cross-session cookie. All functions are null-safe and never throw.
 */
import { hostnameOf, normalizeAttribution } from '@/lib/attributionRules'
import { getConsentStatus } from '@/lib/cookieConsent'

const ANON_KEY = 'hockia_anon_id'
const SESSION_KEY = 'hockia_session'
const FIRST_TOUCH_KEY = 'hockia_first_touch'
// Kept in sync for the legacy SessionTracker reader.
const LEGACY_SESSION_KEY = 'hockia_engagement_session_id'
const SESSION_TIMEOUT_MS = 30 * 60 * 1000

export interface FirstTouch {
  anonymous_id: string | null
  first_referrer: string | null
  first_source: string | null
  utm: Record<string, string> | null
  landing_path: string | null
  first_seen_at: string | null
}

export interface AnalyticsContext {
  session_id: string
  anonymous_id: string
  device: string
  browser: string
  referrer_source: string
  utm?: Record<string, string>
  /** Present (true) only for automated browsers — see `isAutomated`. */
  is_automated?: true
}

/**
 * True for automated browsers (Playwright/Selenium/QA agents).
 *
 * GA4 and PostHog both refuse to load for these, but the first-party `events`
 * pipeline accepted them — so E2E runs and QA sweeps landed in the table that
 * every funnel number is computed from. A single 24-minute QA session put 69
 * events in, which is enough to dominate a conversion rate at our volume.
 *
 * We MARK rather than DROP: the rows stay for debugging, and analytics filters
 * them out explicitly. Dropping would also break E2E assertions that watch for
 * the track_event call.
 */
export function isAutomated(): boolean {
  try {
    return navigator?.webdriver === true
  } catch {
    return false
  }
}

function uuid(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  } catch {
    /* fall through */
  }
  // RFC4122-ish fallback (Date.now avoided intentionally is not needed here —
  // this only runs in the browser where Date is safe).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/** localStorage after consent, else sessionStorage. Never throws. */
function durable(): boolean {
  return getConsentStatus() === 'accepted'
}
function read(key: string): string | null {
  try {
    if (!durable()) return sessionStorage.getItem(key)
    const fromLocal = localStorage.getItem(key)
    if (fromLocal !== null) return fromLocal
    // Consent was granted AFTER this value was first written to the per-tab
    // store — promote it so the visitor id survives the tab closing. Without
    // this migration every return visit looks brand new and the
    // unique/returning split is meaningless.
    const fromSession = sessionStorage.getItem(key)
    if (fromSession !== null) {
      try {
        localStorage.setItem(key, fromSession)
      } catch {
        /* storage full/blocked — keep serving the session value */
      }
    }
    return fromSession
  } catch {
    return null
  }
}
function write(key: string, val: string): void {
  try {
    ;(durable() ? localStorage : sessionStorage).setItem(key, val)
  } catch {
    /* storage blocked (Safari private) — analytics degrades silently */
  }
}

/** Consent-aware storage, shared with lib/attribution so every identity and
 *  attribution value follows the same per-tab → durable promotion rule. */
export const storageRead = read
export const storageWrite = write

/** Durable per-browser visitor id (or per-tab before consent). */
export function getAnonymousId(): string {
  let id = read(ANON_KEY)
  if (!id) {
    id = uuid()
    write(ANON_KEY, id)
  }
  return id
}

/** 30-minute sliding-window session id. Rotates after inactivity. */
export function getSessionId(): string {
  let id: string
  try {
    const raw = read(SESSION_KEY)
    const now = Date.now()
    if (raw) {
      const parsed = JSON.parse(raw) as { id: string; ts: number }
      if (parsed.id && now - parsed.ts < SESSION_TIMEOUT_MS) {
        id = parsed.id
      } else {
        id = uuid()
      }
    } else {
      id = uuid()
    }
    write(SESSION_KEY, JSON.stringify({ id, ts: now }))
  } catch {
    id = uuid()
  }
  // Mirror to the legacy key the existing SessionTracker still reads.
  try {
    sessionStorage.setItem(LEGACY_SESSION_KEY, id)
  } catch {
    /* noop */
  }
  return id
}

function parseUA(ua: string): { device: string; browser: string } {
  const s = ua.toLowerCase()
  let device = 'desktop'
  if (/ipad|tablet|(android(?!.*mobile))/i.test(ua)) device = 'tablet'
  else if (/mobi|iphone|ipod|android.*mobile|windows phone/i.test(ua)) device = 'mobile'
  let browser = 'other'
  if (s.includes('edg/')) browser = 'edge'
  else if (s.includes('opr/') || s.includes('opera')) browser = 'opera'
  else if (s.includes('chrome') || s.includes('crios')) browser = 'chrome'
  else if (s.includes('firefox') || s.includes('fxios')) browser = 'firefox'
  else if (s.includes('safari')) browser = 'safari'
  return { device, browser }
}

export function getDeviceContext(): { device: string; browser: string } {
  try {
    return parseUA(navigator.userAgent || '')
  } catch {
    return { device: 'unknown', browser: 'unknown' }
  }
}

/**
 * Classify a referrer / utm_source with the attribution registry, so every
 * events.referrer_source value shares signup_attribution's taxonomy.
 * Auth-provider referrers normalize to 'internal' here (never a channel).
 */
export function classifySource(referrer: string | null, utmSource: string | null): string {
  const n = normalizeAttribution(utmSource, hostnameOf(referrer))
  return n.discarded ? 'internal' : n.source
}

/** First-touch source from the v2 attribution store (read-only; the engine
 *  in lib/attribution owns writes — reading here avoids an import cycle). */
function readV2FirstSource(): string | null {
  const raw = read('hockia_attr_v2')
  if (!raw) return null
  try {
    return (JSON.parse(raw) as { first?: { source?: string } | null }).first?.source ?? null
  } catch {
    return null
  }
}

function readUTM(): Record<string, string> | null {
  try {
    const p = new URLSearchParams(window.location.search)
    const out: Record<string, string> = {}
    for (const k of ['source', 'medium', 'campaign', 'term', 'content']) {
      const v = p.get(`utm_${k}`)
      if (v) out[k] = v.slice(0, 120)
    }
    return Object.keys(out).length ? out : null
  } catch {
    return null
  }
}

/** Capture first-touch on the very first page in a browser; idempotent. */
export function captureFirstTouch(): FirstTouch {
  const existing = read(FIRST_TOUCH_KEY)
  if (existing) {
    try {
      return JSON.parse(existing) as FirstTouch
    } catch {
      /* rewrite below */
    }
  }
  const utm = readUTM()
  let referrer: string | null = null
  let path: string | null = null
  try {
    referrer = document.referrer || null
    path = window.location.pathname
  } catch {
    /* noop */
  }
  const ft: FirstTouch = {
    anonymous_id: getAnonymousId(),
    first_referrer: referrer,
    first_source: classifySource(referrer, utm?.source ?? null),
    utm,
    landing_path: path,
    first_seen_at: new Date().toISOString(),
  }
  write(FIRST_TOUCH_KEY, JSON.stringify(ft))
  return ft
}

export function getFirstTouch(): FirstTouch | null {
  const raw = read(FIRST_TOUCH_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as FirstTouch
  } catch {
    return null
  }
}

/**
 * The context merged into every DB event's properties. track_event promotes
 * these keys to real columns. UTM is only attached when present this session
 * (i.e. on a UTM-tagged landing) — first-touch attribution lives in
 * signup_attribution, not on every row.
 */
export function analyticsContext(): AnalyticsContext {
  const { device, browser } = getDeviceContext()
  const utm = readUTM()
  const ctx: AnalyticsContext = {
    session_id: getSessionId(),
    anonymous_id: getAnonymousId(),
    device,
    browser,
    referrer_source: readV2FirstSource() ?? getFirstTouch()?.first_source ?? classifySource(safeReferrer(), utm?.source ?? null),
  }
  if (utm) ctx.utm = utm
  // Only stamped when true, so real-user payloads stay lean and the filter is
  // a simple "is this key absent?".
  if (isAutomated()) ctx.is_automated = true
  return ctx
}

function safeReferrer(): string | null {
  try {
    return document.referrer || null
  } catch {
    return null
  }
}
