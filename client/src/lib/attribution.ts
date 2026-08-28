/**
 * Attribution engine — the single owner of "how did this person find us".
 *
 * Replaces lib/acquisition.ts (profiles.acquisition_source) and the
 * first-touch half of lib/analyticsIdentity.ts. Audit 2026-08-28 found the two
 * disagreeing on 24% of members, one corrupting first touches with OAuth
 * callbacks, the other freezing "direct" so real Instagram clicks were lost.
 *
 * Concepts (founder-approved, D1–D3):
 *   touch            every entry into the product that carries information
 *                    (utm, external referrer, deep link) — or the first entry
 *                    of a session even without one. Auth-provider referrers
 *                    are DISCARDED before they can become anything.
 *   first_touch      immutable once it carries a signal. A "direct" first
 *                    touch may be upgraded ONCE by the first signal-bearing
 *                    touch within UPGRADE_WINDOW_DAYS (D2 = 30).
 *   last_non_direct  newest signal-bearing touch within LOOKBACK_DAYS (D3 = 90).
 *   session_source   how the CURRENT session was entered (direct_app for a
 *                    home-screen open on native). Never rewrites first_touch.
 *
 * Persistence follows the analytics identity's consent rule (per-tab until
 * consent, then durable). Normalization labels here are advisory: the
 * server re-normalizes on write (record_signup_attribution).
 */

import { Capacitor } from '@capacitor/core'
import { supabase } from '@/lib/supabase'
import { getAnonymousId, getDeviceContext, getSessionId, storageRead, storageWrite } from '@/lib/analyticsIdentity'
import { hostnameOf, normalizeAttribution } from '@/lib/attributionRules'
import { isShortLinkPath } from '@/lib/shortLinks'

export const ATTRIBUTION_KEY = 'hockia_attr_v2'
const LEGACY_FIRST_TOUCH_KEY = 'hockia_first_touch'
const LEGACY_ACQ_KEY = 'hockia-acq'
const SUBMITTED_KEY = 'hockia_attr_submitted'
export const UPGRADE_WINDOW_DAYS = 30
export const LOOKBACK_DAYS = 90
const MAX_TOUCHES = 20
const CLIP = 160

export type Platform = 'web' | 'ios' | 'android'

export interface Touch {
  source: string
  group: string
  medium: string | null
  campaign: string | null
  content: string | null
  term: string | null
  referrer: string | null
  referring_domain: string | null
  landing_page: string | null
  deep_link: string | null
  link_id: string | null
  platform: Platform
  session_id: string | null
  captured_at: string
  method: 'utm' | 'referrer' | 'none' | 'deep_link' | 'migrated' | 'install_referrer'
  raw: { utm: Record<string, string> | null; referrer: string | null }
}

export interface AttributionState {
  v: 2
  touches: Touch[]
  first: Touch | null
  first_upgraded: boolean
}

const clip = (v: string | null | undefined): string | null => (v ? v.slice(0, CLIP) : null)
const hasSignal = (t: Touch | null | undefined): boolean => !!t && t.source !== 'direct' && t.source !== 'direct_app'
const daysBetween = (a: string, b: string): number => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000

export function currentPlatform(): Platform {
  try {
    if (Capacitor.isNativePlatform()) {
      const p = Capacitor.getPlatform()
      return p === 'ios' || p === 'android' ? p : 'web'
    }
  } catch {
    /* fall through */
  }
  return 'web'
}

function readUtm(search: string): Record<string, string> | null {
  try {
    const p = new URLSearchParams(search)
    const out: Record<string, string> = {}
    for (const k of ['source', 'medium', 'campaign', 'term', 'content']) {
      const v = p.get(`utm_${k}`)
      if (v) out[k] = v.slice(0, CLIP)
    }
    return Object.keys(out).length ? out : null
  } catch {
    return null
  }
}

function readLinkId(search: string): string | null {
  try {
    return clip(new URLSearchParams(search).get('hk_link'))
  } catch {
    return null
  }
}

// ── state ────────────────────────────────────────────────────────────────

function loadState(): AttributionState {
  const raw = storageRead(ATTRIBUTION_KEY)
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as AttributionState
      if (parsed && parsed.v === 2 && Array.isArray(parsed.touches)) return parsed
    } catch {
      /* rewrite below */
    }
  }
  const migrated = migrateLegacy()
  saveState(migrated)
  return migrated
}

function saveState(state: AttributionState): void {
  storageWrite(ATTRIBUTION_KEY, JSON.stringify(state))
}

/**
 * One-time import of whatever the two retired systems had stored, so
 * members mid-journey at deploy time keep their history. A legacy value that
 * normalizes to a discard (auth provider) is dropped — that is the bug.
 */
function migrateLegacy(): AttributionState {
  const state: AttributionState = { v: 2, touches: [], first: null, first_upgraded: false }
  const candidates: Touch[] = []
  const now = new Date().toISOString()
  try {
    const ft = storageRead(LEGACY_FIRST_TOUCH_KEY)
    if (ft) {
      const p = JSON.parse(ft) as { first_referrer?: string | null; utm?: Record<string, string> | null; landing_path?: string | null; first_seen_at?: string | null }
      const t = buildTouch({ utm: p.utm ?? null, referrer: p.first_referrer ?? null, landing: p.landing_path ?? null, at: p.first_seen_at ?? now, method: 'migrated' })
      if (t) candidates.push(t)
    }
  } catch { /* ignore */ }
  try {
    const acq = localStorage.getItem(LEGACY_ACQ_KEY) ?? sessionStorage.getItem(LEGACY_ACQ_KEY)
    if (acq) {
      const p = JSON.parse(acq) as { source?: string; medium?: string; campaign?: string; referrer?: string; landing_path?: string; captured_at?: string }
      // System 1 stored utm_source in `source` when a medium was present, else a raw hostname.
      const utm = p.medium ? { source: p.source ?? '', medium: p.medium, ...(p.campaign ? { campaign: p.campaign } : {}) } : null
      const referrer = p.referrer ?? (p.source && p.source.includes('.') ? p.source : null)
      const t = buildTouch({ utm, referrer, landing: p.landing_path ?? null, at: p.captured_at ?? now, method: 'migrated' })
      if (t) candidates.push(t)
    }
  } catch { /* ignore */ }

  candidates.sort((a, b) => Date.parse(a.captured_at) - Date.parse(b.captured_at))
  for (const t of candidates) applyTouch(state, t)
  return state
}

function buildTouch(input: {
  utm: Record<string, string> | null
  referrer: string | null
  landing: string | null
  at: string
  method: Touch['method']
  deepLink?: string | null
  linkId?: string | null
}): Touch | null {
  const host = hostnameOf(input.referrer)
  const n = normalizeAttribution(input.utm?.source ?? null, host)
  if (n.discarded) return null
  return {
    source: n.source,
    group: n.group,
    medium: input.utm?.medium ?? n.medium,
    campaign: clip(input.utm?.campaign),
    content: clip(input.utm?.content),
    term: clip(input.utm?.term),
    referrer: clip(input.referrer),
    referring_domain: clip(host),
    landing_page: clip(input.landing),
    deep_link: clip(input.deepLink),
    link_id: clip(input.linkId),
    platform: currentPlatform(),
    session_id: safeSessionId(),
    captured_at: input.at,
    method: input.method === 'migrated' || input.method === 'deep_link' || input.method === 'install_referrer' ? input.method : n.method,
    raw: { utm: input.utm, referrer: input.referrer },
  }
}

function safeSessionId(): string | null {
  try {
    return getSessionId()
  } catch {
    return null
  }
}

/** The state machine. Pure on `state`; exported for tests. */
export function applyTouch(state: AttributionState, touch: Touch): AttributionState {
  const signal = hasSignal(touch)
  const isNewSession = !state.touches.length || state.touches[state.touches.length - 1].session_id !== touch.session_id
  // Record when it says something new: a signal, a new session, or nothing yet.
  if (signal || isNewSession) {
    state.touches.push(touch)
    if (state.touches.length > MAX_TOUCHES) state.touches.splice(0, state.touches.length - MAX_TOUCHES)
  }

  if (!state.first) {
    state.first = touch
  } else if (!hasSignal(state.first) && signal && !state.first_upgraded
             && daysBetween(state.first.captured_at, touch.captured_at) <= UPGRADE_WINDOW_DAYS) {
    // D2: the one permitted rewrite — a direct first touch learns its real
    // source from the first tagged/referred visit inside the window.
    state.first = { ...touch, method: touch.method }
    state.first_upgraded = true
  }
  return state
}

// ── public API ───────────────────────────────────────────────────────────

/** Entry paths reached from an email / OAuth round-trip, never from a source. */
export const BOUNCE_ENTRY_PATHS = ['/auth/callback', '/verify-email', '/email-action', '/reset-password']
let entryPathname: string | null = null
function isBounceEntryDocument(): boolean {
  if (entryPathname === null) entryPathname = window.location.pathname
  return BOUNCE_ENTRY_PATHS.some((p) => entryPathname === p || entryPathname!.startsWith(p + '/'))
}

/**
 * Record the current page entry as a touch. Call once per page load and on
 * any in-app navigation that carries utm parameters. Idempotent within a
 * session for signal-less entries.
 */
export function recordEntryTouch(): AttributionState | null {
  if (typeof window === 'undefined') return null
  try {
    const state = loadState()
    // /l/<code> is a pass-through, not a landing: the resolver redirects to
    // the real destination with the link's utm set, and THAT entry is the
    // touch (with the external referrer still intact — no document reload).
    if (isShortLinkPath(window.location.pathname)) return state
    const utm = readUtm(window.location.search)
    const linkId = readLinkId(window.location.search)
    // A document that ENTERED on an auth/email landing (magic link, verify,
    // reset) got there from a mail client or an OAuth provider — its referrer
    // (www.google.com, mail.google.com, outlook.live.com, android-app://…)
    // is a bounce, not a source. document.referrer never changes for the
    // life of the document, so the neutralisation must be sticky, not
    // per-path. Same bug class as accounts.google.com, one door over.
    const referrer = isBounceEntryDocument() ? null : (document.referrer || null)
    // Inside the native shell there is no referrer; a plain open is the
    // session's "direct_app" — distinct from web "direct" in reporting.
    const native = currentPlatform() !== 'web'
    const touch = buildTouch({
      utm, referrer, landing: window.location.pathname,
      at: new Date().toISOString(), method: 'none', linkId,
    })
    if (!touch) return state // discarded (auth provider) — nothing to learn
    if (native && !hasSignal(touch) && !utm) touch.source = 'direct_app'
    applyTouch(state, touch)
    saveState(state)
    return state
  } catch {
    return null
  }
}

/**
 * Phase 3: the Google Play Install Referrer string (already URL-decoded by
 * Play), e.g. "utm_source=instagram&utm_medium=social&hk_link=ig-app".
 * An organic Play install arrives as "utm_source=google-play&utm_medium=organic"
 * or "(not set)"; both are recorded as a google_play store install.
 * On a fresh install the launch already recorded a signal-less direct_app
 * touch, so this lands as the one permitted D2 upgrade of the first touch.
 */
export function recordInstallReferrerTouch(referrer: string): AttributionState | null {
  try {
    const raw = (referrer ?? '').trim()
    if (!raw) return null
    const params = new URLSearchParams(raw)
    const notSet = (v: string | null) => !v || /^\(not[ _]?set\)$/i.test(v)
    const search = '?' + params.toString()
    let utm = readUtm(search)
    if (!utm || notSet(utm.source)) utm = { ...(utm ?? {}), source: 'google-play', medium: utm?.medium && !notSet(utm.medium) ? utm.medium : 'organic' }
    const state = loadState()
    const touch = buildTouch({
      utm, referrer: null, landing: '/', at: new Date().toISOString(), method: 'install_referrer',
      deepLink: ('install_referrer:' + raw).slice(0, CLIP), linkId: readLinkId(search),
    })
    if (!touch) return state
    applyTouch(state, touch)
    saveState(state)
    return state
  } catch {
    return null
  }
}

/** Phase 3 hook: a deep link opened the app (hockia:// or universal link). */
export function recordDeepLinkTouch(url: string): void {
  try {
    const u = new URL(url)
    const state = loadState()
    const touch = buildTouch({
      utm: readUtm(u.search), referrer: null, landing: u.pathname,
      at: new Date().toISOString(), method: 'deep_link', deepLink: url.slice(0, CLIP), linkId: readLinkId(u.search),
    })
    if (!touch) return
    applyTouch(state, touch)
    saveState(state)
  } catch {
    /* malformed deep link — ignore */
  }
}

export function getAttributionState(): AttributionState | null {
  if (typeof window === 'undefined') return null
  try {
    return loadState()
  } catch {
    return null
  }
}

export function getFirstTouchSource(): string | null {
  return getAttributionState()?.first?.source ?? null
}

export function getLastNonDirect(state: AttributionState, now = new Date().toISOString()): Touch | null {
  for (let i = state.touches.length - 1; i >= 0; i--) {
    const t = state.touches[i]
    if (hasSignal(t) && daysBetween(t.captured_at, now) <= LOOKBACK_DAYS) return t
  }
  return null
}

export function getSessionSource(state: AttributionState): string {
  const sid = safeSessionId()
  for (let i = state.touches.length - 1; i >= 0; i--) {
    if (state.touches[i].session_id === sid) return state.touches[i].source
  }
  return currentPlatform() === 'web' ? 'direct' : 'direct_app'
}

/** Compact snapshot that rides auth metadata through an OAuth round-trip. */
export function getAttributionSnapshot(): Record<string, unknown> | null {
  const s = getAttributionState()
  if (!s?.first) return null
  const f = s.first
  // utm_source is the RAW tag so the server can re-normalize it; `source`
  // stays for readers of older snapshots.
  return {
    v: 2, source: f.source, utm_source: f.raw.utm?.source ?? null, medium: f.medium, campaign: f.campaign,
    referrer: f.referring_domain, landing: f.landing_page, at: f.captured_at, link_id: f.link_id,
  }
}

/** The jsonb the server normalizes and writes once, at registration. */
export function buildSignupPayload(state: AttributionState): Record<string, unknown> {
  const f = state.first
  const ln = getLastNonDirect(state)
  const dev = safeDevice()
  const toBlock = (t: Touch | null) => t ? {
    utm_source: t.raw.utm?.source ?? null,
    utm: t.raw.utm,
    referrer: t.referrer,
    referring_domain: t.referring_domain,
    landing_page: t.landing_page,
    captured_at: t.captured_at,
    client_source: t.source,
    client_group: t.group,
  } : null
  return {
    v: 2,
    anonymous_id: safeAnonymousId(),
    platform: currentPlatform(),
    device_category: dev,
    session_source: getSessionSource(state),
    first_touch: toBlock(f),
    last_nd: toBlock(ln),
    deep_link: f?.deep_link ?? null,
    link_id: f?.link_id ?? ln?.link_id ?? null,
    // The evidence type wins over the state-machine event: an install
    // referrer that upgraded a direct_app first touch is still "install_referrer".
    attribution_method: f && (f.method === 'migrated' || f.method === 'deep_link' || f.method === 'install_referrer') ? f.method
      : state.first_upgraded ? 'upgraded_first_signal' : undefined,
    touches: state.touches.slice(-MAX_TOUCHES),
  }
}

function safeAnonymousId(): string | null {
  try { return getAnonymousId() } catch { return null }
}
function safeDevice(): string {
  try {
    const d = getDeviceContext().device.toLowerCase()
    return d.includes('tablet') || d.includes('ipad') ? 'tablet' : d.includes('mobile') || d.includes('phone') ? 'phone' : 'desktop'
  } catch { return 'unknown' }
}

/**
 * Write the signup attribution — once. Safe to call from several places
 * (registration, onboarding completion): the server keeps the first write
 * and this browser remembers it submitted.
 */
let submitInFlight = false

export function submitSignupAttribution(userId?: string | null): void {
  if (typeof window === 'undefined') return
  try {
    if (submitInFlight) return
    // The flag remembers WHICH account this browser submitted for. A second
    // person signing up on a shared device (a parent after a junior, a club
    // laptop) must still get a row — without one they vanish from every
    // acquisition number. Without a user id (legacy shim) fall back to
    // once-per-browser.
    const submitted = storageRead(SUBMITTED_KEY)
    if (submitted && (!userId || submitted === userId)) return
    submitInFlight = true
    const state = loadState()
    const payload = buildSignupPayload(state)
    // The RPC is newer than the generated Database types; call it untyped.
    // bind: a detached `rpc` loses `this` and throws before any request is made
    const rpc = supabase.rpc.bind(supabase) as unknown as (fn: string, args: Record<string, unknown>) => PromiseLike<{ error: unknown }>
    void Promise.resolve(rpc('record_signup_attribution', { p: payload }))
      .then(({ error }) => { if (!error) storageWrite(SUBMITTED_KEY, userId ?? new Date().toISOString()) })
      .catch(() => {})
      .finally(() => { submitInFlight = false })
  } catch {
    submitInFlight = false
  }
}

/** Test-only. */
export function __resetAttributionForTests(): void {
  submitInFlight = false
  entryPathname = null
  try {
    localStorage.removeItem(ATTRIBUTION_KEY); sessionStorage.removeItem(ATTRIBUTION_KEY)
    localStorage.removeItem(SUBMITTED_KEY); sessionStorage.removeItem(SUBMITTED_KEY)
  } catch { /* noop */ }
}
