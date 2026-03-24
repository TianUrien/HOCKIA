// deno-lint-ignore-file no-explicit-any
import webpush from 'npm:web-push@3.6.7'
import { getServiceClient } from '../_shared/supabase-client.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { captureException } from '../_shared/sentry.ts'
import { buildPushPayload } from './push-payload.ts'
import { sendFcmNotification, isFcmConfigured } from './fcm.ts'

/**
 * ============================================================================
 * Send Push Notification Edge Function
 * ============================================================================
 *
 * Triggered via Supabase Database Webhook on INSERT to profile_notifications.
 * Fetches all push subscriptions for the recipient and sends notifications
 * via Web Push (VAPID) for browsers or FCM for native iOS/Android apps.
 *
 * Webhook configuration (Dashboard → Database → Webhooks):
 *   - Table: profile_notifications
 *   - Events: INSERT
 *   - Type: Supabase Edge Function
 *   - Function: send-push
 * ============================================================================
 */

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')
const VAPID_CONTACT = Deno.env.get('VAPID_CONTACT') || 'mailto:team@inhockia.com'

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_CONTACT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
}

const hasVapid = !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY)
const hasFcm = isFcmConfigured()

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (!hasVapid && !hasFcm) {
      console.error('[send-push] Neither VAPID nor FCM configured')
      return new Response(
        JSON.stringify({ error: 'Push not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Parse the webhook payload from Supabase Database Webhook
    const payload = await req.json()
    const record = payload.record || payload

    const recipientId: string = record.recipient_profile_id
    const actorId: string | null = record.actor_profile_id
    const kind: string = record.kind
    const metadata: Record<string, any> = record.metadata || {}

    if (!recipientId || !kind) {
      return new Response(
        JSON.stringify({ error: 'Missing recipient_profile_id or kind' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabase = getServiceClient()

    // Check if recipient has push enabled
    const { data: profile } = await supabase
      .from('profiles')
      .select('notify_push')
      .eq('id', recipientId)
      .single()

    if (!profile?.notify_push) {
      return new Response(
        JSON.stringify({ skipped: true, reason: 'push_disabled' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Fetch all push subscriptions for the recipient (including fcm_token and platform)
    const { data: subscriptions, error: subError } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth, fcm_token, platform')
      .eq('profile_id', recipientId)

    if (subError) throw subError

    if (!subscriptions || subscriptions.length === 0) {
      return new Response(
        JSON.stringify({ skipped: true, reason: 'no_subscriptions' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get actor name for notification copy
    let actorName = 'A HOCKIA member'
    if (actorId) {
      const { data: actor } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', actorId)
        .single()

      if (actor?.full_name) {
        actorName = actor.full_name
      }
    }

    // Build push payload
    const pushPayload = buildPushPayload(kind, metadata, actorName)
    const payloadString = JSON.stringify(pushPayload)

    // Send to each device
    let sent = 0
    let failed = 0
    let cleaned = 0

    for (const sub of subscriptions) {
      const isFcmSub = !!sub.fcm_token && sub.platform !== 'web'

      try {
        if (isFcmSub && hasFcm) {
          // ── FCM (native iOS/Android) ──
          const success = await sendFcmNotification(sub.fcm_token!, pushPayload)
          if (success) {
            sent++
          } else {
            // Token may be invalid — clean up
            await supabase.from('push_subscriptions').delete().eq('id', sub.id)
            cleaned++
            console.log(`[send-push] Cleaned invalid FCM token ${sub.id}`)
          }
        } else if (hasVapid && sub.endpoint && sub.p256dh && sub.auth) {
          // ── Web Push (VAPID) ──
          const pushSubscription = {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          }

          await webpush.sendNotification(pushSubscription, payloadString)
          sent++
        } else {
          // Subscription has neither valid FCM nor VAPID data — skip
          continue
        }

        // Update last_used_at
        await supabase
          .from('push_subscriptions')
          .update({ last_used_at: new Date().toISOString() })
          .eq('id', sub.id)
      } catch (err: any) {
        const statusCode = err?.statusCode

        if (statusCode === 404 || statusCode === 410) {
          // Subscription expired or revoked — clean up
          await supabase.from('push_subscriptions').delete().eq('id', sub.id)
          cleaned++
          console.log(`[send-push] Cleaned stale subscription ${sub.id} (${statusCode})`)
        } else if (statusCode === 429) {
          console.warn(`[send-push] Rate limited for ${sub.endpoint}`)
          failed++
        } else {
          console.error(`[send-push] Failed to send to ${sub.endpoint || sub.fcm_token}:`, err?.message || err)
          failed++
        }
      }
    }

    console.log(`[send-push] kind=${kind} sent=${sent} failed=${failed} cleaned=${cleaned}`)

    return new Response(
      JSON.stringify({ success: true, sent, failed, cleaned }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err: any) {
    console.error('[send-push] Error:', err?.message || err)
    captureException(err, { functionName: 'send-push' })
    return new Response(
      JSON.stringify({ error: err?.message || 'Internal error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
