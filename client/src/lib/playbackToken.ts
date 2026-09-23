import { supabase } from '@/lib/supabase'

/**
 * ONE signed playback token per video per session, shared by every surface
 * (feed tiles, profile Video rows, Videos — all, Manage media, the player).
 *
 * video-playback-token is both the mint and the access gate (it refuses videos
 * the viewer may not see). Each call is an edge-function round trip PLUS a
 * Cloudflare token API call, and the signed URLs it returns are what the
 * browser caches — regenerating them per render or per fetch made every scroll
 * download every thumbnail again. So: memoise per video until the token is
 * about to expire, dedupe concurrent mints, and hand every caller the same URLs.
 */
export interface PlaybackToken {
  token: string | null
  /** Null only when the function answered without playback URLs (never in
   *  production; kept nullable so a thumbnail-only answer still serves tiles). */
  hls: string | null
  dash?: string
  iframe?: string
  thumbnail: string
  durationSeconds: number | null
  /** Epoch ms after which the URLs are no longer trusted. */
  expiresAt: number
}

export class PlaybackTokenError extends Error {
  status: number | null
  constructor(message: string, status: number | null) {
    super(message)
    this.name = 'PlaybackTokenError'
    this.status = status
  }
}

const cache = new Map<string, PlaybackToken>()
const inflight = new Map<string, Promise<PlaybackToken>>()
const SAFETY_MS = 60_000

export function clearPlaybackTokenCache(): void {
  cache.clear()
  inflight.clear()
}

export function peekPlaybackToken(videoId: string): PlaybackToken | null {
  const hit = cache.get(videoId)
  return hit && hit.expiresAt - SAFETY_MS > Date.now() ? hit : null
}

export function getPlaybackToken(videoId: string, opts: { force?: boolean } = {}): Promise<PlaybackToken> {
  if (!opts.force) {
    const hit = peekPlaybackToken(videoId)
    if (hit) return Promise.resolve(hit)
    const pending = inflight.get(videoId)
    if (pending) return pending
  }
  const run = (async () => {
    const { data, error } = await supabase.functions.invoke('video-playback-token', { body: { videoId } })
    const payload = data as { token?: string; hls?: string; dash?: string; iframe?: string; thumbnail?: string; durationSeconds?: number | null; expiresInSeconds?: number } | null
    if (error || !payload?.thumbnail) {
      const status = (error as { context?: { status?: number } } | null)?.context?.status ?? null
      throw new PlaybackTokenError(error?.message ?? 'token_mint_failed', status)
    }
    const token: PlaybackToken = {
      token: payload.token ?? null,
      hls: payload.hls ?? null,
      dash: payload.dash,
      iframe: payload.iframe,
      thumbnail: payload.thumbnail,
      durationSeconds: payload.durationSeconds ?? null,
      expiresAt: Date.now() + (payload.expiresInSeconds ?? 3600) * 1000,
    }
    cache.set(videoId, token)
    return token
  })().finally(() => inflight.delete(videoId))
  inflight.set(videoId, run)
  return run
}

/**
 * Cloudflare Stream renders thumbnails at any size — ask for the display size
 * (≈2× the CSS box for retina), never the full frame. The signed token lives
 * in the path, so query parameters are free.
 */
export function sizedThumbnail(thumbnail: string, width: number, height?: number): string {
  const sep = thumbnail.includes('?') ? '&' : '?'
  const h = height ? `&height=${Math.round(height)}&fit=crop` : ''
  return `${thumbnail}${sep}width=${Math.round(width)}${h}`
}
