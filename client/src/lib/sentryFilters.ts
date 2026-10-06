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
const STALE_CHUNK_SIGNATURES = [
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
