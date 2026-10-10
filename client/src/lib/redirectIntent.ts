import { isSafeRedirectPath } from '@/lib/safeRedirect'

/**
 * `?next=` preservation across the OAuth / magic-link round-trip.
 *
 * The redirect loses the URL query param, so the auth screens stash the
 * intended destination in sessionStorage before leaving the page and
 * AuthCallback reads it back under the same key. The target is validated at
 * the WRITE point too (defence in depth): never persist a redirect that is not
 * a safe same-origin path. The key is shared with AuthCallback, ProtectedRoute
 * and the sign-out cleanup in lib/auth.
 */
export const REDIRECT_INTENT_KEY = 'hockia-redirect-after-login'

export function stashRedirectIntent(next: string | null | undefined): void {
  if (!next || !isSafeRedirectPath(next)) return
  try {
    sessionStorage.setItem(REDIRECT_INTENT_KEY, next)
  } catch {
    /* incognito / storage-disabled browsers just lose the next param */
  }
}

export function clearRedirectIntent(): void {
  try {
    sessionStorage.removeItem(REDIRECT_INTENT_KEY)
  } catch {
    /* noop */
  }
}

/**
 * user_metadata key carrying the destination across browsers. Email sign-up
 * writes it, because the confirmation link often opens in a different
 * browser (Instagram / Facebook in-app browser → Mail → Safari) whose
 * sessionStorage is empty. Cleared on first use.
 */
export const POST_AUTH_NEXT_KEY = 'post_auth_next'

/** The destination this sign-up is heading to, without consuming it: the
 *  validated `?next=`, else this tab's stash (club invites, protected-route
 *  bounces). */
export function pendingRedirectIntent(next: string | null | undefined): string | null {
  if (next && isSafeRedirectPath(next)) return next
  try {
    const saved = sessionStorage.getItem(REDIRECT_INTENT_KEY)
    return saved && isSafeRedirectPath(saved) ? saved : null
  } catch {
    return null
  }
}

interface MetadataUser {
  user_metadata?: Record<string, unknown> | null
}

/**
 * Where to send a member once auth / onboarding is done: the destination
 * stashed in this tab, else the one carried in their account metadata. Both
 * are re-validated (same-origin path) and cleared, so it is used once.
 * Returns null when there is none — the caller keeps its default. Screens
 * use `consumeCarriedRedirect` (lib/redirectIntentCarry), which supplies the
 * metadata clear; this module stays free of the Supabase client.
 */
export function consumeRedirectIntent(user: MetadataUser | null | undefined, clearMetadata: () => void): string | null {
  let saved: string | null = null
  try {
    saved = sessionStorage.getItem(REDIRECT_INTENT_KEY)
  } catch {
    /* storage blocked */
  }
  clearRedirectIntent()
  const carried = user?.user_metadata?.[POST_AUTH_NEXT_KEY]
  if (typeof carried === 'string' && carried) clearMetadata()
  if (saved && isSafeRedirectPath(saved)) return saved
  if (typeof carried === 'string' && isSafeRedirectPath(carried)) return carried
  return null
}
