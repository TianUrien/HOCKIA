// deno-lint-ignore-file no-explicit-any
import { getServiceClient } from '../_shared/supabase-client.ts'
import { captureException } from '../_shared/sentry.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { renderTemplate } from '../_shared/email-renderer.ts'
import { sendTrackedEmail } from '../_shared/email-sender.ts'
import { hashToken, mintRawToken } from '../_shared/action-tokens.ts'

/**
 * ============================================================================
 * Weekly Pending-Applications Digest (Task 1 of the application response loop)
 * ============================================================================
 *
 * Triggered by database webhook on INSERT to application_digest_queue
 * (pg_cron runs enqueue_application_digests() Mondays 09:00 UTC).
 *
 * Sends the publisher ONE email listing their pending applications with
 * one-click triage buttons that mirror the in-app dropdown exactly:
 *   ⭐ Good fit → shortlisted   ❓ Maybe → maybe   ✗ Not a fit → rejected
 * Buttons link to the application-action edge fn with single-use tokens.
 *
 * Tokens are minted HERE, at send time (never at enqueue time), so a failed
 * send cannot leave live orphan tokens. Only the displayed rows (max
 * MAX_ROWS) get tokens; the "+N more" overflow routes into the app.
 *
 * Idempotency: one send per (publisher, week) — checked against email_sends
 * via metadata.week_start before sending (webhook double-delivery safe).
 * ============================================================================
 */

const MAX_ROWS = 10
const TOKEN_TTL_DAYS = 14
const ACTIONS = ['shortlisted', 'maybe', 'rejected'] as const
type Action = (typeof ACTIONS)[number]

const ACTION_LABEL: Record<Action, string> = {
  shortlisted: '⭐ Good fit',
  maybe: '❓ Maybe',
  rejected: '✗ Not a fit',
}

interface QueueRecord {
  id: string
  publisher_id: string
  week_start: string
  application_ids: string[]
  attempts: number
}

interface PendingRow {
  id: string
  applicant_id: string | null
  opportunity_id: string | null
  applicant_name: string
  position: string | null
  opportunity_title: string
  days_waiting: number
}

function createLogger(correlationId: string) {
  const prefix = `[NOTIFY_APPLICATION_DIGEST][${correlationId}]`
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
    if (payload.table !== 'application_digest_queue' || payload.type !== 'INSERT') {
      return json(200, { message: 'Ignored - not an application digest queue INSERT' })
    }

    const queueRecord = payload.record as QueueRecord
    const supabase = getServiceClient()
    const IS_STAGING = (Deno.env.get('SUPABASE_URL') ?? '').includes('ivjkdaylalhsteyyclvl')

    logger.info('Processing digest', {
      queueId: queueRecord.id,
      publisherId: queueRecord.publisher_id,
      weekStart: queueRecord.week_start,
      applicationCount: queueRecord.application_ids?.length,
    })

    const markProcessed = async () => {
      const { error } = await supabase
        .from('application_digest_queue')
        .update({ processed_at: new Date().toISOString() })
        .eq('id', queueRecord.id)
      if (error) logger.error('Failed to mark queue row processed', { error: error.message })
    }
    const recordFailure = async (message: string) => {
      const { error } = await supabase
        .from('application_digest_queue')
        .update({ attempts: (queueRecord.attempts ?? 0) + 1, last_error: message.slice(0, 500) })
        .eq('id', queueRecord.id)
      if (error) logger.error('Failed to record queue failure', { error: error.message })
    }

    // ── Publisher eligibility (re-checked at send time) ──
    const { data: publisher, error: publisherError } = await supabase
      .from('profiles')
      .select('id, email, full_name, role, is_test_account, onboarding_completed, notify_applications')
      .eq('id', queueRecord.publisher_id)
      .single()

    if (publisherError || !publisher) {
      await recordFailure(`publisher fetch failed: ${publisherError?.message}`)
      return json(500, { error: 'Failed to fetch publisher profile' })
    }

    if (
      (publisher.is_test_account && !IS_STAGING) ||
      !publisher.onboarding_completed ||
      !publisher.email ||
      publisher.notify_applications === false
    ) {
      logger.info('Publisher not eligible, skipping', { publisherId: publisher.id })
      await markProcessed()
      return json(200, { message: 'Ignored - publisher not eligible' })
    }

    // ── Master switch re-check ──
    const { data: settings } = await supabase
      .from('application_response_settings')
      .select('digest_enabled')
      .maybeSingle()
    if (!settings?.digest_enabled) {
      logger.info('Digest disabled in settings, skipping')
      await markProcessed()
      return json(200, { message: 'Ignored - digest disabled' })
    }

    // ── Idempotency: one send per (publisher, week) ──
    const { count: alreadySent } = await supabase
      .from('email_sends')
      .select('id', { count: 'exact', head: true })
      .eq('template_key', 'application_digest')
      .eq('status', 'sent')
      .eq('recipient_id', publisher.id)
      .eq('metadata->>week_start', queueRecord.week_start)
    if (alreadySent && alreadySent > 0) {
      logger.info('Digest already sent this week, skipping', { publisherId: publisher.id })
      await markProcessed()
      return json(200, { message: 'Ignored - already sent this week' })
    }

    // ── Re-fetch the applications: only rows STILL pending on OPEN
    //    opportunities (the publisher may have triaged since enqueue) ──
    const { data: apps, error: appsError } = await supabase
      .from('opportunity_applications')
      .select(`
        id,
        applied_at,
        status,
        opportunity:opportunities (id, title, status, application_deadline),
        applicant:profiles (id, full_name, position)
      `)
      .in('id', queueRecord.application_ids ?? [])
      .eq('status', 'pending')

    if (appsError) {
      await recordFailure(`applications fetch failed: ${appsError.message}`)
      return json(500, { error: 'Failed to fetch applications' })
    }

    const nowMs = Date.now()
    // Inventory hygiene: never ask the publisher to triage a listing that is
    // closed OR past its application deadline (the daily closer usually
    // catches these; this guards the mid-week race).
    const todayIso = new Date().toISOString().slice(0, 10)
    const rows: PendingRow[] = (apps ?? [])
      .filter((a: any) =>
        a.opportunity?.status === 'open' &&
        (!a.opportunity?.application_deadline || a.opportunity.application_deadline >= todayIso))
      .map((a: any) => ({
        id: a.id,
        applicant_id: a.applicant?.id ?? null,
        opportunity_id: a.opportunity?.id ?? null,
        applicant_name: a.applicant?.full_name?.trim() || 'An applicant',
        position: a.applicant?.position ?? null,
        opportunity_title: a.opportunity?.title ?? 'your opportunity',
        days_waiting: Math.max(0, Math.floor((nowMs - new Date(a.applied_at).getTime()) / 86_400_000)),
      }))
      .sort((a, b) => b.days_waiting - a.days_waiting)

    if (rows.length === 0) {
      logger.info('No still-pending applications, skipping', { publisherId: publisher.id })
      await markProcessed()
      return json(200, { message: 'Ignored - nothing pending anymore' })
    }

    const shown = rows.slice(0, MAX_ROWS)
    const overflow = rows.length - shown.length

    // ── Mint single-use action tokens (send time, displayed rows only) ──
    // Links land on the APP's public /email-action page (which drives the
    // application-action JSON API): pages can't be served from *.supabase.co
    // (the gateway forces text/plain + a sandbox CSP onto HTML there), and
    // the app domain gives publishers logged-in continuity after acting.
    const HOCKIA_BASE_URL_FOR_LINKS = Deno.env.get('PUBLIC_SITE_URL') ?? 'https://inhockia.com'
    const actionBase = `${HOCKIA_BASE_URL_FOR_LINKS}/email-action`
    const expiresAt = new Date(nowMs + TOKEN_TTL_DAYS * 86_400_000).toISOString()

    const tokenRows: Array<Record<string, unknown>> = []
    const linkFor = new Map<string, string>() // `${appId}:${action}` -> URL
    for (const row of shown) {
      for (const action of ACTIONS) {
        const raw = mintRawToken()
        tokenRows.push({
          token_hash: await hashToken(raw),
          application_id: row.id,
          action,
          publisher_id: publisher.id,
          expires_at: expiresAt,
        })
        linkFor.set(`${row.id}:${action}`, `${actionBase}?t=${raw}`)
      }
    }

    const { error: tokenError } = await supabase.from('email_action_tokens').insert(tokenRows as any)
    if (tokenError) {
      await recordFailure(`token mint failed: ${tokenError.message}`)
      return json(500, { error: 'Failed to mint action tokens' })
    }

    // ── Compose ──
    const HOCKIA_BASE_URL = Deno.env.get('PUBLIC_SITE_URL') ?? 'https://inhockia.com'
    const firstName = publisher.full_name?.split(' ')[0]?.trim() || 'there'
    const oldest = rows[0].days_waiting
    const subject = rows.length === 1
      ? '1 applicant is waiting for your response on HOCKIA'
      : `${rows.length} applicants are waiting for your response on HOCKIA`

    const btn = (url: string, label: string, solid: boolean) =>
      `<a href="${url}" style="display:inline-block;padding:8px 14px;margin:2px 6px 2px 0;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;${
        solid
          ? 'background:#6d28d9;color:#ffffff;'
          : 'background:#f3f4f6;color:#374151;border:1px solid #e5e7eb;'
      }">${label}</a>`

    const rowsHtml = shown
      .map((r) => {
        const meta = [r.position, `waiting ${r.days_waiting} day${r.days_waiting === 1 ? '' : 's'}`]
          .filter(Boolean)
          .join(' · ')
        // Flow-investigation fixes (2026-07-14): recruiters won't triage an
        // applicant they can't SEE — the name + an explicit link open the
        // public profile (logged-out friendly, not AASA-claimed), and the
        // role title deep-links to that opportunity's applicant list.
        const profileUrl = r.applicant_id ? `${HOCKIA_BASE_URL}/players/id/${r.applicant_id}` : null
        const applicantsUrl = r.opportunity_id
          ? `${HOCKIA_BASE_URL}/dashboard/opportunities/${r.opportunity_id}/applicants`
          : null
        const nameHtml = profileUrl
          ? `<a href="${profileUrl}" style="color:#111827;text-decoration:none;">${escapeHtml(r.applicant_name)}</a>`
          : escapeHtml(r.applicant_name)
        const titleHtml = applicantsUrl
          ? `<a href="${applicantsUrl}" style="color:#6b7280;text-decoration:underline;">${escapeHtml(r.opportunity_title)}</a>`
          : escapeHtml(r.opportunity_title)
        return `
        <tr>
          <td style="padding:14px 0;border-bottom:1px solid #f0f0f2;">
            <div style="font-size:15px;font-weight:600;color:#111827;">${nameHtml}${
              profileUrl
                ? ` &nbsp;<a href="${profileUrl}" style="font-size:13px;font-weight:600;color:#6d28d9;text-decoration:none;">View profile &rarr;</a>`
                : ''
            }</div>
            <div style="font-size:13px;color:#6b7280;margin:2px 0 8px;">${escapeHtml(meta)} · ${titleHtml}</div>
            <div>
              ${btn(linkFor.get(`${r.id}:shortlisted`)!, ACTION_LABEL.shortlisted, true)}
              ${btn(linkFor.get(`${r.id}:maybe`)!, ACTION_LABEL.maybe, false)}
              ${btn(linkFor.get(`${r.id}:rejected`)!, ACTION_LABEL.rejected, false)}
            </div>
          </td>
        </tr>`
      })
      .join('')

    // The Pulse IS the triage surface (Phase 2/3): applicants-waiting card +
    // per-role health at the top of /home for clubs AND recruiting coaches.
    // The old generic /dashboard landing lost the one publisher who clicked
    // (12-second bounce without ever reaching his applicants).
    const dashboardUrl = `${HOCKIA_BASE_URL}/home`
    const fallbackHtml = `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f6f6f8;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:12px;padding:28px;">
      <tr><td>
        <img src="https://www.inhockia.com/hockia-logo-white.png" alt="HOCKIA" width="100" height="24" style="height:24px;width:100px;background:#6d28d9;padding:8px 12px;border-radius:6px;margin-bottom:18px;" />
        <div style="font-size:20px;font-weight:700;color:#111827;">Hi ${escapeHtml(firstName)},</div>
        <p style="font-size:15px;color:#374151;line-height:1.5;">
          You have <strong>${rows.length} application${rows.length === 1 ? '' : 's'}</strong> waiting for your response
          &mdash; the oldest has been waiting <strong>${oldest} day${oldest === 1 ? '' : 's'}</strong>.
          Triage them right from this email; each button works once and does exactly what the in-app options do.
        </p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rowsHtml}</table>
        ${overflow > 0 ? `<p style="font-size:13px;color:#6b7280;">+ ${overflow} more waiting in HOCKIA.</p>` : ''}
        <div style="margin-top:20px;">
          <a href="${dashboardUrl}" style="display:inline-block;background:#111827;color:#ffffff;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;">Review in HOCKIA</a>
        </div>
        <p style="font-size:12px;color:#9ca3af;margin-top:24px;">
          Applicants are notified when you respond &mdash; a quick answer, even a no, beats silence.
          You receive this weekly summary while you have unanswered applications.
          <a href="${HOCKIA_BASE_URL}/settings" style="color:#6d28d9;">Notification settings</a>
        </p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`

    const fallbackText = [
      `Hi ${firstName},`,
      '',
      `You have ${rows.length} application${rows.length === 1 ? '' : 's'} waiting for your response (oldest: ${oldest} day${oldest === 1 ? '' : 's'}).`,
      '',
      ...shown.map((r) =>
        `- ${r.applicant_name}${r.position ? ` (${r.position})` : ''} — ${r.opportunity_title} — waiting ${r.days_waiting} day${r.days_waiting === 1 ? '' : 's'}`
      ),
      overflow > 0 ? `...and ${overflow} more.` : '',
      '',
      `Review in HOCKIA: ${dashboardUrl}`,
    ].filter((l) => l !== '').join('\n')

    // DB template can override the layout later without a redeploy; the
    // hardcoded fallback above is what runs until one exists.
    const rendered = await renderTemplate(supabase, 'application_digest', {
      first_name: firstName,
      application_count: String(rows.length),
      oldest_days: String(oldest),
      rows_html: rowsHtml,
      rows_text: fallbackText,
      cta_url: dashboardUrl,
      settings_url: `${HOCKIA_BASE_URL}/settings`,
    })

    const result = await sendTrackedEmail({
      supabase,
      resendApiKey,
      to: publisher.email,
      subject: rendered?.subject ?? subject,
      html: rendered?.html ?? fallbackHtml,
      text: rendered?.text ?? fallbackText,
      templateKey: 'application_digest',
      recipientId: publisher.id,
      recipientRole: publisher.role ?? undefined,
      logger,
      metadata: { digest: 'pending_applications', week_start: queueRecord.week_start },
    })

    if (!result.success) {
      await recordFailure(result.error ?? 'send failed')
      return json(500, { error: 'Failed to send digest email', details: result.error })
    }

    await markProcessed()
    logger.info('=== Digest sent ===', {
      publisher: publisher.id,
      pending: rows.length,
      shown: shown.length,
      tokens: tokenRows.length,
    })
    return json(200, { success: true, pending: rows.length, shown: shown.length })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    createLogger(correlationId).error('Unhandled error', { error: message })
    captureException(error, { functionName: 'notify-application-digest', correlationId })
    return json(500, { error: 'Internal server error', details: message })
  }
})
