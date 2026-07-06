// deno-lint-ignore-file no-explicit-any
import { getServiceClient } from '../_shared/supabase-client.ts'
import { captureException } from '../_shared/sentry.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { renderTemplate } from '../_shared/email-renderer.ts'
import { sendTrackedEmail } from '../_shared/email-sender.ts'
import { fetchSuggestions, suggestionsHtml, suggestionsText } from '../_shared/opportunity-suggestions.ts'

/**
 * ============================================================================
 * Application expiry email (Task 3b) — the honest end to indefinite limbo
 * ============================================================================
 *
 * Triggered by database webhook on INSERT to application_expiry_queue
 * (expire_overdue_applications() runs daily via pg_cron and enqueues ONE row
 * per player per sweep, no matter how many of their applications expired —
 * the batching decision: never N separate "no response" emails).
 *
 * Copy contract: honest, kind, forward-looking, and NEUTRAL about the club —
 * teams often answer off-platform (15/21 opportunities carry WhatsApp/email
 * contacts), so the email says "no longer active on HOCKIA", never "the club
 * didn't respond". Always + 2-3 similar OPEN opportunities to redirect the
 * player's energy. (Strategic audit addendum #1, 2026-07-06.)
 * ============================================================================
 */

interface QueueRecord {
  id: string
  applicant_id: string
  sweep_date: string
  application_ids: string[]
  attempts: number
}

function createLogger(correlationId: string) {
  const prefix = `[NOTIFY_APPLICATION_EXPIRY][${correlationId}]`
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
    if (payload.table !== 'application_expiry_queue' || payload.type !== 'INSERT') {
      return json(200, { message: 'Ignored - not an application expiry queue INSERT' })
    }

    const queueRecord = payload.record as QueueRecord
    const supabase = getServiceClient()
    const IS_STAGING = (Deno.env.get('SUPABASE_URL') ?? '').includes('ivjkdaylalhsteyyclvl')

    const markProcessed = async () => {
      const { error } = await supabase
        .from('application_expiry_queue')
        .update({ processed_at: new Date().toISOString() })
        .eq('id', queueRecord.id)
      if (error) logger.error('Failed to mark queue row processed', { error: error.message })
    }
    const recordFailure = async (message: string) => {
      const { error } = await supabase
        .from('application_expiry_queue')
        .update({ attempts: (queueRecord.attempts ?? 0) + 1, last_error: message.slice(0, 500) })
        .eq('id', queueRecord.id)
      if (error) logger.error('Failed to record queue failure', { error: error.message })
    }

    // ── Recipient eligibility (re-checked at send time) ──
    const { data: player, error: playerError } = await supabase
      .from('profiles')
      .select('id, email, full_name, role, is_test_account, onboarding_completed, notify_applications')
      .eq('id', queueRecord.applicant_id)
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

    // ── Idempotency: one expiry email per (player, sweep day) ──
    const { count: alreadySent } = await supabase
      .from('email_sends')
      .select('id', { count: 'exact', head: true })
      .eq('template_key', 'application_expiry')
      .eq('status', 'sent')
      .eq('recipient_id', player.id)
      .eq('metadata->>sweep_date', queueRecord.sweep_date)
    if (alreadySent && alreadySent > 0) {
      logger.info('Expiry email already sent for this sweep, skipping', { playerId: player.id })
      await markProcessed()
      return json(200, { message: 'Ignored - already sent' })
    }

    // ── The applications that expired (titles for the email) ──
    const { data: apps, error: appsError } = await supabase
      .from('opportunity_applications')
      .select('id, opportunity_id, opportunity:opportunities (id, title, club:profiles (full_name))')
      .in('id', queueRecord.application_ids ?? [])

    if (appsError || !apps || apps.length === 0) {
      await recordFailure(`applications fetch failed: ${appsError?.message ?? 'no rows'}`)
      return json(500, { error: 'Failed to fetch applications' })
    }

    const entries = apps.map((a: any) => ({
      title: a.opportunity?.title ?? 'an opportunity',
      publisher: a.opportunity?.club?.full_name ?? 'The club',
    }))
    const opportunityIds = apps.map((a: any) => a.opportunity_id).filter(Boolean)

    // ── 2-3 similar OPEN opportunities (never the expired ones) ──
    const suggestions = await fetchSuggestions(supabase, player.id, opportunityIds, 3)

    const HOCKIA_BASE_URL = Deno.env.get('PUBLIC_SITE_URL') ?? 'https://inhockia.com'
    const firstName = player.full_name?.split(' ')[0]?.trim() || 'there'
    const single = entries.length === 1

    const subject = single
      ? `Your application to ${entries[0].title} has closed`
      : `${entries.length} of your applications have closed`

    const listHtml = entries
      .map((e) => `<li style="margin:4px 0;color:#374151;font-size:14px;"><strong>${escapeHtml(e.title)}</strong> — ${escapeHtml(e.publisher)}</li>`)
      .join('')

    const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f6f6f8;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:12px;padding:28px;">
      <tr><td>
        <img src="https://www.inhockia.com/hockia-logo-white.png" alt="HOCKIA" width="100" height="24" style="height:24px;width:100px;background:#8026FA;padding:8px 12px;border-radius:6px;margin-bottom:18px;" />
        <div style="font-size:20px;font-weight:700;color:#111827;">Hi ${escapeHtml(firstName)},</div>
        <p style="font-size:15px;color:#374151;line-height:1.55;">
          ${single
            ? `Your application for <strong>${escapeHtml(entries[0].title)}</strong> is no longer active on HOCKIA.`
            : `These applications are no longer active on HOCKIA:`}
        </p>
        ${single ? '' : `<ul style="padding-left:18px;margin:8px 0;">${listHtml}</ul>`}
        <p style="font-size:14px;color:#374151;line-height:1.55;">
          Applications close automatically when there's no update on HOCKIA for a while, so you're never left waiting — some conversations simply continue elsewhere. Here's what's open right now:
        </p>
        ${suggestionsHtml(suggestions, HOCKIA_BASE_URL)}
        <div style="margin-top:20px;">
          <a href="${HOCKIA_BASE_URL}/opportunities" style="display:inline-block;background:#8026FA;color:#ffffff;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;">Browse open opportunities</a>
        </div>
        <p style="font-size:12px;color:#9ca3af;margin-top:24px;">
          <a href="${HOCKIA_BASE_URL}/settings" style="color:#8026FA;">Notification settings</a>
        </p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`

    const text = [
      `Hi ${firstName},`,
      '',
      single
        ? `Your application for "${entries[0].title}" is no longer active on HOCKIA.`
        : `These applications are no longer active on HOCKIA:`,
      ...(single ? [] : entries.map((e) => `- ${e.title} — ${e.publisher}`)),
      '',
      "Applications close automatically when there's no update on HOCKIA for a while, so you're never left waiting — some conversations simply continue elsewhere.",
      suggestionsText(suggestions, HOCKIA_BASE_URL),
      '',
      `Browse open opportunities: ${HOCKIA_BASE_URL}/opportunities`,
    ].join('\n')

    const rendered = await renderTemplate(supabase, 'application_expiry', {
      first_name: firstName,
      count: String(entries.length),
      titles_text: entries.map((e) => e.title).join(', '),
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
      templateKey: 'application_expiry',
      recipientId: player.id,
      recipientRole: player.role ?? undefined,
      logger,
      metadata: { sweep_date: queueRecord.sweep_date, application_count: entries.length },
    })

    if (!result.success) {
      await recordFailure(result.error ?? 'send failed')
      return json(500, { error: 'Failed to send expiry email', details: result.error })
    }

    await markProcessed()
    logger.info('=== Expiry email sent ===', {
      player: player.id,
      applications: entries.length,
      suggestions: suggestions.length,
    })
    return json(200, { success: true, applications: entries.length, suggestions: suggestions.length })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    createLogger(correlationId).error('Unhandled error', { error: message })
    captureException(error, { functionName: 'notify-application-expiry', correlationId })
    return json(500, { error: 'Internal server error', details: message })
  }
})
