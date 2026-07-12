// deno-lint-ignore-file no-explicit-any
import { getServiceClient } from '../_shared/supabase-client.ts'
import { captureException } from '../_shared/sentry.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { sendTrackedEmail } from '../_shared/email-sender.ts'
import { fetchSuggestions, suggestionsHtml, suggestionsText } from '../_shared/opportunity-suggestions.ts'

/**
 * ============================================================================
 * Age-gate emails (P3) — drains age_gate_email_queue (DB webhook on INSERT)
 * ============================================================================
 * Kinds:
 *   goodbye      — frozen minor. Sends the warm goodbye AND applies the auth
 *                  ban in the same processing step: the freeze arrives WITH
 *                  the email, never before. Carries the logged-out waitlist
 *                  link (/juniors-waitlist page).
 *   welcome_back — 18th-birthday unfreeze. Lifts the auth ban + fresh
 *                  opportunity suggestions (old withdrawn apps stay closed).
 *   dob_request  — enforcement ask for unknown-age person accounts. Sets
 *                  dob_required_since ON SEND SUCCESS (the 14-day restriction
 *                  clock only starts for someone the email actually reached).
 *   dob_reminder — single day-10 nudge (cron-enqueued).
 *
 * These are ACCOUNT-POLICY emails: no topic notify_* pref applies (none
 * exists for account notices); the suppression list (checked inside
 * sendTrackedEmail) is the opt-out that is always honoured.
 * ============================================================================
 */

const BAN_DURATION = '87600h' // ~10 years; lifted explicitly on unfreeze

interface QueueRecord {
  id: string
  profile_id: string
  kind: 'goodbye' | 'welcome_back' | 'dob_request' | 'dob_reminder'
  sweep_date: string
  attempts: number
}

function createLogger(correlationId: string) {
  const prefix = `[NOTIFY_AGE_GATE][${correlationId}]`
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

function shell(inner: string): string {
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f6f6f8;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:12px;padding:28px;">
      <tr><td>
        <img src="https://www.inhockia.com/hockia-logo-white.png" alt="HOCKIA" width="100" height="24" style="height:24px;width:100px;background:#6d28d9;padding:8px 12px;border-radius:6px;margin-bottom:18px;" />
        ${inner}
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`
}

const btn = (url: string, label: string) =>
  `<div style="margin-top:20px;"><a href="${url}" style="display:inline-block;background:#6d28d9;color:#ffffff;padding:12px 22px;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;">${label}</a></div>`

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
    if (payload.table !== 'age_gate_email_queue' || payload.type !== 'INSERT') {
      return json(200, { message: 'Ignored - not an age-gate queue INSERT' })
    }

    const queueRecord = payload.record as QueueRecord
    const supabase = getServiceClient()
    const IS_STAGING = (Deno.env.get('SUPABASE_URL') ?? '').includes('ivjkdaylalhsteyyclvl')
    const HOCKIA_BASE_URL = Deno.env.get('PUBLIC_SITE_URL') ?? 'https://inhockia.com'

    const markProcessed = async () => {
      const { error } = await supabase
        .from('age_gate_email_queue')
        .update({ processed_at: new Date().toISOString() })
        .eq('id', queueRecord.id)
      if (error) logger.error('Failed to mark queue row processed', { error: error.message })
    }
    const recordFailure = async (message: string) => {
      const { error } = await supabase
        .from('age_gate_email_queue')
        .update({ attempts: (queueRecord.attempts ?? 0) + 1, last_error: message.slice(0, 500) })
        .eq('id', queueRecord.id)
      if (error) logger.error('Failed to record queue failure', { error: error.message })
    }

    const { data: person, error: personError } = await supabase
      .from('profiles')
      .select('id, email, full_name, role, is_test_account, frozen_minor_at, date_of_birth, dob_required_since')
      .eq('id', queueRecord.profile_id)
      .single()

    if (personError || !person) {
      await recordFailure(`profile fetch failed: ${personError?.message}`)
      return json(500, { error: 'Failed to fetch profile' })
    }

    // ── Session ban / unban pairs with the email processing step ──
    if (queueRecord.kind === 'goodbye') {
      const { error: banError } = await (supabase.auth as any).admin.updateUserById(person.id, {
        ban_duration: BAN_DURATION,
      })
      if (banError) {
        await recordFailure(`auth ban failed: ${banError.message}`)
        return json(500, { error: 'Failed to apply auth ban' })
      }
    }
    if (queueRecord.kind === 'welcome_back') {
      const { error: unbanError } = await (supabase.auth as any).admin.updateUserById(person.id, {
        ban_duration: 'none',
      })
      if (unbanError) {
        await recordFailure(`auth unban failed: ${unbanError.message}`)
        return json(500, { error: 'Failed to lift auth ban' })
      }
    }

    if ((person.is_test_account && !IS_STAGING) || !person.email) {
      logger.info('No sendable email (ban/unban still applied where relevant)', { profileId: person.id })
      await markProcessed()
      return json(200, { message: 'Processed without email' })
    }

    // ── Idempotency: one email per (profile, kind, sweep) ──
    const { count: alreadySent } = await supabase
      .from('email_sends')
      .select('id', { count: 'exact', head: true })
      .eq('template_key', `age_gate_${queueRecord.kind}`)
      .eq('status', 'sent')
      .eq('recipient_id', person.id)
      .eq('metadata->>sweep_date', queueRecord.sweep_date)
    if (alreadySent && alreadySent > 0) {
      await markProcessed()
      return json(200, { message: 'Ignored - already sent' })
    }

    const firstName = person.full_name?.split(' ')[0]?.trim() || 'there'
    let subject = ''
    let html = ''
    let text = ''

    if (queueRecord.kind === 'goodbye') {
      const waitlistUrl = `${HOCKIA_BASE_URL}/juniors-waitlist?e=${encodeURIComponent(btoa(person.email))}`
      subject = 'Your HOCKIA profile is saved for you'
      html = shell(`
        <div style="font-size:20px;font-weight:700;color:#111827;">Hi ${escapeHtml(firstName)},</div>
        <p style="font-size:15px;color:#374151;line-height:1.6;">
          HOCKIA is 18+ for now. Your profile is <strong>saved, not deleted</strong> —
          everything you built is waiting for you.
        </p>
        <p style="font-size:15px;color:#374151;line-height:1.6;">
          We're building <strong>HOCKIA Juniors</strong>, a version with protections
          designed for young players. Want to be first to know when it opens?
        </p>
        ${btn(waitlistUrl, 'Keep me posted')}
        <p style="font-size:13px;color:#6b7280;line-height:1.5;margin-top:20px;">
          Questions, or want your data removed instead? Just reply, or write to
          <a href="mailto:team@inhockia.com" style="color:#6d28d9;">team@inhockia.com</a> —
          we answer every message.
        </p>`)
      text = [
        `Hi ${firstName},`, '',
        'HOCKIA is 18+ for now. Your profile is saved, not deleted — everything you built is waiting for you.',
        "We're building HOCKIA Juniors, a version with protections designed for young players. Want to be first to know when it opens?",
        waitlistUrl, '',
        'Questions, or want your data removed instead? Write to team@inhockia.com — we answer every message.',
      ].join('\n')
    } else if (queueRecord.kind === 'welcome_back') {
      const suggestions = await fetchSuggestions(supabase, person.id, [], 3)
      subject = 'Welcome back — your HOCKIA profile is live again'
      html = shell(`
        <div style="font-size:20px;font-weight:700;color:#111827;">Happy 18th, ${escapeHtml(firstName)}! 🎉</div>
        <p style="font-size:15px;color:#374151;line-height:1.6;">
          Your HOCKIA profile is live again — exactly as you left it. The hockey
          market kept moving while you were away; here's what's open right now:
        </p>
        ${suggestionsHtml(suggestions, HOCKIA_BASE_URL)}
        ${btn(`${HOCKIA_BASE_URL}/opportunities`, 'Browse open opportunities')}`)
      text = [
        `Happy 18th, ${firstName}!`, '',
        'Your HOCKIA profile is live again — exactly as you left it.',
        suggestionsText(suggestions, HOCKIA_BASE_URL), '',
        `Browse open opportunities: ${HOCKIA_BASE_URL}/opportunities`,
      ].join('\n')
    } else {
      // dob_request / dob_reminder
      const isReminder = queueRecord.kind === 'dob_reminder'
      const deadline = person.dob_required_since
        ? new Date(new Date(person.dob_required_since).getTime() + 14 * 86_400_000)
        : new Date(Date.now() + 14 * 86_400_000)
      const deadlineStr = deadline.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
      subject = isReminder
        ? 'A few days left to confirm your date of birth'
        : 'Confirm your date of birth to keep your full profile active'
      html = shell(`
        <div style="font-size:20px;font-weight:700;color:#111827;">Hi ${escapeHtml(firstName)},</div>
        <p style="font-size:15px;color:#374151;line-height:1.6;">
          ${isReminder
            ? `Quick reminder — you have until <strong>${deadlineStr}</strong> to confirm your date of birth on HOCKIA.`
            : 'HOCKIA is an 18+ platform, and your profile doesn’t have a date of birth yet. Confirming takes one tap after signing in.'}
        </p>
        <p style="font-size:14px;color:#374151;line-height:1.6;">
          ${isReminder
            ? 'After that date your profile is temporarily hidden from discovery and new messages until you confirm — nothing is deleted.'
            : `You have until <strong>${deadlineStr}</strong>. After that your profile is temporarily hidden from discovery and new messages until you confirm — nothing is deleted.`}
          Your birthdate stays private; other members only ever see your age.
        </p>
        ${btn(HOCKIA_BASE_URL, 'Confirm now')}`)
      text = [
        `Hi ${firstName},`, '',
        isReminder
          ? `Quick reminder — you have until ${deadlineStr} to confirm your date of birth on HOCKIA.`
          : `HOCKIA is an 18+ platform, and your profile doesn't have a date of birth yet. Confirming takes one tap after signing in.`,
        `After ${deadlineStr} your profile is temporarily hidden from discovery and new messages until you confirm — nothing is deleted. Your birthdate stays private; other members only ever see your age.`,
        '', `Confirm now: ${HOCKIA_BASE_URL}`,
      ].join('\n')
    }

    const result = await sendTrackedEmail({
      supabase,
      resendApiKey,
      to: person.email,
      subject,
      html,
      text,
      templateKey: `age_gate_${queueRecord.kind}`,
      recipientId: person.id,
      recipientRole: person.role ?? undefined,
      logger,
      metadata: { sweep_date: queueRecord.sweep_date, kind: queueRecord.kind },
    })

    if (!result.success) {
      await recordFailure(result.error ?? 'send failed')
      return json(500, { error: 'Failed to send age-gate email', details: result.error })
    }

    // Clock-only-if-sent: the 14-day restriction starts only when the ask
    // actually reached the user.
    if (queueRecord.kind === 'dob_request' && !person.dob_required_since) {
      const { error: clockError } = await supabase
        .from('profiles')
        .update({ dob_required_since: new Date().toISOString() } as any)
        .eq('id', person.id)
      if (clockError) logger.error('Failed to set dob_required_since', { error: clockError.message })
    }

    await markProcessed()
    logger.info('=== Age-gate email sent ===', { profile: person.id, kind: queueRecord.kind })
    return json(200, { success: true, kind: queueRecord.kind })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    createLogger(correlationId).error('Unhandled error', { error: message })
    captureException(error, { functionName: 'notify-age-gate', correlationId })
    return json(500, { error: 'Internal server error', details: message })
  }
})
