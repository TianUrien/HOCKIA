/**
 * Validates and normalises video URLs (YouTube / Vimeo / Google Drive).
 *
 * Returns a normalised canonical URL string, or null when the URL doesn't
 * match a supported platform. Used by both AddVideoLinkModal (highlight
 * video) and FullGameVideoFormModal (full match footage) so the same
 * normalisation rules apply across video surfaces.
 *
 * URL-only — no file uploads. Direct upload is a future storage sprint.
 */
export function validateAndNormalizeVideoUrl(url: string): string | null {
  const parsed = parseVideoUrl(url)
  if (!parsed) return null
  if (parsed.platform === 'youtube') return `https://www.youtube.com/watch?v=${parsed.id}`
  if (parsed.platform === 'vimeo') return `https://vimeo.com/${parsed.id}`
  return `https://drive.google.com/file/d/${parsed.id}/view`
}

type VideoRef = { platform: 'youtube' | 'vimeo' | 'drive'; id: string }

// Hosts are matched on the PARSED hostname, never as a substring of the text
// (CodeQL 2026-10-23: "evil.com/?youtube.com" must not count as YouTube).
const onHost = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`)
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/

/** The platform and video id of a YouTube / Vimeo / Drive link, or null. */
function parseVideoUrl(url: string): VideoRef | null {
  const trimmed = (url ?? '').trim()
  if (!trimmed || /\s/.test(trimmed)) return null
  // "youtu.be/abc" typed without a scheme is a web link.
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
  let u: URL
  try {
    u = new URL(withScheme)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  const host = u.hostname.toLowerCase()
  const parts = u.pathname.split('/').filter(Boolean)
  let ref: VideoRef | null = null
  if (onHost(host, 'youtu.be')) ref = { platform: 'youtube', id: parts[0] ?? '' }
  else if (onHost(host, 'youtube.com') || onHost(host, 'youtube-nocookie.com')) {
    const id = u.searchParams.get('v') ?? (['shorts', 'embed'].includes(parts[0] ?? '') ? parts[1] : null)
    ref = { platform: 'youtube', id: id ?? '' }
  } else if (onHost(host, 'vimeo.com')) {
    const id = parts[0] === 'video' ? parts[1] : parts[0]
    ref = { platform: 'vimeo', id: id ?? '' }
  } else if (host === 'drive.google.com') {
    const id = parts[0] === 'file' && parts[1] === 'd' ? parts[2] : u.searchParams.get('id')
    ref = { platform: 'drive', id: id ?? '' }
  }
  return ref && SAFE_ID.test(ref.id) ? ref : null
}

/** The player URL to embed for a YouTube / Vimeo / Drive link; null for anything else (never the raw text). */
export function videoEmbedUrl(url: string | null | undefined): string | null {
  const ref = url ? parseVideoUrl(url) : null
  if (!ref) return null
  // YouTube: the privacy-enhanced domain (the standard player fails with
  // "Error 153" when its cookies are blocked: ITP, WKWebView, Brave);
  // rel=0 keeps suggestions to the channel, playsinline keeps iOS inline.
  if (ref.platform === 'youtube') return `https://www.youtube-nocookie.com/embed/${ref.id}?rel=0&playsinline=1`
  if (ref.platform === 'vimeo') return `https://player.vimeo.com/video/${ref.id}`
  return `https://drive.google.com/file/d/${ref.id}/preview`
}

/** "YouTube" / "Vimeo" / "Google Drive" for a supported link, else null. */
export function videoPlatformLabel(url: string | null | undefined): string | null {
  const ref = url ? parseVideoUrl(url) : null
  return ref ? ({ youtube: 'YouTube', vimeo: 'Vimeo', drive: 'Google Drive' } as const)[ref.platform] : null
}

/**
 * A stored video link that is safe to open: an https web address, else null.
 * Links come from members' own profiles, so a `javascript:` or `data:` value
 * written outside the app must never reach an href (CodeQL 2026-10-23).
 */
export function safeVideoHref(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url.trim())
    return u.protocol === 'https:' && !u.username && !u.password ? u.href : null
  } catch {
    return null
  }
}

const KNOWN_VIDEO_HOSTS = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|drive\.google\.com)$/

/**
 * Full-match links (founder ruling 5 Oct): any https link, because matches
 * live on many sites (Hockey TV, federation streams, Veo, Hudl, club sites).
 * They are only ever opened in a new tab, never embedded. YouTube / Vimeo /
 * Drive links keep their canonical form. Returns null when the text is not a
 * usable https web address.
 */
export function validateFullMatchUrl(url: string): string | null {
  const trimmed = url.trim()
  if (!trimmed || /\s/.test(trimmed)) return null
  // "www.site.com/match" typed without a scheme is an https link.
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
  let parsed: URL
  try {
    parsed = new URL(withScheme)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null
  const host = parsed.hostname.toLowerCase()
  // A real site name: has a dot, ends in letters (not an IP address or localhost).
  if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(host)) return null
  if (KNOWN_VIDEO_HOSTS.test(host)) {
    const canonical = validateAndNormalizeVideoUrl(parsed.href)
    if (canonical) return canonical
  }
  return parsed.href.length <= 500 ? parsed.href : null
}

/** "hockeytv.com" for a link tile, so viewers see where a link leads. */
export function videoLinkSite(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.toLowerCase().replace(/^(www|m)\./, '') || null
  } catch {
    return null
  }
}
