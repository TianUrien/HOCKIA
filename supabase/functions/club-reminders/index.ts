/**
 * club-reminders — B2 · publisher emails and pushes about applications.
 *
 * Called by pg_cron through public.run_club_reminders(mode) with the
 * service-role bearer (migration 20261009100000_b2_club_reminders.sql):
 *
 *   { "mode": "new_applications" }  every 10 min — ONE email per publisher per
 *       hour at most, listing every application since the last one. Replaces
 *       notify-application's immediate per-application email (it stands down
 *       once application_response_settings.batched_application_emails_since is set).
 *   { "mode": "reminders" }         hourly at :05 — day 10 "Closing soon" and
 *       day 13 "Last call" at 09:00 in the publisher's country timezone, ONE
 *       email per publisher per local day (combined, Last call first) and one
 *       push, never in quiet hours (22:00–08:00 local).
 *
 * Optional "dry_run": true returns counts only — no claim, no email, no push.
 *
 * The rules (timezones, windows, skip rule, copy) are in
 * _shared/club-reminders.ts; the emails in _shared/club-reminder-email.ts. The
 * database fences the people (hidden / minor / blocked / test) and makes every
 * send idempotent: each send is CLAIMED first (club_reminder_claim) and the
 * claim is released if Resend fails, so a re-run never double-sends.
 */
import { getServiceClient } from '../_shared/supabase-client.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { assertServiceRole } from '../_shared/webhook-auth.ts'
import { captureException } from '../_shared/sentry.ts'
import { createLogger, sendTrackedEmail } from '../_shared/email-sender.ts'
import {
  buildReminderNotification,
  type CandidateRow,
  groupByPublisher,
  localParts,
  newApplicationsDue,
  planPublisherReminders,
  timezoneForCountry,
  toApplicantItems,
} from '../_shared/club-reminders.ts'
import { renderNewApplicationsEmail, renderReminderEmail } from '../_shared/club-reminder-email.ts'

type Mode = 'new_applications' | 'reminders'

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  // Only pg_cron (service-role bearer) may run this. See _shared/webhook-auth.ts.
  const unauthorized = assertServiceRole(req)
  if (unauthorized) return unauthorized

  const correlationId = crypto.randomUUID().slice(0, 8)
  const logger = createLogger('CLUB_REMINDERS', correlationId)

  try {
    const body = await req.json().catch(() => ({})) as { mode?: string; dry_run?: boolean }
    const mode = body.mode as Mode
    if (mode !== 'new_applications' && mode !== 'reminders') {
      return json(400, { error: 'mode must be new_applications or reminders' })
    }
    const dryRun = body.dry_run === true

    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    if (!resendApiKey && !dryRun) {
      logger.error('RESEND_API_KEY not configured')
      return json(500, { error: 'RESEND_API_KEY not configured' })
    }

    const supabase = getServiceClient()
    const baseUrl = Deno.env.get('PUBLIC_SITE_URL') ?? 'https://inhockia.com'
    const now = new Date()

    const { data, error } = await supabase.rpc('club_reminder_candidates', { p_mode: mode, p_now: now.toISOString() })
    if (error) {
      logger.error('candidates failed', { error: error.message })
      return json(500, { error: 'Failed to load candidates' })
    }
    const rows = (data ?? []) as unknown as CandidateRow[]
    const byPublisher = groupByPublisher(rows)

    const stats = { mode, dryRun, publishers: byPublisher.size, emails: 0, pushes: 0, skipped: 0, failed: 0, notDue: 0 }

    for (const [publisherId, list] of byPublisher) {
      try {
        if (mode === 'new_applications') {
          await runNewApplications(publisherId, list)
        } else {
          await runReminders(publisherId, list)
        }
      } catch (err) {
        stats.failed += 1
        logger.error('publisher failed', { publisherId, error: err instanceof Error ? err.message : String(err) })
        captureException(err, { functionName: 'club-reminders', correlationId, extra: { publisherId, mode } })
      }
    }

    logger.info('done', stats)
    return json(200, { success: true, ...stats })

    // ── new applications ──────────────────────────────────────────────────
    async function runNewApplications(publisherId: string, list: CandidateRow[]) {
      const head = list[0]
      if (!newApplicationsDue(head.last_new_applications_email_at, now)) { stats.notDue += 1; return }
      const tz = timezoneForCountry(head.publisher_country_code)
      const items = toApplicantItems(list, tz)
      if (items.length === 0 || !head.publisher_email) { stats.notDue += 1; return }
      if (dryRun) { stats.emails += 1; return }

      const { data: batchId, error: claimError } = await supabase.rpc('club_reminder_claim', {
        p_publisher_id: publisherId,
        p_channel: 'email',
        p_batch_kind: 'new_applications',
        p_local_date: localParts(now, tz).date,
        p_items: items.map((i) => ({ application_id: i.applicationId, kind: 'new_application' })),
      })
      if (claimError) throw new Error(`claim failed: ${claimError.message}`)
      if (!batchId) { stats.notDue += 1; return }

      const email = renderNewApplicationsEmail({ items, baseUrl })
      const result = await sendTrackedEmail({
        supabase, resendApiKey: resendApiKey!, to: head.publisher_email,
        subject: email.subject, html: email.html, text: email.text,
        templateKey: 'club_new_applications',
        recipientId: publisherId, recipientRole: head.publisher_role ?? undefined,
        logger, metadata: { batch_id: batchId, application_count: items.length },
      })
      await finish(batchId as string, result.success)
      if (result.success) stats.emails += 1
      else stats.failed += 1
    }

    // ── day 10 / day 13 ───────────────────────────────────────────────────
    async function runReminders(publisherId: string, list: CandidateRow[]) {
      const plan = planPublisherReminders(list, now)
      if (!plan) return
      const head = list[0]

      if (plan.skippedClosingSoon.length > 0) {
        stats.skipped += plan.skippedClosingSoon.length
        if (!dryRun) {
          const { error: skipError } = await supabase.rpc('club_reminder_skip', {
            p_publisher_id: publisherId,
            p_local_date: plan.localDate,
            p_application_ids: plan.skippedClosingSoon.map((i) => i.applicationId),
          })
          if (skipError) logger.warn('skip log failed', { publisherId, error: skipError.message })
        }
      }

      if (!plan.email && !plan.push) { stats.notDue += 1; return }
      if (dryRun) {
        if (plan.email) stats.emails += 1
        if (plan.push) stats.pushes += 1
        return
      }

      if (plan.push) {
        const n = buildReminderNotification(plan.push.kind, plan.push.lastCall, plan.pending)
        const { data: pushBatch, error: pushError } = await supabase.rpc('club_reminder_claim', {
          p_publisher_id: publisherId,
          p_channel: 'push',
          p_batch_kind: 'reminder',
          p_local_date: plan.localDate,
          p_items: plan.push.items.map((i) => ({ application_id: i.applicationId, kind: i.kind })),
          p_notification: JSON.parse(JSON.stringify({ kind: n.kind, metadata: n.metadata, target_url: n.target_url })),
        })
        if (pushError) logger.warn('push claim failed', { publisherId, error: pushError.message })
        else if (pushBatch) stats.pushes += 1
      }

      if (plan.email && head.publisher_email) {
        const { data: batchId, error: claimError } = await supabase.rpc('club_reminder_claim', {
          p_publisher_id: publisherId,
          p_channel: 'email',
          p_batch_kind: 'reminder',
          p_local_date: plan.localDate,
          p_items: plan.email.items.map((i) => ({ application_id: i.applicationId, kind: i.kind })),
        })
        if (claimError) throw new Error(`claim failed: ${claimError.message}`)
        if (!batchId) return

        const email = renderReminderEmail({
          lastCall: plan.email.lastCall,
          closingSoon: plan.email.closingSoon,
          pending: plan.pending,
          baseUrl,
        })
        const result = await sendTrackedEmail({
          supabase, resendApiKey: resendApiKey!, to: head.publisher_email,
          subject: email.subject, html: email.html, text: email.text,
          templateKey: 'club_reminder',
          recipientId: publisherId, recipientRole: head.publisher_role ?? undefined,
          logger,
          metadata: {
            batch_id: batchId,
            local_date: plan.localDate,
            last_call: plan.email.lastCall.length,
            closing_soon: plan.email.closingSoon.length,
          },
        })
        await finish(batchId as string, result.success)
        if (result.success) stats.emails += 1
        else stats.failed += 1
      }
    }

    async function finish(batchId: string, sent: boolean) {
      const { error: finishError } = await supabase.rpc('club_reminder_finish', { p_batch_id: batchId, p_sent: sent })
      if (finishError) logger.warn('finish failed', { batchId, error: finishError.message })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    logger.error('Unhandled error', { error: message })
    captureException(error, { functionName: 'club-reminders', correlationId })
    return json(500, { error: 'Internal server error' })
  }
})
