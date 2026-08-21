import { AUTH_STORAGE_KEY } from './supabase'

/**
 * Synchronous evidence that a session restore is POSSIBLE — read before the
 * async auth hydration has run.
 *
 * WHY (founder report, 2026-08-17): the auth store boots with
 * `loading: true` and resolves the persisted session asynchronously. Any
 * screen that renders unauthenticated UI during that window shows a signed-in
 * member a flash of "Create account" before the redirect fires — the
 * launch-screen flicker on the native welcome. The fix is to pick the first
 * frame from evidence that IS available synchronously: supabase-js persists
 * the session JSON under AUTH_STORAGE_KEY, so its presence tells us, before
 * any async work, whether hydration could produce a user.
 *
 * Contract:
 *  - true  → a stored session exists; hydration will either restore it or
 *            (expired/revoked refresh token) resolve to signed-out. Callers
 *            should show a NEUTRAL loading state, never unauthenticated UI.
 *  - false → nothing stored; hydration cannot produce a user, so
 *            unauthenticated UI may render immediately — a fresh install
 *            pays zero delay.
 *
 * Deliberately does NOT check `expires_at`: an expired access token with a
 * valid refresh token still restores (supabase refreshes it during
 * hydration). Expiry is hydration's call, not ours — we only answer "is a
 * restore possible at all?". Malformed/garbage storage reads as false.
 */
export function hasPersistedSession(): boolean {
  try {
    const raw = window.localStorage.getItem(AUTH_STORAGE_KEY)
    if (!raw) return false
    const stored = JSON.parse(raw) as { access_token?: unknown; refresh_token?: unknown } | null
    return typeof stored?.access_token === 'string' && typeof stored?.refresh_token === 'string'
  } catch {
    return false
  }
}
