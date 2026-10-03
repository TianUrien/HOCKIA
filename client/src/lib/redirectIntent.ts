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
