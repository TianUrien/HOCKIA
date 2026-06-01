import { useState, useCallback, useEffect } from 'react'
import { Play, Loader2, AlertCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'

/**
 * NativeVideoPlayer — click-to-load player for a natively-uploaded
 * (Cloudflare Stream) player_videos row.
 *
 * Same façade pattern as the embed player: a clean 16:9 poster
 * (thumbnail + play button) at rest; on tap we mint a short-lived,
 * ROLE-GATED signed playback token via the video-playback-token Edge
 * Function and mount Cloudflare's signed iframe player (handles HLS +
 * native fullscreen on iOS/Android with no extra dependency).
 *
 * The asset is requireSignedURLs, so without a successful token mint
 * there's simply no playable URL — this is how "recruiters only" is
 * actually enforced (the function refuses to mint for non-recruiters).
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
  const [iframeUrl, setIframeUrl] = useState<string | null>(null)
  const [signedThumb, setSignedThumb] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Mint a signed playback token on mount. The asset is requireSignedURLs,
  // so the stored thumbnail_url (an UNSIGNED customer-subdomain URL) 401s —
  // we must use the SIGNED thumbnail the token fn returns. One call gives
  // us both the poster (now) and the iframe (on play), and also surfaces
  // access-denial early so a recruiters-only card reads correctly at rest.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('video-playback-token', { body: { videoId } })
        if (cancelled) return
        if (error || !data?.iframe) {
          const code = (error as { context?: { status?: number } } | null)?.context?.status
          if (code === 403 || code === 401) {
            setErrorMsg('Visible to recruiters (clubs and coaches) only.')
            setState('error')
          }
          // generic/other: leave at idle so the play button still lets them retry
          return
        }
        setIframeUrl(data.iframe as string)
        if (data.thumbnail) setSignedThumb(data.thumbnail as string)
      } catch (err) {
        if (!cancelled) logger.error('[NativeVideoPlayer] token prefetch failed', err)
      }
    })()
    return () => { cancelled = true }
  }, [videoId])

  const activate = useCallback(() => {
    if (state === 'error') return
    if (iframeUrl) { setState('playing'); return }
    // token not ready yet — show loading; the effect above will set it.
    setState('loading')
  }, [iframeUrl, state])

  // If the user tapped before the token arrived, start playing once it lands.
  useEffect(() => {
    if (state === 'loading' && iframeUrl) setState('playing')
  }, [state, iframeUrl])

  const duration = formatDuration(durationSeconds)

  return (
    <div className="relative w-full overflow-hidden rounded-xl bg-black aspect-video">
      {state === 'playing' && iframeUrl ? (
        <iframe
          // controls=true → the player's control bar (play/PAUSE/scrub/
          // fullscreen/volume) is shown; autoplay=true starts it on tap.
          // Without controls the bar was hidden, so the user couldn't pause.
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
