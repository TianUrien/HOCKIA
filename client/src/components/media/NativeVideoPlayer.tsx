import { useState, useCallback, useEffect, useRef } from 'react'
import { Play, Loader2, AlertCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'

/**
 * NativeVideoPlayer — click-to-load player for a natively-uploaded
 * (Cloudflare Stream) player_videos row.
 *
 * Uses a NATIVE HTML5 <video controls playsinline> element (NOT the
 * Cloudflare iframe). Why: on iOS Safari / the Capacitor WKWebView, taps
 * and vertical drags that begin on a cross-origin video IFRAME get routed
 * to page scrolling instead of the player's controls — the reported
 * "page scrolls instead of controlling the video" bug. A native <video>
 * element owns its own gestures, so play/pause/scrub/fullscreen work
 * correctly on mobile. It also matches the section's promise ("hosted on
 * HOCKIA — play instantly").
 *
 * Playback source is the SIGNED HLS manifest from video-playback-token.
 * Safari/iOS play HLS natively in <video>; other browsers (desktop +
 * Android Chrome) get hls.js, lazy-imported only when needed (its own
 * chunk, so no upfront bundle cost).
 *
 * The asset is requireSignedURLs, so without a successful token mint
 * there's no playable URL — this is how "recruiters only" is enforced
 * (the function refuses to mint for non-recruiters).
 */
interface NativeVideoPlayerProps {
  videoId: string
  thumbnailUrl?: string | null
  title?: string
  durationSeconds?: number | null
}

function formatDuration(s?: number | null): string | null {
  if (!s || s <= 0) return null
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}

export default function NativeVideoPlayer({
  videoId,
  // thumbnailUrl is intentionally NOT used: the stored value is an
  // unsigned URL that 401s on a requireSignedURLs asset. We render only
  // the SIGNED thumbnail fetched with the playback token below.
  title,
  durationSeconds,
}: NativeVideoPlayerProps) {
  const [state, setState] = useState<'idle' | 'loading' | 'playing' | 'error'>('idle')
  const [hlsUrl, setHlsUrl] = useState<string | null>(null)
  const [signedThumb, setSignedThumb] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const videoElRef = useRef<HTMLVideoElement | null>(null)

  // Mint a signed playback token on mount. The asset is requireSignedURLs,
  // so the stored thumbnail_url (an UNSIGNED customer-subdomain URL) 401s —
  // we must use the SIGNED thumbnail + HLS manifest the token fn returns.
  // One call gives us the poster (now) and the HLS source (on play), and
  // surfaces access-denial early so a recruiters-only card reads correctly.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('video-playback-token', { body: { videoId } })
        if (cancelled) return
        if (error || !data?.hls) {
          const code = (error as { context?: { status?: number } } | null)?.context?.status
          if (code === 403 || code === 401) {
            setErrorMsg('Visible to recruiters (clubs and coaches) only.')
            setState('error')
          }
          // generic/other: leave at idle so the play button still lets them retry
          return
        }
        setHlsUrl(data.hls as string)
        if (data.thumbnail) setSignedThumb(data.thumbnail as string)
      } catch (err) {
        if (!cancelled) logger.error('[NativeVideoPlayer] token prefetch failed', err)
      }
    })()
    return () => { cancelled = true }
  }, [videoId])

  const activate = useCallback(() => {
    if (state === 'error') return
    if (hlsUrl) { setState('playing'); return }
    // token not ready yet — show loading; the effect above will set it.
    setState('loading')
  }, [hlsUrl, state])

  // If the user tapped before the token arrived, start playing once it lands.
  useEffect(() => {
    if (state === 'loading' && hlsUrl) setState('playing')
  }, [state, hlsUrl])

  // Attach the HLS source to the native <video> once we're playing.
  // Safari/iOS play HLS natively (just set src). Other browsers need
  // hls.js, lazy-imported here so it's a separate chunk (no upfront cost).
  useEffect(() => {
    if (state !== 'playing' || !hlsUrl) return
    const video = videoElRef.current
    if (!video) return
    let hls: { destroy: () => void } | null = null
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS (Safari, iOS, the Capacitor WKWebView).
      video.src = hlsUrl
      void video.play().catch(() => { /* autoplay may be blocked; controls remain */ })
    } else {
      void import('hls.js').then(({ default: Hls }) => {
        if (Hls.isSupported() && videoElRef.current) {
          const instance = new Hls({ maxBufferLength: 30 })
          instance.loadSource(hlsUrl)
          instance.attachMedia(videoElRef.current)
          hls = instance
          void videoElRef.current.play().catch(() => {})
        } else if (videoElRef.current) {
          // Last-resort: let the element try the manifest directly.
          videoElRef.current.src = hlsUrl
        }
      }).catch((err) => logger.error('[NativeVideoPlayer] hls.js load failed', err))
    }
    return () => { if (hls) hls.destroy() }
  }, [state, hlsUrl])

  const duration = formatDuration(durationSeconds)

  return (
    <div className="relative w-full overflow-hidden rounded-xl bg-black aspect-video">
      {state === 'playing' && hlsUrl ? (
        // Native HTML5 player — owns its own touch gestures (fixes the
        // iOS "page scrolls instead of controlling video" bug) and gives
        // a comfortably-sized control bar + native fullscreen.
        // playsInline keeps it inline on iPhone instead of forcing the
        // OS fullscreen player on first tap.
        <video
          ref={videoElRef}
          controls
          playsInline
          preload="metadata"
          poster={signedThumb ?? undefined}
          className="absolute inset-0 h-full w-full bg-black"
          title={title ?? 'Player video'}
        />
      ) : (
        <button
          type="button"
          onClick={activate}
          disabled={state === 'loading'}
          aria-label="Play video"
          className="group absolute inset-0 flex flex-col items-center justify-center gap-3 overflow-hidden text-white"
        >
          {/* ONLY the SIGNED thumbnail is ever rendered. The stored
              thumbnailUrl is an unsigned customer-subdomain URL that 401s
              on a requireSignedURLs asset, so we must NOT paint it (even
              briefly) — the branded gradient covers the gap until the
              signed URL from the token fn arrives. object-cover cropped. */}
          {signedThumb ? (
            <img
              src={signedThumb}
              alt=""
              aria-hidden="true"
              className="absolute inset-0 h-full w-full object-cover"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
            />
          ) : null}
          <span
            className="absolute inset-0 bg-gradient-to-br from-[#1a1030] via-[#2a1a4a] to-[#8026FA]/40"
            aria-hidden="true"
            style={signedThumb ? { background: 'rgba(0,0,0,0.30)' } : undefined}
          />
          {state === 'loading' ? (
            <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-white/95 shadow-lg">
              <Loader2 className="h-6 w-6 animate-spin text-[#8026FA]" />
            </span>
          ) : state === 'error' ? (
            <>
              <AlertCircle className="relative h-8 w-8 text-white/90" />
              <span className="relative max-w-[80%] text-center text-xs text-white/90">{errorMsg}</span>
            </>
          ) : (
            <>
              <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-white/95 shadow-lg transition-transform group-hover:scale-105 group-active:scale-95">
                <Play className="ml-0.5 h-6 w-6 fill-[#8026FA] text-[#8026FA]" />
              </span>
              {title && <span className="relative px-4 text-center text-sm font-semibold">{title}</span>}
              {duration && (
                <span className="relative rounded bg-black/50 px-1.5 py-0.5 text-[11px] tabular-nums">
                  {duration}
                </span>
              )}
            </>
          )}
        </button>
      )}
    </div>
  )
}
