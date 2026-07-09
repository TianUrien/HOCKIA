// =========================================================================
// video-create-upload — mint a Cloudflare Stream direct-upload URL
// =========================================================================
// Native player-video upload, step 1 of the lifecycle (see the
// player_videos migration for the full flow).
//
// Flow:
//   - Caller (an authenticated PLAYER) POSTs { title, description?,
//     kind?, visibility?, maxDurationSeconds? }.
//   - We verify the JWT + that the caller's role is 'player'.
//   - We ask Cloudflare for a one-shot direct-upload URL (tus/resumable),
//     tagged with our own row id so the webhook can correlate it back.
//   - We insert a player_videos row in status='pending_upload' carrying
//     the returned cf_uid.
//   - We return { uploadURL, videoId } — the client uploads the file
//     straight to Cloudflare (the bytes never touch our server), then the
//     Cloudflare webhook (video-webhook) flips the row to 'ready'.
//
// Auth: requires a user JWT. Service-role client is used for the DB write
// so we control exactly which columns are set (provider fields included),
// regardless of the client.
//
// Cloudflare config (set as Supabase secrets in Phase 3):
//   CF_ACCOUNT_ID         — Cloudflare account id
//   CF_STREAM_API_TOKEN   — API token with Stream:Edit
// If absent, returns 503 provider_not_configured (so the function is
// safely deployable before the account exists).
// =========================================================================

import { getServiceClient } from '../_shared/supabase-client.ts'
import { getCorsHeaders } from '../_shared/cors.ts'

// Upload guardrails (MVP). Highlights are the focus; full_match is allowed
// but with a longer max duration. Size is enforced by Cloudflare via the
// maxDurationSeconds constraint + account limits; we also pass a cap.
const LIMITS = {
  highlight: { maxDurationSeconds: 600 },   // 10 min
  full_match: { maxDurationSeconds: 7200 }, // 2 h (later-phase kind)
  reel: { maxDurationSeconds: 180 },        // 3 min — Home/Gallery social reel
} as const

type Kind = keyof typeof LIMITS

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
  if (!accountId || !apiToken) {
    return json({ error: 'provider_not_configured' }, 503)
  }

  const supabase = getServiceClient()

  // 1) Authenticate the caller.
  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  if (!jwt) return json({ error: 'unauthenticated' }, 401)
  const { data: userData, error: userErr } = await supabase.auth.getUser(jwt)
  if (userErr || !userData.user) return json({ error: 'unauthenticated' }, 401)
  const userId = userData.user.id

  // 2) Any authenticated member may upload their OWN video. Social reels are
  //    posted from Home by every role (player/coach/club/brand/umpire); the row
  //    is always owned by the uploader, and playback stays gated by
  //    video-playback-token. (Recruitment kinds are still surfaced only where
  //    the product exposes them.)
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single()
  if (!profile) {
    return json({ error: 'profile_not_found' }, 403)
  }

  // 3) Parse + validate body.
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid_body' }, 400)
  }
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title || title.length > 120) return json({ error: 'invalid_title' }, 400)
  const description =
    typeof body.description === 'string' ? body.description.trim().slice(0, 500) : null
  // Social reels are open to every role. RECRUITMENT kinds (highlight /
  // full_match) stay player-only — otherwise any authenticated account could
  // inject a "New highlight" recruitment Pulse card (the generator carries
  // author_role verbatim and the feed does not role-filter it).
  const isPlayer = (profile as { role?: string }).role === 'player'
  const requested = body.kind === 'full_match' ? 'full_match' : body.kind === 'reel' ? 'reel' : 'highlight'
  if (!isPlayer && requested !== 'reel') {
    return json({ error: 'forbidden_kind' }, 403)
  }
  const kind: Kind = requested
  const visibility = body.visibility === 'recruiters' ? 'recruiters' : 'public'
  const maxDurationSeconds = LIMITS[kind].maxDurationSeconds
  // tus requires the total byte length up front (Upload-Length).
  const fileSize = typeof body.fileSize === 'number' && body.fileSize > 0 ? Math.floor(body.fileSize) : 0
  if (!fileSize || fileSize > 1_073_741_824) return json({ error: 'invalid_file_size' }, 400)

  // 4) Create our row first (status pending_upload) so we have an id to
  //    correlate the Cloudflare asset back to via webhook meta.
  const { data: row, error: insErr } = await supabase
    .from('player_videos')
    .insert({
      user_id: userId,
      kind,
      title,
      description,
      visibility,
      provider: 'cloudflare',
      status: 'pending_upload',
    })
    .select('id')
    .single()
  if (insErr || !row) {
    return json({ error: 'row_create_failed', detail: insErr?.message }, 500)
  }
  const videoId = (row as { id: string }).id

  // 5) Create a RESUMABLE (tus) upload on Cloudflare. The basic
  //    direct_upload one-shot caps at 200 MB — real highlight reels
  //    routinely exceed that (e.g. a 291 MB file → 413). tus has no size
  //    cap and survives flaky mobile connections (resumes on drop).
  //
  //    We POST to the tus creation endpoint server-side (with our API
  //    token), and Cloudflare returns a `Location` URL the CLIENT then
  //    uploads to via tus-js-client (no token needed client-side).
  //    Metadata (requiresignedurls, maxdurationseconds, our row id) is
  //    passed via the base64 Upload-Metadata header per the tus spec.
  const b64 = (s: string) => btoa(unescape(encodeURIComponent(s)))
  const uploadMetadata = [
    `requiresignedurls`, // key with no value = boolean true (CF convention)
    `maxdurationseconds ${b64(String(maxDurationSeconds))}`,
    `hockiavideoid ${b64(videoId)}`,
    `hockiauserid ${b64(userId)}`,
    `name ${b64(title)}`,
  ].join(',')

  const cfRes = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream?direct_user=true`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Tus-Resumable': '1.0.0',
        'Upload-Length': String(fileSize),
        'Upload-Metadata': uploadMetadata,
      },
    },
  )
  const location = cfRes.headers.get('Location')
  const uid = cfRes.headers.get('stream-media-id')
  if (cfRes.status !== 201 || !location || !uid) {
    // Roll the row back so we don't leave an orphan pending_upload.
    await supabase.from('player_videos').delete().eq('id', videoId)
    const detail = await cfRes.text().catch(() => '')
    return json({ error: 'cloudflare_upload_init_failed', status: cfRes.status, detail: detail.slice(0, 300) }, 502)
  }

  // Stamp the cf_uid onto the row so the webhook can also match on it.
  await supabase.from('player_videos').update({ cf_uid: uid }).eq('id', videoId)

  // tusUploadUrl is what the client resumes against with tus-js-client.
  return json({ videoId, tusUploadUrl: location, cfUid: uid })
})
