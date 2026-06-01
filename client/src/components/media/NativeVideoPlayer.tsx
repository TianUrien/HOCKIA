import { useState, useCallback } from 'react'
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
  thumbnailUrl,
  title,
  durationSeconds,
}: NativeVideoPlayerProps) {
  const [state, setState] = useState<'idle' | 'loading' | 'playing' | 'error'>('idle')
  const [iframeUrl, setIframeUrl] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const activate = useCallback(async () => {
    setState('loading')
    setErrorMsg(null)
    try {
      const { data, error } = await supabase.functions.invoke('video-playback-token', {
        body: { videoId },
      })
      if (error || !data?.iframe) {
        // Distinguish access-denied from generic failure for a clear message.
        const code = (error as { context?: { status?: number } } | null)?.context?.status
        if (code === 403 || code === 401) {
          setErrorMsg('This video is visible to recruiters (clubs and coaches) only.')
        } else {
          setErrorMsg('Could not load this video. Please try again.')
        }
        setState('error')
        return
      }
      setIframeUrl(data.iframe as string)
      setState('playing')
    } catch (err) {
      logger.error('[NativeVideoPlayer] token mint failed', err)
      setErrorMsg('Could not load this video. Please try again.')
      setState('error')
    }
  }, [videoId])

  const duration = formatDuration(durationSeconds)

  return (
    <div className="relative w-full overflow-hidden rounded-xl bg-black aspect-video">
      {state === 'playing' && iframeUrl ? (
        <iframe
          src={`${iframeUrl}?autoplay=true`}
          className="absolute inset-0 h-full w-full border-0"
          allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
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
          {/* Real Cloudflare thumbnail, object-cover cropped. Falls back to
              a branded gradient if absent / fails. */}
          {thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt=""
              aria-hidden="true"
              className="absolute inset-0 h-full w-full object-cover"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
            />
          ) : null}
          <span
            className="absolute inset-0 bg-gradient-to-br from-[#1a1030] via-[#2a1a4a] to-[#8026FA]/40"
            aria-hidden="true"
            style={thumbnailUrl ? { background: 'rgba(0,0,0,0.30)' } : undefined}
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
