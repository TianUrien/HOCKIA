// deno-lint-ignore-file no-explicit-any
import { getServiceClient } from '../_shared/supabase-client.ts'
import { captureException } from '../_shared/sentry.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { renderTemplate } from '../_shared/email-renderer.ts'
import { sendTrackedEmail, createLogger } from '../_shared/email-sender.ts'

/**
 * ============================================================================
 * Onboarding Reminder Email Edge Function
 * ============================================================================
 *
 * Purpose:
 * - Sends reminder emails to users who signed up but never completed onboarding
 * - Triggered by database webhook on INSERT to onboarding_reminder_queue
 * - pg_cron runs enqueue_onboarding_reminders() daily at 10:00 UTC
 *
 * 3-touch cadence:
 *   Reminder 1 (24h): "Complete your HOCKIA profile and start connecting"
 *   Reminder 2 (72h): "Your HOCKIA profile is almost ready"
 *   Reminder 3 (7d):  "Last chance to complete your HOCKIA profile"
 *
 * Safety guarantees:
 * 1. Re-checks onboarding_completed at send time (may have completed since enqueue)
 * 2. Skips test accounts
 * 3. Skips recipients with no email
 * 4. Marks queue processed on ALL exit paths
 *
 * Webhook configuration:
 * - Trigger on: INSERT on onboarding_reminder_queue table
 * ============================================================================
 */

// =============================================================================
// Reminder content variations
// =============================================================================

interface ReminderContent {
  subject: string
  heading: string
  bodyText: string
  ctaLabel: string
}

const REMINDER_CONTENT: Record<number, ReminderContent> = {
  1: {
    subject: 'Finish setting up your HOCKIA profile',
    heading: 'Your profile is waiting for you',
    bodyText:
      "You're one step away from joining the field hockey community. Complete your profile to discover opportunities, connect with the community, and showcase your skills.",
    ctaLabel: 'Complete My Profile',
  },
  2: {
    subject: 'Your HOCKIA profile is almost ready',
    heading: 'Pick up where you left off',
    bodyText:
      "Members across HOCKIA are connecting and finding opportunities. Finish setting up your profile to get started.",
    ctaLabel: 'Finish Setup',
  },
  3: {
    subject: 'Your HOCKIA profile is still incomplete',
    heading: 'Quick reminder about your profile',
    bodyText:
      "We noticed you haven't finished setting up your HOCKIA profile yet. Complete it to start receiving opportunity notifications and connect with the community.",
    ctaLabel: 'Complete Profile',
  },
}

// =============================================================================
// Webhook payload type
// =============================================================================

interface OnboardingReminderPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE'
  table: string
  record: {
    id: string
    recipient_id: string
    reminder_number: number
    created_at: string
    processed_at: string | null
  }
  old_record: any
}

// =============================================================================
// Main handler
// =============================================================================

Deno.serve(async (req: Request) => {
  const correlationId = crypto.randomUUID().slice(0, 8)
  const logger = createLogger('NOTIFY_ONBOARDING_REMINDER', correlationId)

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    logger.info('=== Received webhook request ===')

    const resendApiKey = Deno.env.get('RESEND_API_KEY')

    if (!resendApiKey) {
      logger.error('RESEND_API_KEY not configured')
      return new Response(
        JSON.stringify({ error: 'RESEND_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Parse the webhook payload
    const payload: OnboardingReminderPayload = await req.json()
    logger.info('Parsed payload', {
      type: payload.type,
      table: payload.table,
      queueId: payload.record?.id,
      recipientId: payload.record?.recipient_id,
      reminderNumber: payload.record?.reminder_number,
    })

    // Only process onboarding_reminder_queue events
    if (payload.table !== 'onboarding_reminder_queue') {
      logger.info('Ignoring non-queue event')
      return new Response(
        JSON.stringify({ message: 'Ignored - not an onboarding reminder queue event' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (payload.type !== 'INSERT') {
      logger.info('Ignoring non-INSERT event', { type: payload.type })
      return new Response(
        JSON.stringify({ message: 'Ignored - not a new queue entry' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const queueRecord = payload.record
    const supabase = getServiceClient()

    // Validate reminder number
    const reminderNumber = queueRecord.reminder_number
    if (!REMINDER_CONTENT[reminderNumber]) {
      logger.error('Invalid reminder number', { reminderNumber })
      await markQueueProcessed(supabase, queueRecord.id, logger)
      return new Response(
        JSON.stringify({ error: 'Invalid reminder number' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Fetch recipient profile
    const { data: recipient, error: recipientError } = await supabase
      .from('profiles')
      .select('id, email, full_name, is_test_account, onboarding_completed')
      .eq('id', queueRecord.recipient_id)
      .single()

    if (recipientError || !recipient) {
      logger.error('Failed to fetch recipient profile', { error: recipientError?.message })
      await markQueueProcessed(supabase, queueRecord.id, logger)
      return new Response(
        JSON.stringify({ error: 'Failed to fetch recipient profile' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    logger.info('Fetched recipient', {
      recipientId: recipient.id,
      email: recipient.email,
      fullName: recipient.full_name,
      isTestAccount: recipient.is_test_account,
      onboardingCompleted: recipient.onboarding_completed,
      reminderNumber,
    })

    // =========================================================================
    // Safety checks — mark processed on all early returns
    // =========================================================================

    if (recipient.is_test_account) {
      logger.info('Ignoring - recipient is a test account', { recipientId: recipient.id })
      await markQueueProcessed(supabase, queueRecord.id, logger)
      return new Response(
        JSON.stringify({ message: 'Ignored - recipient is a test account' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Re-check: user may have completed onboarding since enqueue
    if (recipient.onboarding_completed) {
      logger.info('Skipping - recipient has completed onboarding since enqueue', { recipientId: recipient.id })
      await markQueueProcessed(supabase, queueRecord.id, logger)
      return new Response(
        JSON.stringify({ message: 'Skipped - recipient already completed onboarding' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!recipient.email) {
      logger.info('Ignoring - recipient has no email address', { recipientId: recipient.id })
      await markQueueProcessed(supabase, queueRecord.id, logger)
      return new Response(
        JSON.stringify({ message: 'Ignored - recipient has no email address' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // =========================================================================
    // Build template variables
    // =========================================================================

    // These users never completed onboarding so full_name is typically NULL.
    // Derive a first name from the email address as a fallback.
    const firstName = recipient.full_name
      ? recipient.full_name.split(' ')[0].trim()
      : recipient.email.split('@')[0].trim()

    const content = REMINDER_CONTENT[reminderNumber]
    const HOCKIA_BASE_URL = Deno.env.get('PUBLIC_SITE_URL') ?? 'https://inhockia.com'

    const templateVars = {
      first_name: firstName,
      heading: content.heading,
      body_text: content.bodyText,
      cta_label: content.ctaLabel,
      cta_url: `${HOCKIA_BASE_URL}/complete-profile`,
      settings_url: `${HOCKIA_BASE_URL}/settings`,
    }

    // Try DB template, fall back to plain text
    let subject: string
    let emailHtml: string
    let emailText: string

    const rendered = await renderTemplate(supabase, 'onboarding_reminder', templateVars)
    if (rendered) {
      // Override subject with reminder-specific version
      subject = content.subject
      emailHtml = rendered.html
      emailText = rendered.text
      logger.info('Using DB template for onboarding_reminder', { reminderNumber })
    } else {
      // Fallback: simple plain-text-ish email
      subject = content.subject
      emailHtml = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h1 style="color: #8026FA;">${content.heading}</h1>
          <p>Hi ${firstName},</p>
          <p>${content.bodyText}</p>
          <p style="text-align: center; margin: 30px 0;">
            <a href="${templateVars.cta_url}"
               style="background: #8026FA; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">
              ${content.ctaLabel}
            </a>
          </p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
          <p style="font-size: 12px; color: #999;">
            If you didn't create this account, you can safely ignore this email.
          </p>
        </div>
      `
      emailText = `${content.heading}\n\nHi ${firstName},\n\n${content.bodyText}\n\n${content.ctaLabel}: ${templateVars.cta_url}\n\nIf you didn't create this account, you can safely ignore this email.`
      logger.info('Falling back to hardcoded template', { reminderNumber })
    }

    // =========================================================================
    // Send tracked email
    // =========================================================================

    const result = await sendTrackedEmail({
      supabase,
      resendApiKey,
      to: recipient.email,
      subject,
      html: emailHtml,
      text: emailText,
      templateKey: 'onboarding_reminder',
      recipientId: recipient.id,
      logger,
    })

    // Mark queue row as processed regardless of email success
    await markQueueProcessed(supabase, queueRecord.id, logger)

    if (!result.success) {
      logger.error('Failed to send onboarding reminder email', { error: result.error, reminderNumber })
      return new Response(
        JSON.stringify({ error: 'Failed to send email', details: result.error }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    logger.info('=== Onboarding reminder email sent successfully ===', {
      recipient: recipient.email,
      subject,
      reminderNumber,
      resendEmailId: result.resendEmailId,
    })

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Onboarding reminder email sent',
        recipient: recipient.email,
        reminderNumber,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error('Unhandled error', { error: errorMessage })
    captureException(error, { functionName: 'notify-onboarding-reminder', correlationId })
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

// =============================================================================
// Helpers
// =============================================================================

/**
 * Mark a queue row as processed (audit trail).
 */
async function markQueueProcessed(
  supabase: any,
  queueId: string,
  logger: { error: (msg: string, meta?: Record<string, unknown>) => void }
): Promise<void> {
  const { error } = await supabase
    .from('onboarding_reminder_queue')
    .update({ processed_at: new Date().toISOString() })
    .eq('id', queueId)

  if (error) {
    logger.error('Failed to mark queue row as processed', {
      queueId,
      error: error.message,
    })
  }
}
