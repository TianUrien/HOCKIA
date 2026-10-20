/**
 * Pure classifiers that keep Sentry for real bugs. No imports, so they are
 * shared by App.tsx, ErrorBoundary, sentryHelpers and main.tsx's beforeSend,
 * and unit-tested directly.
 */

/**
 * Stale-chunk signatures: after a deploy, a tab still running the previous
 * build asks for hashed chunk files that no longer exist.
 *   - Chrome / Edge:  "Failed to fetch dynamically imported module: …"
 *   - Firefox:        "error loading dynamically imported module: …"
 *   - Safari / iOS:   "Importing a module script failed."
 *   - Generic:        "Failed to load module script …"
 *   - Safari, when Vercel's SPA fallback serves HTML for the missing chunk:
 *                     "… is not a valid JavaScript MIME type"
 */
/** Thrown by App.tsx lazyWithRetry when a chunk loads but no longer exports
 *  what this shell expects — an older deploy's file served to a newer shell
 *  (JAVASCRIPT-REACT-DP "reading 'AdminGuard'", -DM "e._result.default"). */
export const STALE_EXPORT_MESSAGE = 'Stale chunk: missing export'

const STALE_CHUNK_SIGNATURES = [
  STALE_EXPORT_MESSAGE.toLowerCase(),
  'failed to fetch dynamically imported module',
  'error loading dynamically imported module',
  'importing a module script failed',
  'failed to load module script',
  'is not a valid javascript mime type',
]

export function isStaleChunkMessage(message: string | null | undefined): boolean {
  if (typeof message !== 'string' || !message) return false
  const msg = message.toLowerCase()
  return STALE_CHUNK_SIGNATURES.some((s) => msg.includes(s))
}

/**
 * Business refusals the database raises ON PURPOSE and the UI already explains
 * — not bugs, so never reported as errors (release audit 2026-10-06).
 *   - Messaging a blocked / age-gated member (enforce_message_not_blocked).
 *   - The daily new-conversation allowance: DETAIL 'new_conversation_limit'
 *     (same literals as lib/newConversationLimit.ts, kept import-free here;
 *     a test asserts they stay equal).
 */
export const NOT_AVAILABLE_FOR_MESSAGING = 'This user is not available for messaging right now'
export const NEW_CONVERSATION_LIMIT_DETAIL = 'new_conversation_limit'
export const NEW_CONVERSATION_LIMIT_TEXT = "You've started a lot of new conversations today"

/** Substrings for Sentry `ignoreErrors` (matched against the event message). */
export const EXPECTED_REFUSAL_MESSAGES = [NOT_AVAILABLE_FOR_MESSAGING, NEW_CONVERSATION_LIMIT_TEXT]

export function isExpectedRefusal(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { message?: unknown; details?: unknown }
  if (e.details === NEW_CONVERSATION_LIMIT_DETAIL) return true
  const message = typeof e.message === 'string' ? e.message : ''
  return EXPECTED_REFUSAL_MESSAGES.some((m) => message.includes(m))
}

/**
 * Expected user-side outcomes (Sentry visibility pass, 2026-10-19). They used
 * to be silent `ignoreErrors` — ~1,000 events in 30 days vanished, so a surge
 * (everyone suddenly getting "Invalid login credentials" after a bad deploy)
 * would have been invisible. Now they are COUNTED: sampled, info-level, tagged
 * `expected:<key>` and grouped per key, so they never page but a spike shows.
 * Pure noise (bots, extensions, cancelled fetches) stays in `ignoreErrors`.
 */
export const EXPECTED_USER_ERRORS: { key: string; match: string }[] = [
  { key: 'login_wrong_password', match: 'Invalid login credentials' },
  { key: 'login_unconfirmed', match: 'Email not confirmed' },
  { key: 'auth_rate_limit', match: 'Email rate limit exceeded' },
  { key: 'auth_rate_limit', match: 'Request rate limit reached' },
  { key: 'auth_cooldown', match: 'you can only request this after' },
  { key: 'signup_duplicate', match: 'User already registered' },
  { key: 'signup_weak_password', match: 'Password is known to be weak' },
  { key: 'signup_weak_password', match: 'Password should contain at least one character' },
  { key: 'oauth_timeout', match: 'OAuth timed out after 5 minutes' },
  { key: 'oauth_superseded', match: 'OAuth cancelled — superseded by a newer sign-in attempt' },
  // Turnstile: no token in the browser, or Supabase refused it (lib/captcha).
  { key: 'captcha_failed', match: 'captcha' },
  // The class behind the lost sign-up of 2026-10-17: count it, never hide it.
  { key: 'auth_session_missing', match: 'Auth session missing' },
]

/** Share of expected outcomes sent (counts in Sentry are ×4 estimates). */
export const EXPECTED_SAMPLE_RATE = 0.25

/** The expected-outcome key for an error message or raw error, or null for a real error. */
export function expectedErrorKey(message: string, original?: unknown): string | null {
  if (isExpectedRefusal(original) || EXPECTED_REFUSAL_MESSAGES.some((m) => message.includes(m))) return 'refusal'
  return EXPECTED_USER_ERRORS.find((e) => message.includes(e.match))?.key ?? null
}
