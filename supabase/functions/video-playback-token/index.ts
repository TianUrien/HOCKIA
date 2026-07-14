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
//        - 'recruiters' → only club/coach roles (or the owner) may play.
//      This is the enforcement that's IMPOSSIBLE with a public
//      YouTube/Drive URL — it's the whole reason for native upload.
//   3. Mint a short-lived (TTL) signed Cloudflare Stream token and return
//      the HLS/dash manifest URLs + a signed thumbnail URL.
//
// Auth: optional JWT. Anonymous callers may only get tokens for public
// ready videos; recruiters-only requires a club/coach JWT.
//
// Cloudflare config (Phase 3 secrets):
//   CF_ACCOUNT_ID
//   CF_STREAM_API_TOKEN          — used to request a signed token
// (Alternatively a CF_STREAM_KEY_ID + CF_STREAM_JWK can sign locally; we
//  use the API token path for the MVP — simpler, one fewer secret.)
// =========================================================================

import { getServiceClient } from '../_shared/supabase-client.ts'
import { getCorsHeaders } from '../_shared/cors.ts'

const TOKEN_TTL_SECONDS = 60 * 60 // 1h — long enough to watch, short enough to not be a durable link

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

  // Optional auth — anonymous is allowed for public videos.
  let viewerId: string | null = null
  let viewerRole: string | null = null
  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  if (jwt) {
    const { data: userData } = await supabase.auth.getUser(jwt)
    if (userData?.user) {
      viewerId = userData.user.id
      const { data: prof } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', viewerId)
        .single()
      viewerRole = (prof as { role?: string } | null)?.role ?? null
    }
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid_body' }, 400)
  }
  const videoId = typeof body.videoId === 'string' ? body.videoId : ''
  if (!videoId) return json({ error: 'missing_videoId' }, 400)

  // Service-role read so we can evaluate visibility ourselves (don't lean
  // on RLS here — we want explicit, auditable access logic).
  const { data: video } = await supabase
    .from('player_videos')
    .select('id, user_id, visibility, status, cf_uid, playback_id, thumbnail_url, duration_seconds')
    .eq('id', videoId)
    .single()
  if (!video) return json({ error: 'not_found' }, 404)

  const v = video as {
    user_id: string
    visibility: string
    status: string
    cf_uid: string | null
    playback_id: string | null
    thumbnail_url: string | null
    duration_seconds: number | null
  }

  if (v.status !== 'ready' || !v.cf_uid) return json({ error: 'not_ready' }, 409)

  // ── Hidden-profile fence (CLAUDE.md standing invariant) ──
  // This is a service-role read returning a person's content, so it must apply
  // the hidden predicate itself: a banned or frozen-minor owner's videos are
  // unplayable regardless of the video's own visibility. 404 so a hidden
  // owner's asset is indistinguishable from a deleted one.
  const { data: owner } = await supabase
    .from('profiles')
    .select('is_blocked, frozen_minor_at')
    .eq('id', v.user_id)
    .single()
  const ownerHidden =
    !owner ||
    (owner as { is_blocked?: boolean }).is_blocked === true ||
    (owner as { frozen_minor_at?: string | null }).frozen_minor_at != null
  if (ownerHidden) return json({ error: 'not_found' }, 404)

  // A viewer who blocked (or was blocked by) the owner cannot play their video.
  if (viewerId) {
    const { data: block } = await supabase
      .from('user_blocks')
      .select('blocker_id')
      .or(
        `and(blocker_id.eq.${viewerId},blocked_id.eq.${v.user_id}),and(blocker_id.eq.${v.user_id},blocked_id.eq.${viewerId})`,
      )
      .limit(1)
      .maybeSingle()
    if (block) return json({ error: 'not_found' }, 404)
  }

  // ── Access control ──
  const isOwner = viewerId && viewerId === v.user_id
  const isRecruiter = viewerRole === 'club' || viewerRole === 'coach'
  const allowed =
    v.visibility === 'public' || isOwner || (v.visibility === 'recruiters' && isRecruiter)
  if (!allowed) {
    return json({ error: viewerId ? 'forbidden' : 'auth_required' }, viewerId ? 403 : 401)
  }

  // ── Mint a signed Cloudflare Stream token for this asset ──
  const tokenRes = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/${v.cf_uid}/token`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // exp is enforced by CF; downscale/own-domain options could be
        // added later. Keep MVP minimal.
        exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
      }),
    },
  )
  const tokenJson = await tokenRes.json().catch(() => null)
  if (!tokenRes.ok || !tokenJson?.success || !tokenJson?.result?.token) {
    return json({ error: 'token_mint_failed', detail: tokenJson?.errors }, 502)
  }
  const token = tokenJson.result.token as string

  // Signed delivery URLs. videodelivery.net is Cloudflare Stream's player
  // domain; the token authorizes this specific asset for TOKEN_TTL.
  return json({
    videoId,
    token,
    hls: `https://videodelivery.net/${token}/manifest/video.m3u8`,
    dash: `https://videodelivery.net/${token}/manifest/video.mpd`,
    iframe: `https://iframe.videodelivery.net/${token}`,
    thumbnail: `https://videodelivery.net/${token}/thumbnails/thumbnail.jpg`,
    durationSeconds: v.duration_seconds,
    expiresInSeconds: TOKEN_TTL_SECONDS,
  })
})
