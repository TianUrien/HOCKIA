/**
 * Short links — /l/<code> — pure helpers (no Supabase import: CI-safe).
 *
 * A short link expands to a destination plus a fixed utm set. The expansion
 * always carries `hk_link=<code>` so the attribution engine records which
 * link brought the visitor (signup_attribution.link_id).
 *
 * Destinations:
 *   '/path'         in-app route → SPA navigation (the external referrer
 *                   survives because no new document loads)
 *   'https://…'     external page → full redirect with utm appended
 *   'store'         iOS → App Store; everything else → Play, with the utm
 *                   set packed into the Install Referrer param that the
 *                   Android app reads on first launch (Phase 3)
 */

export const SHORT_LINK_PATH_RE = /^\/l\/([a-z0-9][a-z0-9-]{1,31})\/?$/i
export const APP_STORE_URL = 'https://apps.apple.com/app/hockia/id6760937891'
export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.inhockia.app'
export const SHORT_LINK_PARAM = 'hk_link'

export interface ShortLink {
  code: string
  destination: string
  utm_source: string
  utm_medium?: string | null
  utm_campaign?: string | null
  utm_content?: string | null
  utm_term?: string | null
}

export interface ShortLinkTarget {
  url: string
  /** true → leave the SPA (window.location), false → in-app navigate */
  external: boolean
}

/** The code in a short-link path, or null when the path is not one. */
export function shortLinkCode(pathname: string): string | null {
  const m = SHORT_LINK_PATH_RE.exec(pathname)
  return m ? m[1].toLowerCase() : null
}

export function isShortLinkPath(pathname: string): boolean {
  return shortLinkCode(pathname) !== null
}

/** utm_* + hk_link as URLSearchParams — the same set in every expansion. */
export function shortLinkParams(link: ShortLink): URLSearchParams {
  const p = new URLSearchParams()
  p.set('utm_source', link.utm_source)
  if (link.utm_medium) p.set('utm_medium', link.utm_medium)
  if (link.utm_campaign) p.set('utm_campaign', link.utm_campaign)
  if (link.utm_content) p.set('utm_content', link.utm_content)
  if (link.utm_term) p.set('utm_term', link.utm_term)
  p.set(SHORT_LINK_PARAM, link.code)
  return p
}

function withParams(url: string, params: URLSearchParams): string {
  const [base, hash] = url.split('#', 2)
  const joiner = base.includes('?') ? '&' : '?'
  return `${base}${joiner}${params.toString()}${hash ? `#${hash}` : ''}`
}

function isPlayStore(url: string): boolean {
  try {
    return new URL(url).hostname === 'play.google.com'
  } catch {
    return false
  }
}

/** Play carries campaign data in `referrer`, url-encoded, not in the query. */
function playWithReferrer(url: string, params: URLSearchParams): string {
  const u = new URL(url)
  u.searchParams.set('referrer', params.toString())
  return u.toString()
}

export function buildShortLinkTarget(link: ShortLink, opts: { isIOS: boolean }): ShortLinkTarget {
  const params = shortLinkParams(link)
  const dest = link.destination || '/'

  if (dest === 'store') {
    return opts.isIOS
      ? { url: withParams(APP_STORE_URL, params), external: true }
      : { url: playWithReferrer(PLAY_STORE_URL, params), external: true }
  }
  if (dest.startsWith('/')) {
    return { url: withParams(dest, params), external: false }
  }
  if (isPlayStore(dest)) {
    return { url: playWithReferrer(dest, params), external: true }
  }
  return { url: withParams(dest, params), external: true }
}

/** Only https destinations, in-app paths and the store keyword are valid. */
export function isValidDestination(dest: string): boolean {
  if (dest === 'store') return true
  if (dest.startsWith('/')) return !dest.startsWith('//')
  if (!dest.startsWith('https://')) return false
  try {
    new URL(dest)
    return true
  } catch {
    return false
  }
}

export const SHORT_LINK_CODE_RE = /^[a-z0-9][a-z0-9-]{1,31}$/

/** A code suggestion from a label: "Instagram bio" → "instagram-bio". */
export function suggestCode(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
}

export function isIOSUserAgent(ua: string): boolean {
  return /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && /Mobile/.test(ua))
}
