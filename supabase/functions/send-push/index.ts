// deno-lint-ignore-file no-explicit-any
import webpush from 'npm:web-push@3.6.7'
import { getServiceClient } from '../_shared/supabase-client.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { assertServiceRole } from '../_shared/webhook-auth.ts'
import { captureException, captureMessage } from '../_shared/sentry.ts'
import { buildPushPayload, PUSH_PREFERENCE_COLUMNS, pushAllowed, pushLanguageOf, shouldPushWebhookEvent, unnamedActor } from './push-payload.ts'
import { NEW_APPLICATIONS_PUSH_KIND, pushStandsDownForBatch } from '../_shared/club-reminders.ts'
import { sendFcmNotification, isFcmConfigured } from './fcm.ts'
import { sendApnsNotification, isApnsConfigured } from './apns.ts'
import { type DeliveryRow, type PushOutcome, failureSummary, notificationIdOf, platformOf, providerDetail } from './delivery-log.ts'

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
 *   - Events: INSERT (and UPDATE, see below)
 *   - Type: Supabase Edge Function
 *   - Function: send-push
 *
 * Re-surfaced rows: enqueue_notification upserts on (recipient, kind,
 * source), so a repeat event on the same source (e.g. a second recruiting
 * step on one application) UPDATEs the row instead of inserting one. An
 * UPDATE event is pushed only when created_at moved (the upsert re-stamps
 * it; marking read / seen / cleared never touches it), so reading a
 * notification can never re-push it.
 *
 * Grouped new-application pushes (20261021160000): once
 * application_response_settings.batched_application_pushes_since is set, an
 * individual vacancy_application_received row from that instant is NOT pushed
 * (its in-app row stays); club-reminders calls this function directly with
 * one grouped record per publisher per hour (metadata.batched = true).
 *
 * Preferences: notify_push is the master switch; each kind is also gated by
 * its per-type column (pushPreferenceColumn in push-payload.ts).
 *
 * Delivery log (20261123120000): every device attempt is written to
 * push_delivery_log with what the provider answered, and a send that fails
 * for a reason other than a retired token is reported to Sentry. Logging is
 * best-effort: it never fails or delays the push.
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
const hasApns = isApnsConfigured()

// Cold-start diagnostic — the APNs path had never executed in prod, so this
// proves hasApns=true in the RUNNING function env (not just that the secret
// exists in the store). Logged once per cold start; cheap and safe to keep.
console.log(`[send-push] providers: vapid=${hasVapid} fcm=${hasFcm} apns=${hasApns}`)

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // SECURITY (2026-08-08): `verify_jwt` only proves the caller sent *a* valid
  // Supabase JWT — and the anon key is public. Database webhooks call us with a
  // service_role token, which an attacker cannot mint. See _shared/webhook-auth.ts.
  const unauthorized = assertServiceRole(req)
  if (unauthorized) return unauthorized

  try {
    if (!hasVapid && !hasFcm && !hasApns) {
      console.error('[send-push] No push provider configured (VAPID/FCM/APNs)')
      return new Response(
        JSON.stringify({ error: 'Push not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Parse the webhook payload from Supabase Database Webhook
    const payload = await req.json()
    const record = payload.record || payload

    if (!shouldPushWebhookEvent(payload)) {
      return new Response(
        JSON.stringify({ skipped: true, reason: 'not_a_new_event' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

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

    // Grouped mode: the hourly club-reminders push replaces this one.
    if (kind === NEW_APPLICATIONS_PUSH_KIND && metadata.batched !== true) {
      const { data: settings, error: settingsError } = await supabase
        .from('application_response_settings')
        .select('batched_application_pushes_since')
        .limit(1)
        .maybeSingle()
      // Fail open: if the switch cannot be read, push as before (never lose the push).
      if (settingsError) console.warn('[send-push] settings read failed:', settingsError.message)
      const since = (settings as { batched_application_pushes_since?: string | null } | null)?.batched_application_pushes_since ?? null
      if (pushStandsDownForBatch(kind, metadata, record.created_at ?? null, since)) {
        return new Response(
          JSON.stringify({ skipped: true, reason: 'batched_by_club_reminders' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    // Master switch + the per-type setting for this kind.
    const { data: profile } = await supabase
      .from('profiles')
      .select(['notify_push', ...PUSH_PREFERENCE_COLUMNS].join(', '))
      .eq('id', recipientId)
      .single()

    if (!profile || !pushAllowed(kind, profile as unknown as Record<string, boolean | null>)) {
      return new Response(
        JSON.stringify({ skipped: true, reason: (profile as any)?.notify_push ? 'type_disabled' : 'push_disabled' }),
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

    // The recipient's interface language (profiles.ui_language, Spanish
    // localization Stage 0). Read on its own and failing to English: before
    // the column exists, or on any error, the push goes out in English as before.
    const { data: languageRow, error: languageError } = await supabase
      .from('profiles')
      .select('ui_language')
      .eq('id', recipientId)
      .maybeSingle()
    if (languageError) console.warn('[send-push] ui_language read failed, using English:', languageError.message)
    const language = pushLanguageOf((languageRow as { ui_language?: string | null } | null)?.ui_language)

    // Get actor name for notification copy
    let actorName = unnamedActor(language)
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

    // Badge = recipient's current unread-notification count (this notification is
    // already inserted, so it's included), so the OS icon badge reflects reality
    // instead of a hardcoded 1. The client syncs/clears it from the same count.
    const { count: unreadCount } = await supabase
      .from('profile_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_profile_id', recipientId)
      .is('read_at', null)
      .is('cleared_at', null)

    // Build push payload
    const pushPayload = { ...buildPushPayload(kind, metadata, actorName, actorId, language), badge: unreadCount ?? 1 }
    const payloadString = JSON.stringify(pushPayload)

    // Send to each device
    let sent = 0
    let failed = 0
    let cleaned = 0
    const deliveries: DeliveryRow[] = []
    const notificationId = notificationIdOf(record)

    for (const sub of subscriptions) {
      const isNativeSub = !!sub.fcm_token && sub.platform !== 'web'
      const isIosSub = isNativeSub && sub.platform === 'ios'
      const logDelivery = (outcome: PushOutcome, detail: string | null = null) => {
        deliveries.push({ notification_id: notificationId, recipient_profile_id: recipientId, kind, platform: platformOf(sub), outcome, detail })
      }

      try {
        if (isIosSub) {
          // ── APNs (native iOS — registers an APNs token, not an FCM token) ──
          if (!hasApns) { logDelivery('not_configured', 'APNs keys missing'); continue } // iOS requires APNs; skip until configured
          const success = await sendApnsNotification(sub.fcm_token!, pushPayload)
          if (success) {
            sent++
            logDelivery('sent')
          } else {
            await supabase.from('push_subscriptions').delete().eq('id', sub.id)
            cleaned++
            logDelivery('rejected', 'APNs token no longer valid')
            console.log(`[send-push] Cleaned invalid APNs token ${sub.id}`)
          }
        } else if (isNativeSub && hasFcm) {
          // ── FCM (native Android) ──
          const success = await sendFcmNotification(sub.fcm_token!, pushPayload)
          if (success) {
            sent++
            logDelivery('sent')
          } else {
            // Token may be invalid — clean up
            await supabase.from('push_subscriptions').delete().eq('id', sub.id)
            cleaned++
            logDelivery('rejected', 'FCM token no longer registered')
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
          logDelivery('sent')
        } else {
          // Subscription has neither valid FCM nor VAPID data — skip
          logDelivery('not_configured', isNativeSub ? 'FCM keys missing' : 'no usable web push keys')
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
          logDelivery('rejected', `web push subscription gone (${statusCode})`)
          console.log(`[send-push] Cleaned stale subscription ${sub.id} (${statusCode})`)
        } else if (statusCode === 429) {
          console.warn(`[send-push] Rate limited for ${sub.endpoint}`)
          failed++
          logDelivery('rate_limited', providerDetail(err))
        } else {
          console.error(`[send-push] Failed to send to ${sub.endpoint || sub.fcm_token}:`, err?.message || err)
          failed++
          logDelivery('failed', providerDetail(err))
        }
      }
    }

    // Delivery log: best-effort, never fails the push.
    if (deliveries.length > 0) {
      try {
        // The generated types gain this table once the migration is applied and they are regenerated.
        const { error: logError } = await (supabase as any).from('push_delivery_log').insert(deliveries)
        if (logError) console.warn('[send-push] delivery log not written:', logError.message)
      } catch (logErr: any) {
        console.warn('[send-push] delivery log not written:', logErr?.message || logErr)
      }
      const summary = failureSummary(kind, deliveries)
      if (summary) captureMessage(summary, 'error', { functionName: 'send-push' })
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
