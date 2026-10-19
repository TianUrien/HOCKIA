/**
 * Where a member came from when a page opens (Home tracking gap 6, 2026-10-19).
 *
 * Role views and application submits need a `source` so the Home rethink can
 * see which surface starts recruiting actions. Two carriers, read in order:
 *  1. router state `{ source }` — in-app navigations (`navigate(path, navState(src))`);
 *  2. the `?src=` query parameter — links that arrive from outside the SPA
 *     (push taps, emails, shares), appended with `withSource`.
 * Anything else reads as 'direct'. Values are short snake_case words, never ids.
 */

export const NAV_SOURCE_PARAM = 'src'
const SOURCE_RE = /^[a-z][a-z0-9_]{0,31}$/

/** Router state for `navigate(to, navState('home_role_card'))`. */
export function navState(source: string): { state: { source: string } } {
  return { state: { source } }
}

/** Append `?src=<source>` to an app path, keeping its query and hash. */
export function withSource(path: string, source: string): string {
  if (!SOURCE_RE.test(source)) return path
  const hashAt = path.indexOf('#')
  const hash = hashAt >= 0 ? path.slice(hashAt) : ''
  const base = hashAt >= 0 ? path.slice(0, hashAt) : path
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}${NAV_SOURCE_PARAM}=${source}${hash}`
}

/** The source for the current page: router state, then `?src=`, else 'direct'. */
export function readNavSource(location: { state?: unknown; search?: string }): string {
  const fromState = (location.state as { source?: unknown } | null)?.source
  if (typeof fromState === 'string' && SOURCE_RE.test(fromState)) return fromState
  const fromQuery = new URLSearchParams(location.search ?? '').get(NAV_SOURCE_PARAM)
  if (fromQuery && SOURCE_RE.test(fromQuery)) return fromQuery
  return 'direct'
}
