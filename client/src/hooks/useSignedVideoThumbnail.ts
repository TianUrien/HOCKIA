import { useEffect, useRef, useState } from 'react'
import { PlaybackTokenError, clearPlaybackTokenCache, getPlaybackToken, peekPlaybackToken, sizedThumbnail } from '@/lib/playbackToken'

/**
 * Signed Cloudflare Stream thumbnail for a player_videos row, at display size.
 *
 * Assets are created with requireSignedURLs, so the stored thumbnail_url 401s;
 * the signed URL comes from the shared playback-token cache (one mint per video
 * per session — see lib/playbackToken.ts), so the browser can cache the image
 * across Feed, Profile, Videos — all and Manage media.
 *
 * Failure policy: a mint failure or an image error retries ONCE with a fresh
 * token; a second failure (or a load that never completes within the timeout,
 * then fails again) settles on `unavailable` — a dead asset. Access denial
 * (401/403) is `unavailable` immediately: nothing to retry.
 */
export function clearSignedThumbnailCache(): void {
  clearPlaybackTokenCache()
}

const LOAD_TIMEOUT_MS = 12_000

export function useSignedVideoThumbnail(
  videoId: string | null | undefined,
  /** Gate the mint (viewport proximity). Cached URLs ignore the gate. */
  enabled = true,
  /** Display size in CSS px; the request asks for 2×. */
  size: { width: number; height?: number } = { width: 240 },
) {
  const w = Math.round(size.width * 2)
  const h = size.height ? Math.round(size.height * 2) : undefined
  const fromCache = () => { const t = videoId ? peekPlaybackToken(videoId) : null; return t ? sizedThumbnail(t.thumbnail, w, h) : null }
  const [thumb, setThumb] = useState<string | null>(fromCache)
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const attemptsRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const prevIdRef = useRef(videoId)
  if (prevIdRef.current !== videoId) {
    prevIdRef.current = videoId
    attemptsRef.current = 0
    setThumb(fromCache())
    setFailed(false)
    setLoaded(false)
  }

  useEffect(() => {
    if (!videoId || !enabled || thumb || failed) return
    let cancelled = false
    getPlaybackToken(videoId, { force: attemptsRef.current > 0 })
      .then((t) => { if (!cancelled) setThumb(sizedThumbnail(t.thumbnail, w, h)) })
      .catch((err) => {
        if (cancelled) return
        const status = err instanceof PlaybackTokenError ? err.status : null
        if (status === 401 || status === 403 || attemptsRef.current >= 1) setFailed(true)
        else { attemptsRef.current += 1; setThumb(null) } // one more try on the next tick
      })
    return () => { cancelled = true }
  }, [videoId, enabled, thumb, failed, w, h])

  // A load that never completes (slow network, stalled CDN) counts as a miss:
  // after the timeout, re-mint once; only a second miss shows "unavailable".
  useEffect(() => {
    if (!thumb || loaded || failed) return
    timerRef.current = setTimeout(() => { if (attemptsRef.current < 1) { attemptsRef.current += 1; setThumb(null) } }, LOAD_TIMEOUT_MS)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [thumb, loaded, failed])

  const onThumbError = () => {
    if (!videoId) return
    attemptsRef.current += 1
    if (attemptsRef.current > 1) setFailed(true)
    else setThumb(null) // the effect re-mints with force (attempts > 0)
  }
  const onThumbLoad = () => { attemptsRef.current = 0; setLoaded(true) }

  return { thumb: failed ? null : thumb, loaded, onThumbError, onThumbLoad, unavailable: failed }
}
