import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * Signed Cloudflare Stream thumbnail for a player_videos row.
 *
 * Assets are created with requireSignedURLs, so the stored thumbnail_url 401s —
 * a short-lived signed URL (~1h TTL) must be minted per video via
 * video-playback-token, which is also the ACCESS CONTROL: it refuses videos the
 * viewer may not see, so this hook can never leak a restricted frame.
 *
 * Used by the Gallery grid tiles and the post composer preview. The cache is
 * session-lived and keyed by player_videos.id (a UUID — collisions impossible),
 * so a 12-video gallery mints each thumbnail once, not per re-render.
 *
 * Wire the returned handlers onto the <img>: on error the cached URL is
 * dropped and ONE fresh mint is attempted (covers expiry in long-lived tabs);
 * a second consecutive failure settles on `thumb: null` so callers show their
 * branded fallback. Successful loads reset the failure counter.
 */

const cache = new Map<string, string>()

export function useSignedVideoThumbnail(
  videoId: string | null | undefined,
  /** Gate the mint (e.g. viewport visibility). Cached URLs ignore the gate —
   *  rendering them costs no network. */
  enabled = true,
) {
  const [thumb, setThumb] = useState<string | null>(() =>
    videoId ? cache.get(videoId) ?? null : null,
  )
  const [failed, setFailed] = useState(false)
  const attemptsRef = useRef(0)

  // Reset when the hook instance is reused for a different video (callers key
  // tiles by id so this is usually a remount, but don't depend on that).
  const prevIdRef = useRef(videoId)
  if (prevIdRef.current !== videoId) {
    prevIdRef.current = videoId
    attemptsRef.current = 0
    setThumb(videoId ? cache.get(videoId) ?? null : null)
    setFailed(false)
  }

  useEffect(() => {
    if (!videoId || !enabled || thumb || failed) return
    let cancelled = false
    void supabase.functions
      .invoke('video-playback-token', { body: { videoId } })
      .then(({ data, error }) => {
        if (cancelled) return
        const url = (data as { thumbnail?: string } | null)?.thumbnail
        if (!error && url) {
          cache.set(videoId, url)
          setThumb(url)
        } else {
          setFailed(true)
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [videoId, enabled, thumb, failed])

  const onThumbError = () => {
    if (!videoId) return
    cache.delete(videoId)
    attemptsRef.current += 1
    if (attemptsRef.current > 1) {
      setFailed(true)
    } else {
      setThumb(null) // the effect re-mints a fresh signed URL
    }
  }

  const onThumbLoad = () => {
    attemptsRef.current = 0
  }

  return { thumb: failed ? null : thumb, onThumbError, onThumbLoad }
}
