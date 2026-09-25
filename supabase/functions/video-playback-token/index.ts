// =========================================================================
// video-playback-token — role-gated signed playback for a player video
// =========================================================================
// Lifecycle step 4 + the access-control heart of the feature. The raw
// Cloudflare asset is created with requireSignedURLs=true, so it is NEVER
// publicly addressable. To watch a video the client calls this function;
// we:
//   1. Look up the player_videos row.
//   2. Enforce visibility:
//        - 'public'     → anyone (incl. anon) may play.
//        - 'recruiters' → only recruiters (or the owner) may play. A
//          recruiter is a club, or a coach with coach_recruits_for_team,
//          and not a hidden profile — public.is_recruiter(uid), the same
//          definition the player_videos SELECT policy uses.
//      This is the enforcement that's IMPOSSIBLE with a public
//      YouTube/Drive URL — it's the whole reason for native upload.
//   3. Mint a short-lived (TTL) signed Cloudflare Stream token and return
//      the HLS/dash manifest URLs + a signed thumbnail URL.
//
// Auth: optional JWT. Anonymous callers may only get tokens for public
// ready videos; recruiters-only requires a recruiter's JWT.
//
// Cloudflare config (Phase 3 secrets):
//   CF_ACCOUNT_ID
//   CF_STREAM_API_TOKEN          — used to request a signed token
// (Alternatively a CF_STREAM_KEY_ID + CF_STREAM_JWK can sign locally; we
//  use the API token path for the MVP — simpler, one fewer secret.)
// =========================================================================

import { getServiceClient } from '../_shared/supabase-client.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { localSigningConfig, signStreamToken } from '../_shared/stream-signing.ts'

const TOKEN_TTL_SECONDS = 60 * 60 // 1h — long enough to watch, short enough to not be a durable link
// Upper bound for one batch request — a screenful of tiles plus lookahead.
const MAX_BATCH = 24

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req.headers.get('Origin'))
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const accountId = Deno.env.get('CF_ACCOUNT_ID')
  const apiToken = Deno.env.get('CF_STREAM_API_TOKEN')
  if (!accountId || !apiToken) return json({ error: 'provider_not_configured' }, 503)

  const supabase = getServiceClient()

  // Optional auth — anonymous is allowed for public videos. Resolved in the
  // background so it overlaps the video read instead of preceding it.
  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  const viewerPromise: Promise<Viewer> = (async () => {
    if (!jwt) return { id: null, recruiter: false }
    const { data: userData } = await supabase.auth.getUser(jwt)
    if (!userData?.user) return { id: null, recruiter: false }
    // One recruiter definition for RLS and this function (SQL is_recruiter).
    // Fails closed: an RPC error means "not a recruiter".
    const { data: recruiter, error } = await supabase.rpc('is_recruiter', { p_uid: userData.user.id })
    if (error) console.error('[video-playback-token] is_recruiter failed', error.message)
    return { id: userData.user.id, recruiter: recruiter === true }
  })()

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid_body' }, 400)
  }

  // Probe: { probe: 'local-signing', videoId } signs ONE token with the
  // configured Stream key regardless of CF_STREAM_LOCAL_SIGNING and checks
  // the poster server-side. Returns only status codes (no token, no URL),
  // so a key can be verified on a project before it serves users.
  if (body.probe === 'local-signing' && typeof body.videoId === 'string') {
    const keyId = Deno.env.get('CF_STREAM_KEY_ID')?.trim()
    const jwk = Deno.env.get('CF_STREAM_JWK')?.trim()
    if (!keyId || !jwk) return json({ probe: 'local-signing', configured: false })
    // Key identity only (never key material): the kid baked into the JWK
    // must match CF_STREAM_KEY_ID, or Cloudflare looks up the wrong key.
    let jwkKid: string | null = null
    let jwkInfo: Record<string, unknown> = {}
    try {
      const j = JSON.parse(atob(jwk)) as Record<string, unknown>
      jwkKid = typeof j.kid === 'string' ? j.kid : null
      jwkInfo = { kty: j.kty, alg: j.alg ?? null, hasD: typeof j.d === 'string', nBits: typeof j.n === 'string' ? Math.round((j.n as string).length * 6) : null }
    } catch (e) { jwkInfo = { parseError: String(e) } }
    const idMatch = jwkKid === null ? 'jwk has no kid' : jwkKid === keyId ? 'match' : `MISMATCH jwk=${jwkKid.slice(0, 8)}`
    const r = (await resolveVideos([body.videoId])).get(body.videoId)
    if (!r || 'error' in r || r.visibility !== 'public') return json({ probe: 'local-signing', error: 'public ready video required' }, 400)
    try {
      const token = await signStreamToken(r.cf_uid as string, Math.floor(Date.now() / 1000) + 300, keyId, jwk)
      const host = (() => { try { return new URL(r.thumbnail_url ?? '').hostname } catch { return null } })() ?? 'customer-vlcap0eaaguje56f.cloudflarestream.com'
      const poster = await fetch(`https://${host}/${token}/thumbnails/thumbnail.jpg?width=64`)
      const manifest = await fetch(`https://${host}/${token}/manifest/video.m3u8`)
      return json({ probe: 'local-signing', configured: true, kid: keyId.slice(0, 8), idMatch, jwkInfo, keyIdLen: keyId.length, poster: poster.status, manifest: manifest.status, flag: Deno.env.get('CF_STREAM_LOCAL_SIGNING') ?? null })
    } catch (err) {
      return json({ probe: 'local-signing', configured: true, error: String(err) }, 500)
    }
  }

  // Profile mode: { profileVideos: { id | username, limit } } → { results, order }.
  // Tokens for a profile's first video tiles, callable the moment the page
  // knows whose profile it is — before the client has read the video list.
  // The owner is known up front, so the video read, the owner fence and the
  // block check run together; the access rules are the same as every mode.
  if (body.profileVideos && typeof body.profileVideos === 'object') {
    const ref = body.profileVideos as { id?: unknown; username?: unknown; limit?: unknown }
    const limit = Math.min(Math.max(Number(ref.limit) || 4, 1), 8)
    let ownerId = typeof ref.id === 'string' && ref.id ? ref.id : null
    if (!ownerId && typeof ref.username === 'string' && ref.username) {
      const { data } = await supabase.from('profiles').select('id').eq('username', ref.username).maybeSingle()
      ownerId = (data as { id?: string } | null)?.id ?? null
    }
    if (!ownerId) return json({ results: {}, order: [] })
    const resolved = await resolveProfileVideos(ownerId, limit)
    const results: Record<string, unknown> = {}
    const order: string[] = []
    await Promise.all([...resolved].map(async ([id, r]) => {
      if ('error' in r) return
      const out = await mint(id, r)
      if (!('error' in out)) results[id] = out
    }))
    for (const id of resolved.keys()) if (results[id]) order.push(id)
    return json({ results, order })
  }

  // Batch mode: { videoIds: [...] } → { results: { [id]: payload | { error, status } } }.
  // One auth check, one read for all rows / owners / blocks, and the
  // Cloudflare mints in parallel — a profile with six videos used to make
  // six full round trips (auth + four reads + a Cloudflare call each), which
  // put a cold public-profile's thumbnails at ~7 s on production.
  // Single mode ({ videoId }) keeps its exact response for older native builds.
  if (Array.isArray(body.videoIds)) {
    const ids = [...new Set((body.videoIds as unknown[]).filter((x): x is string => typeof x === 'string' && x.length > 0))]
    if (ids.length === 0) return json({ error: 'missing_videoIds' }, 400)
    if (ids.length > MAX_BATCH) return json({ error: 'too_many_videoIds', max: MAX_BATCH }, 400)
    const resolved = await resolveVideos(ids)
    const results: Record<string, unknown> = {}
    await Promise.all(ids.map(async (id) => {
      const r = resolved.get(id) ?? { error: 'not_found', status: 404 }
      results[id] = 'error' in r ? r : await mint(id, r)
    }))
    return json({ results })
  }

  const videoId = typeof body.videoId === 'string' ? body.videoId : ''
  if (!videoId) return json({ error: 'missing_videoId' }, 400)
  const r = (await resolveVideos([videoId])).get(videoId) ?? { error: 'not_found', status: 404 }
  if ('error' in r) return json({ error: r.error }, r.status)
  const out = await mint(videoId, r)
  if ('error' in out) return json({ error: out.error, detail: out.detail }, out.status)
  return json(out)

  // ── helpers (closures over supabase / viewer / Cloudflare config) ──

  /** Reads and access checks for a set of videos. Service-role reads so the
   *  visibility logic is explicit and auditable here, not left to RLS. */
  async function resolveVideos(ids: string[]): Promise<Map<string, VideoRow | Denied>> {
    const [viewer, { data: rows }] = await Promise.all([
      viewerPromise,
      supabase.from('player_videos').select('id, user_id, visibility, status, cf_uid, playback_id, thumbnail_url, duration_seconds').in('id', ids),
    ])
    const videos = (rows ?? []) as VideoRow[]
    const fence = await ownerFence([...new Set(videos.map((v) => v.user_id))])
    return decide(videos, viewer, fence)
  }

  /** A profile's first tiles, as the profile shows them: highlights first,
   *  then full matches, newest display order first. One owner, so every read
   *  runs at once. */
  async function resolveProfileVideos(ownerId: string, limit: number): Promise<Map<string, VideoRow | Denied>> {
    const [viewer, { data: rows }, fence] = await Promise.all([
      viewerPromise,
      supabase
        .from('player_videos')
        .select('id, user_id, visibility, status, cf_uid, playback_id, thumbnail_url, duration_seconds, kind')
        .eq('user_id', ownerId)
        .in('kind', ['highlight', 'full_match'])
        .order('display_order', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(limit * 2),
      ownerFence([ownerId]),
    ])
    const all = ((rows ?? []) as (VideoRow & { kind: string })[]).filter((v) => v.status === 'ready')
    const half = Math.ceil(limit / 2)
    const picked = [
      ...all.filter((v) => v.kind === 'highlight').slice(0, half),
      ...all.filter((v) => v.kind === 'full_match').slice(0, half),
    ].slice(0, limit)
    return decide(picked, viewer, fence)
  }

  // ── Hidden-profile fence (CLAUDE.md standing invariant) ──
  // A banned or frozen-minor owner's videos are unplayable regardless of
  // the video's own visibility; 404 so a hidden owner's asset reads as
  // deleted. A viewer who blocked (or was blocked by) the owner cannot play
  // their video either. Both reads run together.
  async function ownerFence(ownerIds: string[]): Promise<{ visibleOwners: Set<string>; blockedOwners: Set<string> }> {
    const list = ownerIds.join(',')
    const [{ data: owners }, blocks] = await Promise.all([
      ownerIds.length
        ? supabase.from('profiles').select('id, is_blocked, frozen_minor_at').in('id', ownerIds)
        : Promise.resolve({ data: [] }),
      (async () => {
        const { id: viewerId } = await viewerPromise
        if (!viewerId || !ownerIds.length) return { viewerId, rows: [] as { blocker_id: string; blocked_id: string }[] }
        const { data } = await supabase
          .from('user_blocks')
          .select('blocker_id, blocked_id')
          .or(`and(blocker_id.eq.${viewerId},blocked_id.in.(${list})),and(blocked_id.eq.${viewerId},blocker_id.in.(${list}))`)
        return { viewerId, rows: (data ?? []) as { blocker_id: string; blocked_id: string }[] }
      })(),
    ])
    const visibleOwners = new Set(
      ((owners ?? []) as { id: string; is_blocked?: boolean; frozen_minor_at?: string | null }[])
        .filter((o) => o.is_blocked !== true && o.frozen_minor_at == null)
        .map((o) => o.id),
    )
    const blockedOwners = new Set<string>()
    for (const b of blocks.rows) blockedOwners.add(b.blocker_id === blocks.viewerId ? b.blocked_id : b.blocker_id)
    return { visibleOwners, blockedOwners }
  }

  function decide(
    videos: VideoRow[],
    viewer: Viewer,
    fence: { visibleOwners: Set<string>; blockedOwners: Set<string> },
  ): Map<string, VideoRow | Denied> {
    const out = new Map<string, VideoRow | Denied>()
    const isRecruiter = viewer.recruiter
    for (const v of videos) {
      if (v.status !== 'ready' || !v.cf_uid) { out.set(v.id, { error: 'not_ready', status: 409 }); continue }
      if (!fence.visibleOwners.has(v.user_id) || fence.blockedOwners.has(v.user_id)) { out.set(v.id, { error: 'not_found', status: 404 }); continue }
      // ── Access control ──
      const isOwner = viewer.id !== null && viewer.id === v.user_id
      const allowed = v.visibility === 'public' || isOwner || (v.visibility === 'recruiters' && isRecruiter)
      if (!allowed) { out.set(v.id, viewer.id ? { error: 'forbidden', status: 403 } : { error: 'auth_required', status: 401 }); continue }
      out.set(v.id, v)
    }
    return out
  }

  /** Mint a signed Cloudflare Stream token for one asset and build its URLs. */
  async function mint(videoId: string, v: VideoRow) {
    const exp = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS
    let token: string
    const signing = localSigningConfig()
    if (signing) {
      // Local RS256 signing with a Stream signing key — no Cloudflare call.
      try {
        token = await signStreamToken(v.cf_uid as string, exp, signing.keyId, signing.jwk)
      } catch (err) {
        return { error: 'token_sign_failed', status: 502, detail: String(err) }
      }
    } else {
      const tokenRes = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/${v.cf_uid}/token`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
          // exp is enforced by CF; downscale/own-domain options could be added later.
          body: JSON.stringify({ exp }),
        },
      )
      const tokenJson = await tokenRes.json().catch(() => null)
      if (!tokenRes.ok || !tokenJson?.success || !tokenJson?.result?.token) {
        return { error: 'token_mint_failed', status: 502, detail: tokenJson?.errors }
      }
      token = tokenJson.result.token as string
    }

    // Signed delivery URLs — served from OUR account's customer subdomain,
    // NEVER videodelivery.net. Both host the same assets and accept the same
    // token, but videodelivery.net is TLS-intercepted and killed by ISP
    // content filters (verified 2026-09-19: Allot DPI on Personal/Movistar
    // "secure browsing" in Argentina re-signs its cert → every fetch fails →
    // black players for those users, while customer-*.cloudflarestream.com
    // passes untouched). Same host family as the stored thumbnail_url, so
    // one CSP/CORS surface too.
    //
    // WHICH customer subdomain is per Cloudflare ACCOUNT, and staging and prod
    // use different accounts. A hardcoded default 404s every signed URL on the
    // other project (found 2026-09-21: all staging video had been dead since the
    // 09-19 host change). So the host comes from the row itself: thumbnail_url
    // is written by Cloudflare's webhook for THIS asset, which makes it correct
    // by construction on any account. Env override first, prod default last.
    const storedHost = (() => {
      try {
        const host = new URL(v.thumbnail_url ?? '').hostname
        return /^customer-[a-z0-9]+\.cloudflarestream\.com$/.test(host) ? host : null
      } catch {
        return null
      }
    })()
    const deliveryHost = Deno.env.get('CF_STREAM_CUSTOMER_HOST') || storedHost ||
      'customer-vlcap0eaaguje56f.cloudflarestream.com'
    return {
      videoId,
      token,
      hls: `https://${deliveryHost}/${token}/manifest/video.m3u8`,
      dash: `https://${deliveryHost}/${token}/manifest/video.mpd`,
      iframe: `https://${deliveryHost}/${token}/iframe`,
      thumbnail: `https://${deliveryHost}/${token}/thumbnails/thumbnail.jpg`,
      durationSeconds: v.duration_seconds,
      expiresInSeconds: TOKEN_TTL_SECONDS,
    }
  }
})

type VideoRow = {
  id: string
  user_id: string
  visibility: string
  status: string
  cf_uid: string | null
  playback_id: string | null
  thumbnail_url: string | null
  duration_seconds: number | null
}
type Denied = { error: string; status: number }
type Viewer = { id: string | null; recruiter: boolean }
