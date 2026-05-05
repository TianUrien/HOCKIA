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

export const VIDEO_URL_HOSTS_HUMAN = 'YouTube, Vimeo, or Google Drive'
