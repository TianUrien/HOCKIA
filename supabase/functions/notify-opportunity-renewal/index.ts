// deno-lint-ignore-file no-explicit-any
import { getServiceClient } from '../_shared/supabase-client.ts'
import { captureException } from '../_shared/sentry.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { renderTemplate } from '../_shared/email-renderer.ts'
import { sendTrackedEmail } from '../_shared/email-sender.ts'
import { hashToken, mintRawToken } from '../_shared/action-tokens.ts'

/**
 * ============================================================================
 * Opportunity renewal email (P2 inventory hygiene)
 * ============================================================================
 *
 * Triggered by database webhook on INSERT to opportunity_renewal_queue
 * (close_expired_opportunities() runs daily via pg_cron at 07:30 UTC and
 * closes listings whose application_deadline has passed).
 *
 * Tells the publisher their listing closed and offers a ONE-CLICK renewal:
 * a single-use magic link (same token infra as the digest triage buttons)
 * that reopens the listing with a fresh 30-day deadline. Token minted at
 * SEND time so a failed send never leaves a live orphan token.
 *
 * Copy contract: operational and neutral — the deadline passed, nothing is
 * wrong; renewing is one click, doing nothing is a valid choice ("it stays
 * closed"). Publisher may be a club OR a coach — say "your opportunity",
 * never assume "club".
 * ============================================================================
 */

const TOKEN_TTL_DAYS = 14

interface QueueRecord {
  id: string
  opportunity_id: string
  publisher_id: string
  sweep_date: string
  attempts: number
}

function createLogger(correlationId: string) {
  const prefix = `[NOTIFY_OPPORTUNITY_RENEWAL][${correlationId}]`
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
    if (payload.table !== 'opportunity_renewal_queue' || payload.type !== 'INSERT') {
      return json(200, { message: 'Ignored - not a renewal queue INSERT' })
    }

    const queueRecord = payload.record as QueueRecord
    const supabase = getServiceClient()
    const IS_STAGING = (Deno.env.get('SUPABASE_URL') ?? '').includes('ivjkdaylalhsteyyclvl')

    const markProcessed = async () => {
      const { error } = await supabase
        .from('opportunity_renewal_queue')
        .update({ processed_at: new Date().toISOString() })
        .eq('id', queueRecord.id)
      if (error) logger.error('Failed to mark queue row processed', { error: error.message })
    }
    const recordFailure = async (message: string) => {
      const { error } = await supabase
        .from('opportunity_renewal_queue')
        .update({ attempts: (queueRecord.attempts ?? 0) + 1, last_error: message.slice(0, 500) })
        .eq('id', queueRecord.id)
      if (error) logger.error('Failed to record queue failure', { error: error.message })
    }

    // ── Publisher eligibility (re-checked at send time). This email is
    //    OPERATIONAL (their own listing went offline) so it is deliberately
    //    NOT gated on notify_applications — only email + test-account rule. ──
    const { data: publisher, error: pubError } = await supabase
      .from('profiles')
      .select('id, email, full_name, role, is_test_account, is_blocked, frozen_minor_at')
      .eq('id', queueRecord.publisher_id)
      .single()

    if (pubError || !publisher) {
      await recordFailure(`publisher fetch failed: ${pubError?.message}`)
      return json(500, { error: 'Failed to fetch publisher profile' })
    }
    // Hidden publishers (admin ban / frozen minor) are fenced at enqueue time;
    // this re-check covers a ban landing between the sweep and this send.
    const publisherHidden = publisher.is_blocked === true || publisher.frozen_minor_at !== null
    if ((publisher.is_test_account && !IS_STAGING) || !publisher.email || publisherHidden) {
      logger.info('Publisher not eligible, skipping', { publisherId: publisher.id })
      await markProcessed()
      return json(200, { message: 'Ignored - publisher not eligible' })
    }

    // ── Idempotency: one renewal email per (opportunity, sweep) ──
    const { count: alreadySent } = await supabase
      .from('email_sends')
      .select('id', { count: 'exact', head: true })
      .eq('template_key', 'opportunity_renewal')
      .eq('status', 'sent')
      .eq('recipient_id', publisher.id)
      .eq('metadata->>opportunity_id', queueRecord.opportunity_id)
      .eq('metadata->>sweep_date', queueRecord.sweep_date)
    if (alreadySent && alreadySent > 0) {
      logger.info('Renewal email already sent for this sweep, skipping')
      await markProcessed()
      return json(200, { message: 'Ignored - already sent' })
    }

    // ── The opportunity must still be hygiene-closed (skip if the publisher
    //    already renewed/reopened it by any path) ──
    const { data: opp, error: oppError } = await supabase
      .from('opportunities')
      .select('id, title, status, application_deadline, auto_closed_at')
      .eq('id', queueRecord.opportunity_id)
      .single()

    if (oppError || !opp) {
      await recordFailure(`opportunity fetch failed: ${oppError?.message}`)
      return json(500, { error: 'Failed to fetch opportunity' })
    }
    if (opp.status !== 'closed' || !opp.auto_closed_at) {
      logger.info('Opportunity no longer hygiene-closed, skipping', { opportunityId: opp.id })
      await markProcessed()
      return json(200, { message: 'Ignored - already reopened' })
    }

    // Motivator: how many applicants are still waiting on this listing.
    const { count: pendingCount } = await supabase
      .from('opportunity_applications')
      .select('id', { count: 'exact', head: true })
      .eq('opportunity_id', opp.id)
      .eq('status', 'pending')

    // ── Mint the single-use renew token at send time ──
    const raw = mintRawToken()
    const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 86_400_000).toISOString()
    const { error: tokenError } = await supabase.from('email_action_tokens').insert({
      token_hash: await hashToken(raw),
      opportunity_id: opp.id,
      action: 'renew',
      publisher_id: publisher.id,
      expires_at: expiresAt,
    } as any)
    if (tokenError) {
      await recordFailure(`token mint failed: ${tokenError.message}`)
      return json(500, { error: 'Failed to mint renew token' })
    }

    // ── Compose ──
    const HOCKIA_BASE_URL = Deno.env.get('PUBLIC_SITE_URL') ?? 'https://inhockia.com'
    const renewUrl = `${HOCKIA_BASE_URL}/email-action?t=${raw}`
    const firstName = publisher.full_name?.split(' ')[0]?.trim() || 'there'
    const subject = `Your opportunity "${opp.title}" reached its deadline`
    const waitingLine = (pendingCount ?? 0) > 0
      ? (pendingCount === 1
          ? '1 applicant is still waiting for a response on it.'
          : `${pendingCount} applicants are still waiting for a response on it.`)
      : ''

    const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f6f6f8;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:12px;padding:28px;">
      <tr><td>
        <img src="https://www.inhockia.com/hockia-logo-white.png" alt="HOCKIA" width="100" height="24" style="height:24px;width:100px;background:#6d28d9;padding:8px 12px;border-radius:6px;margin-bottom:18px;" />
        <div style="font-size:20px;font-weight:700;color:#111827;">Hi ${escapeHtml(firstName)},</div>
        <p style="font-size:15px;color:#374151;line-height:1.55;">
          Your opportunity <strong>${escapeHtml(opp.title)}</strong> reached its application deadline and is now closed on HOCKIA.
          ${waitingLine ? `<br/><strong>${waitingLine}</strong>` : ''}
        </p>
        <p style="font-size:14px;color:#374151;line-height:1.55;">
          Still recruiting for this role? One click reopens it with a fresh 30-day deadline:
        </p>
        <div style="margin-top:16px;">
          <a href="${renewUrl}" style="display:inline-block;background:#6d28d9;color:#ffffff;padding:12px 22px;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;">Renew for 30 days</a>
        </div>
        <p style="font-size:13px;color:#6b7280;line-height:1.5;margin-top:16px;">
          Done recruiting for this role? Nothing to do — it stays closed, and any waiting applications will close automatically so nobody is left in limbo.
        </p>
        <p style="font-size:12px;color:#9ca3af;margin-top:24px;">
          You can also manage this opportunity <a href="${HOCKIA_BASE_URL}/opportunities/${opp.id}" style="color:#6d28d9;">in the app</a>.
        </p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`

    const text = [
      `Hi ${firstName},`,
      '',
      `Your opportunity "${opp.title}" reached its application deadline and is now closed on HOCKIA.`,
      ...(waitingLine ? [waitingLine] : []),
      '',
      `Still recruiting for this role? Renew it with a fresh 30-day deadline in one click:`,
      renewUrl,
      '',
      'Done recruiting for this role? Nothing to do — it stays closed, and any waiting applications will close automatically so nobody is left in limbo.',
    ].join('\n')

    const rendered = await renderTemplate(supabase, 'opportunity_renewal', {
      first_name: firstName,
      opportunity_title: opp.title,
      waiting_line: waitingLine,
      renew_url: renewUrl,
      manage_url: `${HOCKIA_BASE_URL}/opportunities/${opp.id}`,
    })

    const result = await sendTrackedEmail({
      supabase,
      resendApiKey,
      to: publisher.email,
      subject: rendered?.subject ?? subject,
      html: rendered?.html ?? html,
      text: rendered?.text ?? text,
      templateKey: 'opportunity_renewal',
      recipientId: publisher.id,
      recipientRole: publisher.role ?? undefined,
      logger,
      metadata: { opportunity_id: opp.id, sweep_date: queueRecord.sweep_date },
    })

    if (!result.success) {
      await recordFailure(result.error ?? 'send failed')
      return json(500, { error: 'Failed to send renewal email', details: result.error })
    }

    await markProcessed()
    logger.info('=== Renewal email sent ===', {
      publisher: publisher.id,
      opportunity: opp.id,
      pendingCount: pendingCount ?? 0,
    })
    return json(200, { success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    createLogger(correlationId).error('Unhandled error', { error: message })
    captureException(error, { functionName: 'notify-opportunity-renewal', correlationId })
    return json(500, { error: 'Internal server error', details: message })
  }
})
