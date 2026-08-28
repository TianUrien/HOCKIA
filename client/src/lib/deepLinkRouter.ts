/**
 * Native deep-link router (attribution Phase 3) — pure helpers.
 *
 * A URL that opens the app can be:
 *   hockia://auth/callback?…            OAuth return — owned by lib/nativeOAuth, ignored here
 *   hockia://app.inhockia.com/<path>    custom-scheme deep link
 *   https://app.inhockia.com/<path>     universal / App Link (needs AASA + assetlinks.json — pending)
 *
 * The router turns the URL into an in-app navigation and records the touch
 * (utm / hk_link) so a link-driven app open attributes like a web landing.
 * No Capacitor import here so the logic is testable without a native shell.
 */

export const APP_HOSTS = ['app.inhockia.com', 'inhockia.com', 'www.inhockia.com']
export const APP_SCHEME = 'hockia'

export interface DeepLinkTarget {
  /** In-app path + search to navigate to. */
  to: string
  /** Original URL, for the attribution touch. */
  url: string
}

/** Resolve an opened URL into an in-app target, or null when it is not ours. */
export function resolveDeepLink(url: string | null | undefined): DeepLinkTarget | null {
  if (!url) return null
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  const scheme = u.protocol.replace(':', '').toLowerCase()
  const host = u.hostname.toLowerCase()

  if (scheme === APP_SCHEME) {
    // hockia://auth/callback belongs to the OAuth flow.
    if (host === 'auth') return null
    // hockia://app.inhockia.com/path  OR  hockia:///path  OR  hockia://path (host = first segment)
    let path = u.pathname || '/'
    if (host && !APP_HOSTS.includes(host)) path = '/' + host + (path === '/' ? '' : path)
    return { to: normalizePath(path) + u.search, url }
  }
  if ((scheme === 'https' || scheme === 'http') && APP_HOSTS.includes(host)) {
    if (u.pathname.startsWith('/auth/callback')) return null
    return { to: normalizePath(u.pathname) + u.search, url }
  }
  return null
}

function normalizePath(p: string): string {
  const path = ('/' + p).replace(/\/{2,}/g, '/')
  return path.length > 1 ? path.replace(/\/$/, '') : path
}
