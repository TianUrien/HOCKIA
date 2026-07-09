// =========================================================================
// video-delete — remove a Cloudflare Stream asset AND its player_videos row
// =========================================================================
// Deleting the row alone (what NativeVideosSection did, and what a Gallery
// delete would inherit) leaves the Cloudflare asset alive forever: nothing in
// the codebase ever called Cloudflare's DELETE /stream/{uid}. That is a pure
// storage + billing leak — the asset is unreachable once the row is gone,
// because video-playback-token mints tokens from the row.
//
// Order of operations: Cloudflare FIRST, row SECOND.
//   - If Cloudflare fails, we still delete the row. The user asked for the
//     video to be gone; refusing would leave a video they cannot remove. The
//     orphaned asset is logged loudly for reconciliation.
//   - If we deleted the row first and Cloudflare then failed, we'd have lost
//     the cf_uid and could never clean it up.
//
// Auth: user JWT required; the caller must OWN the row. Service-role client is
// used for the delete so it works for every role (the RLS write policy is
// kind-aware, but we do not want the delete path to depend on it).
// =========================================================================

import { getServiceClient } from '../_shared/supabase-client.ts'
import { getCorsHeaders } from '../_shared/cors.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req.headers.get('Origin'))
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const supabase = getServiceClient()

  // 1) Authenticate.
  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  if (!jwt) return json({ error: 'unauthenticated' }, 401)
  const { data: userData, error: userErr } = await supabase.auth.getUser(jwt)
  if (userErr || !userData.user) return json({ error: 'unauthenticated' }, 401)
  const userId = userData.user.id

  // 2) Parse.
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid_body' }, 400)
  }
  const videoId = typeof body.videoId === 'string' ? body.videoId.trim() : ''
  if (!UUID_RE.test(videoId)) return json({ error: 'invalid_video_id' }, 400)

  // 3) Authorize — ownership, checked server-side against the real row.
  const { data: video, error: readErr } = await supabase
    .from('player_videos')
    .select('id, user_id, cf_uid')
    .eq('id', videoId)
    .maybeSingle()
  if (readErr) return json({ error: 'lookup_failed', detail: readErr.message }, 500)
  if (!video) return json({ error: 'not_found' }, 404)
  const row = video as { id: string; user_id: string; cf_uid: string | null }
  if (row.user_id !== userId) return json({ error: 'forbidden' }, 403)

  // 4) Refuse to yank a video out from under a live post. Only kind='post'
  //    videos are ever referenced, but we check by id so the guard can't be
  //    sidestepped by a future kind. Fail CLOSED: if we cannot prove the video
  //    is unreferenced, we do not delete it.
  //    NB: `.contains(col, array)` serializes an ARRAY argument as a Postgres
  //    array literal (`cs.{...}`), which is not valid against a jsonb column.
  //    A pre-stringified JSON value produces the jsonb containment we want
  //    (`images @> '[{"video_id": "..."}]'`).
  const { count, error: refErr } = await supabase
    .from('user_posts')
    .select('id', { count: 'exact', head: true })
    .is('deleted_at', null)
    .contains('images', JSON.stringify([{ video_id: videoId }]))
  if (refErr) return json({ error: 'in_use_check_failed', detail: refErr.message }, 500)
  if ((count ?? 0) > 0) return json({ error: 'video_in_use' }, 409)

  // 5) Cloudflare first. Best-effort: a 404 means it's already gone.
  let cloudflare: 'deleted' | 'skipped' | 'failed' = 'skipped'
  const accountId = Deno.env.get('CF_ACCOUNT_ID')
  const apiToken = Deno.env.get('CF_STREAM_API_TOKEN')
  if (row.cf_uid && accountId && apiToken) {
    try {
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/${row.cf_uid}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${apiToken}` } },
      )
      if (res.ok || res.status === 404) {
        cloudflare = 'deleted'
      } else {
        cloudflare = 'failed'
        const detail = await res.text().catch(() => '')
        console.error(
          `[video-delete] ORPHANED Cloudflare asset cf_uid=${row.cf_uid} status=${res.status} ${detail.slice(0, 300)}`,
        )
      }
    } catch (err) {
      cloudflare = 'failed'
      console.error(`[video-delete] ORPHANED Cloudflare asset cf_uid=${row.cf_uid}`, err)
    }
  }

  // 6) Row second — always, so the user's delete always takes effect.
  const { error: delErr } = await supabase
    .from('player_videos')
    .delete()
    .eq('id', videoId)
    .eq('user_id', userId)
  if (delErr) return json({ error: 'delete_failed', detail: delErr.message }, 500)

  return json({ success: true, cloudflare })
})
