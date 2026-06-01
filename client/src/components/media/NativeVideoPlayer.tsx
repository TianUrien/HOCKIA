import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
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
  /** The viewer is the profile OWNER managing their own Media tab. The
   *  owner can always play their own video regardless of visibility — so
   *  we never show them the recruiters-only gated message, and we retry
   *  the token once if the first call races their session auth. */
  isOwner?: boolean
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
  isOwner = false,
}: NativeVideoPlayerProps) {
  const [state, setState] = useState<'idle' | 'loading' | 'playing' | 'error'>('idle')
  const [hlsUrl, setHlsUrl] = useState<string | null>(null)
  const [iframeUrl, setIframeUrl] = useState<string | null>(null)
  const [signedThumb, setSignedThumb] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const videoElRef = useRef<HTMLVideoElement | null>(null)

  // Can THIS browser play HLS natively in a <video>? True on Safari / iOS /
  // the Capacitor WKWebView — our App Store target, and exactly where the
  // cross-origin-iframe gesture bug bites. There we use a native <video>
  // (correct touch ownership). Where HLS isn't native (desktop + Android
  // Chrome) we fall back to the Cloudflare iframe — which works fine on
  // those platforms — rather than pull in hls.js (~430KB, blows the
  // bundle budget for a path that isn't the reported problem).
  const nativeHls = useMemo(() => {
    if (typeof document === 'undefined') return false
    const v = document.createElement('video')
    return v.canPlayType('application/vnd.apple.mpegurl') !== ''
  }, [])

  // Mint a signed playback token on mount. The asset is requireSignedURLs,
  // so the stored thumbnail_url (UNSIGNED) 401s — we use the SIGNED
  // thumbnail + HLS/iframe the token fn returns. One call gives the poster
  // (now) and the playback source (on play), and surfaces access-denial
  // early so a recruiters-only card reads correctly at rest.
  useEffect(() => {
    let cancelled = false
    const mintToken = async (attempt: number): Promise<void> => {
      try {
        const { data, error } = await supabase.functions.invoke('video-playback-token', { body: { videoId } })
        if (cancelled) return
        if (error || !data?.hls) {
          const code = (error as { context?: { status?: number } } | null)?.context?.status
          // The OWNER must always be able to play their own video. A 401/403
          // for an owner means the session JWT hadn't attached yet (race on
          // first paint, e.g. right after upload) — NOT a real denial. Retry
          // once after a short beat; never show the owner the gated message.
          if ((code === 403 || code === 401) && isOwner && attempt === 0) {
            setTimeout(() => { if (!cancelled) void mintToken(1) }, 1200)
            return
          }
          if ((code === 403 || code === 401) && !isOwner) {
            setErrorMsg('Visible to recruiters (clubs and coaches) only.')
            setState('error')
          }
          return
        }
        setHlsUrl(data.hls as string)
        if (data.iframe) setIframeUrl(data.iframe as string)
        if (data.thumbnail) setSignedThumb(data.thumbnail as string)
      } catch (err) {
        if (!cancelled) logger.error('[NativeVideoPlayer] token prefetch failed', err)
      }
    }
    void mintToken(0)
    return () => { cancelled = true }
  }, [videoId, isOwner])

  const ready = nativeHls ? !!hlsUrl : !!iframeUrl
  const activate = useCallback(() => {
    if (state === 'error') return
    if (ready) { setState('playing'); return }
    setState('loading') // token not ready yet — the effect below promotes it
  }, [ready, state])

  useEffect(() => {
    if (state === 'loading' && ready) setState('playing')
  }, [state, ready])

  // Native path: attach the signed HLS manifest to the <video> on play.
  useEffect(() => {
    if (state !== 'playing' || !nativeHls || !hlsUrl) return
    const video = videoElRef.current
    if (!video) return
    video.src = hlsUrl
    void video.play().catch(() => { /* autoplay may be blocked; controls remain */ })
  }, [state, nativeHls, hlsUrl])

  const duration = formatDuration(durationSeconds)

  return (
    <div className="relative w-full overflow-hidden rounded-xl bg-black aspect-video">
      {state === 'playing' && nativeHls && hlsUrl ? (
        // Native HTML5 player (Safari/iOS/WKWebView) — owns its own touch
        // gestures, fixing the iOS "page scrolls instead of controlling
        // video" bug. playsInline keeps it inline on iPhone.
        <video
          ref={videoElRef}
          controls
          playsInline
          preload="metadata"
          poster={signedThumb ?? undefined}
          className="absolute inset-0 h-full w-full bg-black"
          title={title ?? 'Player video'}
        />
      ) : state === 'playing' && iframeUrl ? (
        // Fallback (desktop / Android Chrome — no native HLS): Cloudflare's
        // signed iframe player. The iframe-gesture quirk doesn't affect
        // these platforms; this avoids bundling hls.js.
        <iframe
          src={`${iframeUrl}?autoplay=true&controls=true`}
          className="absolute inset-0 h-full w-full border-0"
          allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen;"
          allowFullScreen
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
