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
  const trimmed = url.trim()
  if (!trimmed) return null

  try {
    // YouTube
    if (trimmed.includes('youtube.com') || trimmed.includes('youtu.be')) {
      let videoId = ''
      if (trimmed.includes('youtu.be/')) {
        videoId = trimmed.split('youtu.be/')[1]?.split('?')[0] || ''
      } else if (trimmed.includes('youtube.com')) {
        const urlParams = new URLSearchParams(trimmed.split('?')[1] || '')
        videoId = urlParams.get('v') || ''
      }
      if (!videoId) return null
      return `https://www.youtube.com/watch?v=${videoId}`
    }

    // Vimeo
    if (trimmed.includes('vimeo.com')) {
      const videoId = trimmed.split('vimeo.com/')[1]?.split('?')[0]
      if (!videoId) return null
      return `https://vimeo.com/${videoId}`
    }

    // Google Drive
    if (trimmed.includes('drive.google.com')) {
      let fileId = ''
      if (trimmed.includes('/file/d/')) {
        fileId = trimmed.split('/file/d/')[1]?.split('/')[0] || ''
      } else {
        const urlParams = new URLSearchParams(trimmed.split('?')[1] || '')
        fileId = urlParams.get('id') || ''
      }
      if (!fileId) return null
      return `https://drive.google.com/file/d/${fileId}/view`
    }

    return null
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
