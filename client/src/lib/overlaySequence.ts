/**
 * Post-onboarding overlay sequencing (founder rulings 2026-10-04).
 *
 * After onboarding a new member can be owed up to four overlays: the Terms
 * gate, the cookie banner, the install card and the push card. They must come
 * ONE AT A TIME, in that order:
 *
 *   1. Terms gate (blocking, Apple 1.2) — first, alone.
 *   2. Cookie banner — only once the Terms gate is not open.
 *   3. Install card — never on the first app visit after onboarding, and
 *      never while the Terms gate or the cookie banner is showing.
 *   4. Push card — never while any of the above is showing.
 *
 * Visibility is shared through the bottom-prompt coordinator
 * (`lib/bottomPrompt.ts`) under the ids below, so it is reactive in the tab.
 * "First app visit" is decided per device with a per-tab session id
 * (sessionStorage) compared to the session that first saw the app, which is
 * reset to the current session when onboarding completes on this device.
 */

/** Coordinator id the Terms gate registers while its modal is up. */
export const TERMS_GATE_OVERLAY = 'terms-gate'
/** Coordinator id the cookie banner registers while it is visible. */
export const COOKIE_BANNER_OVERLAY = 'cookie-banner'
/** Coordinator id the install card registers while it is visible. */
export const INSTALL_OVERLAY = 'install'

const SESSION_KEY = 'hockia-app-session'
const FIRST_VISIT_KEY = 'hockia-first-app-session'
const ONBOARDING_FLAG = 'hockia-onboarding-completed'

// In-memory fallback when storage is blocked (private mode, in-app browsers).
let memorySessionId: string | null = null

function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch { /* fall through */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** The id of this tab's app session; created on first read. Never throws. */
export function currentAppSessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY)
    if (existing) return existing
    const id = memorySessionId ?? newId()
    sessionStorage.setItem(SESSION_KEY, id)
    memorySessionId = id
    return id
  } catch {
    if (!memorySessionId) memorySessionId = newId()
    return memorySessionId
  }
}

/** Records the first app session seen on this device (no-op once set). */
export function recordAppVisit(): void {
  try {
    if (!localStorage.getItem(FIRST_VISIT_KEY)) localStorage.setItem(FIRST_VISIT_KEY, currentAppSessionId())
  } catch { /* storage blocked: treated as a first visit */ }
}

/**
 * True when this device has seen the app in an EARLIER session than the
 * current one. False on the first visit, in the session onboarding completed
 * in, and whenever storage is unavailable (fail quiet: no install pitch).
 */
export function hasPriorAppSession(): boolean {
  try {
    const first = localStorage.getItem(FIRST_VISIT_KEY)
    return Boolean(first) && first !== currentAppSessionId()
  } catch {
    return false
  }
}

/**
 * Called when onboarding finishes on this device: sets the legacy per-device
 * flag and makes the current session the "first app visit", so the install
 * card waits for the next session.
 */
export function markOnboardingCompletedOnDevice(): void {
  try {
    localStorage.setItem(ONBOARDING_FLAG, '1')
    localStorage.setItem(FIRST_VISIT_KEY, currentAppSessionId())
  } catch { /* storage blocked: nothing to remember */ }
}

/** Whether `pathname` is `prefix` itself or below it. */
export function matchesRoutePrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(p + '/'))
}

/** Test hook: forget the in-memory session id. */
export function __resetAppSessionForTests(): void {
  memorySessionId = null
}
