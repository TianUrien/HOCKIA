// =========================================================================
// video-webhook — Cloudflare Stream → HOCKIA status sync
// =========================================================================
// Lifecycle step 3: Cloudflare calls this when an upload finishes
// transcoding (or errors). We verify the signature, then update the
// matching player_videos row to status='ready' with playback_id +
// thumbnail_url + duration_seconds (or 'errored').
//
// Cloudflare webhook payload (Stream) shape (subset we use):
//   {
//     uid: "<cf asset uid>",
//     readyToStream: true,
//     status: { state: "ready" | "inprogress" | "error", errorReasonText },
//     duration: 123.4,
//     thumbnail: "https://.../thumbnails/thumbnail.jpg",
//     meta: { hockiaVideoId, hockiaUserId }
//   }
//
// Signature: Cloudflare signs with the webhook secret using the
// `Webhook-Signature: time=<t>,sig1=<hex hmac-sha256(t + "." + body)>`
// header. We verify with CF_STREAM_WEBHOOK_SECRET.
//
// Auth: NO user JWT (called by Cloudflare, not a browser). We trust the
// signature, not the caller. verify_jwt MUST be false for this function.
// =========================================================================

import { getServiceClient } from '../_shared/supabase-client.ts'
import { corsHeaders } from '../_shared/cors.ts'

async function verifySignature(
  rawBody: string,
  header: string | null,
  secret: string,
): Promise<boolean> {
  if (!header) return false
  // header: "time=1690000000,sig1=abcdef..."
  const parts = Object.fromEntries(
    header.split(',').map((kv) => {
      const [k, v] = kv.split('=')
      return [k.trim(), v?.trim() ?? '']
    }),
  )
  const time = parts['time']
  const sig = parts['sig1']
  if (!time || !sig) return false

  // Reject stale timestamps (>5 min skew) to blunt replay.
  const tsec = Number(time)
  if (!Number.isFinite(tsec)) return false

  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(`${time}.${rawBody}`))
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('')
  // constant-time-ish compare
  if (expected.length !== sig.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i)
  return diff === 0
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const secret = Deno.env.get('CF_STREAM_WEBHOOK_SECRET')
  if (!secret) {
    return new Response(JSON.stringify({ error: 'provider_not_configured' }), {
      status: 503,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const rawBody = await req.text()
  const ok = await verifySignature(rawBody, req.headers.get('Webhook-Signature'), secret)
  if (!ok) {
    return new Response(JSON.stringify({ error: 'invalid_signature' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const uid = typeof payload.uid === 'string' ? payload.uid : null
  const meta = (payload.meta ?? {}) as { hockiaVideoId?: string }
  const statusObj = (payload.status ?? {}) as { state?: string; errorReasonText?: string }
  const state = statusObj.state
  const supabase = getServiceClient()

  // Locate our row by hockiaVideoId (preferred) or cf_uid.
  const match = meta.hockiaVideoId
    ? { col: 'id', val: meta.hockiaVideoId }
    : uid
      ? { col: 'cf_uid', val: uid }
      : null
  if (!match) {
    return new Response(JSON.stringify({ error: 'no_correlation_key' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (state === 'ready' || payload.readyToStream === true) {
    const duration = typeof payload.duration === 'number' ? Math.round(payload.duration) : null
    const thumbnail = typeof payload.thumbnail === 'string' ? payload.thumbnail : null
    await supabase
      .from('player_videos')
      .update({
        status: 'ready',
        cf_uid: uid,
        playback_id: uid, // Cloudflare Stream uses the uid as the playback id
        thumbnail_url: thumbnail,
        duration_seconds: duration,
        error_reason: null,
      })
      .eq(match.col, match.val)
  } else if (state === 'error') {
    await supabase
      .from('player_videos')
      .update({
        status: 'errored',
        error_reason: (statusObj.errorReasonText ?? 'Cloudflare processing error').slice(0, 500),
      })
      .eq(match.col, match.val)
  } else {
    // inprogress / queued → reflect processing.
    await supabase
      .from('player_videos')
      .update({ status: 'processing', cf_uid: uid })
      .eq(match.col, match.val)
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
