// deno-lint-ignore-file no-explicit-any
import { getServiceClient } from '../_shared/supabase-client.ts'
import { captureException } from '../_shared/sentry.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { renderTemplate } from '../_shared/email-renderer.ts'
import { sendTrackedEmail } from '../_shared/email-sender.ts'
import { fetchSuggestions, suggestionsHtml, suggestionsText } from '../_shared/opportunity-suggestions.ts'

/**
 * ============================================================================
 * Application status-change email (Task 3a) — shortlisted / rejected only
 * ============================================================================
 *
 * Triggered by database webhook on INSERT to application_status_email_queue.
 * enqueue_application_status_emails() (pg_cron, every 30 min) scans
 * profile_notifications kind='vacancy_application_status' with emailed_at
 * IS NULL — the same emailed_at pattern as the message digest — and batches
 * per player. 'maybe' never reaches here (the trigger no longer notifies it),
 * and a metadata->>'status' filter excludes any legacy rows.
 *
 * Copy contract: shortlisted → congratulate; rejected → honest + kind +
 * 2-3 similar open opportunities. Never "still waiting" reminders.
 * ============================================================================
 */

interface QueueRecord {
  id: string
  recipient_id: string
  batch_ts: string
  notification_ids: string[]
  attempts: number
}

interface StatusEntry {
  status: 'shortlisted' | 'rejected'
  vacancy_title: string
  club_name: string
  opportunity_id: string | null
}

function createLogger(correlationId: string) {
  const prefix = `[NOTIFY_APPLICATION_STATUS][${correlationId}]`
  return {
    info: (msg: string, meta?: Record<string, unknown>) => console.log(`${prefix} ${msg}`, meta ?? ''),
    warn: (msg: string, meta?: Record<string, unknown>) => console.warn(`${prefix} ${msg}`, meta ?? ''),
    error: (msg: string, meta?: Record<string, unknown>) => console.error(`${prefix} ${msg}`, meta ?? ''),
  }
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

Deno.serve(async (req: Request) => {
  const correlationId = crypto.randomUUID().slice(0, 8)
  const logger = createLogger(correlationId)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    if (!resendApiKey) {
      logger.error('RESEND_API_KEY not configured')
      return json(500, { error: 'RESEND_API_KEY not configured' })
    }

    const payload = await req.json()
    if (payload.table !== 'application_status_email_queue' || payload.type !== 'INSERT') {
      return json(200, { message: 'Ignored - not a status email queue INSERT' })
    }

    const queueRecord = payload.record as QueueRecord
    const supabase = getServiceClient()
    const IS_STAGING = (Deno.env.get('SUPABASE_URL') ?? '').includes('ivjkdaylalhsteyyclvl')

    const markProcessed = async () => {
      const { error } = await supabase
        .from('application_status_email_queue')
        .update({ processed_at: new Date().toISOString() })
        .eq('id', queueRecord.id)
      if (error) logger.error('Failed to mark queue row processed', { error: error.message })
    }
    const recordFailure = async (message: string) => {
      const { error } = await supabase
        .from('application_status_email_queue')
        .update({ attempts: (queueRecord.attempts ?? 0) + 1, last_error: message.slice(0, 500) })
        .eq('id', queueRecord.id)
      if (error) logger.error('Failed to record queue failure', { error: error.message })
    }

    // ── Recipient eligibility (re-checked at send time) ──
    const { data: player, error: playerError } = await supabase
      .from('profiles')
      .select('id, email, full_name, role, is_test_account, onboarding_completed, notify_applications')
      .eq('id', queueRecord.recipient_id)
      .single()

    if (playerError || !player) {
      await recordFailure(`player fetch failed: ${playerError?.message}`)
      return json(500, { error: 'Failed to fetch player profile' })
    }

    if (
      (player.is_test_account && !IS_STAGING) ||
      !player.onboarding_completed ||
      !player.email ||
      player.notify_applications === false
    ) {
      logger.info('Player not eligible, skipping', { playerId: player.id })
      await markProcessed()
      return json(200, { message: 'Ignored - player not eligible' })
    }

    // ── Idempotency: one email per queue batch ──
    const { count: alreadySent } = await supabase
      .from('email_sends')
      .select('id', { count: 'exact', head: true })
      .eq('template_key', 'application_status')
      .eq('status', 'sent')
      .eq('recipient_id', player.id)
      .eq('metadata->>batch_ts', queueRecord.batch_ts)
    if (alreadySent && alreadySent > 0) {
      logger.info('Status email already sent for this batch, skipping', { playerId: player.id })
      await markProcessed()
      return json(200, { message: 'Ignored - already sent' })
    }

    // ── The status-change notifications in this batch ──
    const { data: notifications, error: notifError } = await supabase
      .from('profile_notifications')
      .select('id, metadata')
      .in('id', queueRecord.notification_ids ?? [])

    if (notifError || !notifications || notifications.length === 0) {
      await recordFailure(`notifications fetch failed: ${notifError?.message ?? 'no rows'}`)
      return json(500, { error: 'Failed to fetch notifications' })
    }

    const entries: StatusEntry[] = notifications
      .map((n: any) => ({
        status: n.metadata?.status,
        vacancy_title: n.metadata?.vacancy_title ?? 'your opportunity',
        club_name: n.metadata?.club_name ?? 'The team',
        opportunity_id: n.metadata?.opportunity_id ?? null,
      }))
      .filter((e: any): e is StatusEntry => e.status === 'shortlisted' || e.status === 'rejected')

    if (entries.length === 0) {
      logger.info('No emailable entries in batch, skipping', { playerId: player.id })
      await markProcessed()
      return json(200, { message: 'Ignored - nothing emailable' })
    }

    const HOCKIA_BASE_URL = Deno.env.get('PUBLIC_SITE_URL') ?? 'https://inhockia.com'
    const firstName = player.full_name?.split(' ')[0]?.trim() || 'there'
    const rejected = entries.filter((e) => e.status === 'rejected')
    const shortlisted = entries.filter((e) => e.status === 'shortlisted')

    // Suggestions only when a rejection is in the batch (spec: rejected →
    // honest + 2-3 similar open opportunities; shortlist emails stay focused).
    const suggestions = rejected.length > 0
      ? await fetchSuggestions(
          supabase,
          player.id,
          rejected.map((e) => e.opportunity_id).filter((v): v is string => Boolean(v)),
          3,
        )
      : []

    const single = entries.length === 1
    const subject = single
      ? (entries[0].status === 'shortlisted'
          ? `You're on ${entries[0].club_name}'s shortlist`
          : `An update on your ${entries[0].vacancy_title} application`)
      : 'Updates on your applications'

    const entryHtml = (e: StatusEntry) => e.status === 'shortlisted'
      ? `<tr><td style="padding:12px 0;border-bottom:1px solid #f0f0f2;">
           <div style="font-size:15px;font-weight:600;color:#111827;">⭐ You're on ${escapeHtml(e.club_name)}'s shortlist</div>
           <div style="font-size:13px;color:#6b7280;margin-top:2px;">${escapeHtml(e.vacancy_title)} — keep your profile sharp while they review.</div>
           ${e.opportunity_id ? `<a href="${HOCKIA_BASE_URL}/opportunities/${e.opportunity_id}" style="font-size:13px;color:#6d28d9;text-decoration:none;font-weight:600;">View opportunity →</a>` : ''}
         </td></tr>`
      : `<tr><td style="padding:12px 0;border-bottom:1px solid #f0f0f2;">
           <div style="font-size:15px;font-weight:600;color:#111827;">${escapeHtml(e.club_name)} went another way for ${escapeHtml(e.vacancy_title)}</div>
           <div style="font-size:13px;color:#6b7280;margin-top:2px;">It often comes down to fit, not ability — a clear answer beats silence, and the right opening is out there.</div>
         </td></tr>`

    const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f6f6f8;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:12px;padding:28px;">
      <tr><td>
        <img src="https://www.inhockia.com/hockia-logo-white.png" alt="HOCKIA" width="100" height="24" style="height:24px;width:100px;background:#6d28d9;padding:8px 12px;border-radius:6px;margin-bottom:18px;" />
        <div style="font-size:20px;font-weight:700;color:#111827;">Hi ${escapeHtml(firstName)},</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:6px;">
          ${entries.map(entryHtml).join('')}
        </table>
        ${suggestionsHtml(suggestions, HOCKIA_BASE_URL)}
        <div style="margin-top:20px;">
          <a href="${HOCKIA_BASE_URL}/opportunities" style="display:inline-block;background:#111827;color:#ffffff;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;">Open HOCKIA</a>
        </div>
        <p style="font-size:12px;color:#9ca3af;margin-top:24px;">
          <a href="${HOCKIA_BASE_URL}/settings" style="color:#6d28d9;">Notification settings</a>
        </p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`

    const text = [
      `Hi ${firstName},`,
      '',
      ...shortlisted.map((e) => `⭐ You're on ${e.club_name}'s shortlist for ${e.vacancy_title}.`),
      ...rejected.map((e) => `${e.club_name} went another way for ${e.vacancy_title}. It often comes down to fit, not ability.`),
      suggestionsText(suggestions, HOCKIA_BASE_URL),
      '',
      `Open HOCKIA: ${HOCKIA_BASE_URL}/opportunities`,
    ].join('\n')

    const rendered = await renderTemplate(supabase, 'application_status', {
      first_name: firstName,
      count: String(entries.length),
      suggestions_html: suggestionsHtml(suggestions, HOCKIA_BASE_URL),
      cta_url: `${HOCKIA_BASE_URL}/opportunities`,
      settings_url: `${HOCKIA_BASE_URL}/settings`,
    })

    const result = await sendTrackedEmail({
      supabase,
      resendApiKey,
      to: player.email,
      subject: rendered?.subject ?? subject,
      html: rendered?.html ?? html,
      text: rendered?.text ?? text,
      templateKey: 'application_status',
      recipientId: player.id,
      recipientRole: player.role ?? undefined,
      logger,
      metadata: { batch_ts: queueRecord.batch_ts, notification_count: entries.length },
    })

    if (!result.success) {
      await recordFailure(result.error ?? 'send failed')
      return json(500, { error: 'Failed to send status email', details: result.error })
    }

    await markProcessed()
    logger.info('=== Status email sent ===', {
      player: player.id,
      shortlisted: shortlisted.length,
      rejected: rejected.length,
      suggestions: suggestions.length,
    })
    return json(200, { success: true, entries: entries.length })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    createLogger(correlationId).error('Unhandled error', { error: message })
    captureException(error, { functionName: 'notify-application-status', correlationId })
    return json(500, { error: 'Internal server error', details: message })
  }
})
