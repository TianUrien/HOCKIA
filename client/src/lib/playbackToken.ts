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

type TokenPayload = { token?: string; hls?: string; dash?: string; iframe?: string; thumbnail?: string; durationSeconds?: number | null; expiresInSeconds?: number }

function toToken(payload: TokenPayload): PlaybackToken {
  return {
    token: payload.token ?? null,
    hls: payload.hls ?? null,
    dash: payload.dash,
    iframe: payload.iframe,
    thumbnail: payload.thumbnail as string,
    durationSeconds: payload.durationSeconds ?? null,
    expiresAt: Date.now() + (payload.expiresInSeconds ?? 3600) * 1000,
  }
}

async function mintOne(videoId: string): Promise<PlaybackToken> {
  const { data, error } = await supabase.functions.invoke('video-playback-token', { body: { videoId } })
  const payload = data as TokenPayload | null
  if (error || !payload?.thumbnail) {
    const status = (error as { context?: { status?: number } } | null)?.context?.status ?? null
    throw new PlaybackTokenError(error?.message ?? 'token_mint_failed', status)
  }
  return toToken(payload)
}

/*
 * Batching: every tile on a screen asks for its token in the same moment.
 * Requests made within one short window are sent as ONE call
 * ({ videoIds }), which the function answers per id. A cold public profile
 * used to fire one full round trip per video (~7 s for its thumbnails on
 * production); now it is one. If the deployed function predates batch mode
 * (no `results` in the answer), fall back to one call per id.
 */
const BATCH_WINDOW_MS = 12
const MAX_BATCH = 24
type Waiter = { resolve: (t: PlaybackToken) => void; reject: (e: unknown) => void }
let queue = new Map<string, Waiter[]>()
let timer: ReturnType<typeof setTimeout> | null = null

function flush() {
  timer = null
  const batch = queue
  queue = new Map()
  const ids = [...batch.keys()]
  for (let i = 0; i < ids.length; i += MAX_BATCH) void sendBatch(ids.slice(i, i + MAX_BATCH), batch)
}

async function sendBatch(ids: string[], waiters: Map<string, Waiter[]>) {
  const settle = (id: string, fn: (w: Waiter) => void) => (waiters.get(id) ?? []).forEach(fn)
  try {
    if (ids.length === 1) {
      const t = await mintOne(ids[0])
      settle(ids[0], (w) => w.resolve(t))
      return
    }
    const { data, error } = await supabase.functions.invoke('video-playback-token', { body: { videoIds: ids } })
    const results = (data as { results?: Record<string, TokenPayload & { error?: string; status?: number }> } | null)?.results
    if (error || !results) {
      // Older function (no batch mode) or a transport error: one call per id.
      await Promise.all(ids.map((id) => mintOne(id).then((t) => settle(id, (w) => w.resolve(t)), (e) => settle(id, (w) => w.reject(e)))))
      return
    }
    for (const id of ids) {
      const r = results[id]
      if (r?.thumbnail) settle(id, (w) => w.resolve(toToken(r)))
      else settle(id, (w) => w.reject(new PlaybackTokenError(r?.error ?? 'token_mint_failed', r?.status ?? null)))
    }
  } catch (e) {
    ids.forEach((id) => settle(id, (w) => w.reject(e)))
  }
}

function enqueue(videoId: string): Promise<PlaybackToken> {
  return new Promise((resolve, reject) => {
    const list = queue.get(videoId) ?? []
    list.push({ resolve, reject })
    queue.set(videoId, list)
    if (queue.size >= MAX_BATCH) { if (timer) clearTimeout(timer); flush() }
    else if (!timer) timer = setTimeout(flush, BATCH_WINDOW_MS)
  })
}

export function getPlaybackToken(videoId: string, opts: { force?: boolean } = {}): Promise<PlaybackToken> {
  if (!opts.force) {
    const hit = peekPlaybackToken(videoId)
    if (hit) return Promise.resolve(hit)
    const pending = inflight.get(videoId)
    if (pending) return pending
  }
  // A forced re-mint (retry after a failed image) goes alone, right away.
  const run = (opts.force ? mintOne(videoId) : enqueue(videoId))
    .then((token) => { cache.set(videoId, token); return token })
    .finally(() => inflight.delete(videoId))
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

/*
 * Prefetch for a profile's first video tiles. A cold public profile read its
 * video list only after the profile gates (profile row, ages, block checks)
 * had run, so the token mint started ~1.3 s in and the posters landed ~2.8 s
 * in. Called as soon as the profile id is known, this reads the same first
 * rows the profile shows, mints their tokens in one batch and warms the
 * first posters in the HTTP cache, all while the gates run. Safe to call for
 * any profile: the token function enforces visibility, owner hiding and
 * blocks itself, and nothing here renders.
 */
const prefetched = new Set<string>()
/** Poster size of the profile's first tiles (224×126 CSS px at 2×). */
const TILE_POSTER = { width: 448, height: 252 }

export function prefetchProfileVideoPosters(profileId: string | null | undefined, limit = 4): void {
  if (!profileId || prefetched.has(profileId) || typeof window === 'undefined') return
  prefetched.add(profileId)
  void (async () => {
    const { data } = await supabase
      .from('player_videos')
      .select('id, kind, status')
      .eq('user_id', profileId)
      .in('kind', ['highlight', 'full_match'])
      .order('display_order', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit * 2)
    const rows = ((data ?? []) as { id: string; kind: string; status: string | null }[]).filter((v) => v.status === 'ready' || v.status === null)
    // The profile shows highlights first, then full matches; warm the first
    // tiles of each row.
    const first = [...rows.filter((v) => v.kind === 'highlight').slice(0, 2), ...rows.filter((v) => v.kind === 'full_match').slice(0, 2)].slice(0, limit)
    await Promise.all(first.map((v) => getPlaybackToken(v.id).then((t) => {
      const img = new Image()
      img.decoding = 'async'
      img.src = sizedThumbnail(t.thumbnail, TILE_POSTER.width, TILE_POSTER.height)
    }).catch(() => { /* denied or dead: the tile handles it when it renders */ })))
  })().catch(() => { prefetched.delete(profileId) })
}
