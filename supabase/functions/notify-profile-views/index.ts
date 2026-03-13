// deno-lint-ignore-file no-explicit-any
import { getServiceClient } from '../_shared/supabase-client.ts'
import { captureException } from '../_shared/sentry.ts'
import { corsHeaders } from '../_shared/cors.ts'
import {
  ProfileViewWebhookPayload,
  RecipientData,
  ViewerProfile,
  generateEmailHtml,
  generateEmailText,
} from '../_shared/profile-views-email.ts'
import { renderTemplate } from '../_shared/email-renderer.ts'
import { sendTrackedEmail, createLogger } from '../_shared/email-sender.ts'

/**
 * ============================================================================
 * Profile View Digest Email Edge Function
 * ============================================================================
 *
 * Purpose:
 * - Sends a daily digest email summarising who viewed the user's profile
 * - Triggered by database webhook on INSERT to profile_view_email_queue
 * - pg_cron runs enqueue_profile_view_emails() daily at 4:00 AM UTC
 *
 * Safety guarantees:
 * 1. Only processes real accounts (is_test_account = false)
 * 2. Respects notify_profile_views preference
 * 3. EMAIL_ALLOWED_RECIPIENTS whitelist for staging safety
 *
 * Webhook configuration:
 * - Trigger on: INSERT on profile_view_email_queue table
 * ============================================================================
 */

Deno.serve(async (req: Request) => {
  const correlationId = crypto.randomUUID().slice(0, 8)
  const logger = createLogger('NOTIFY_PROFILE_VIEWS', correlationId)

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
    const payload: ProfileViewWebhookPayload = await req.json()
    logger.info('Parsed payload', {
      type: payload.type,
      table: payload.table,
      queueId: payload.record?.id,
      recipientId: payload.record?.recipient_id,
      uniqueViewers: payload.record?.unique_viewers,
    })

    // Only process profile_view_email_queue events
    if (payload.table !== 'profile_view_email_queue') {
      logger.info('Ignoring non-queue event')
      return new Response(
        JSON.stringify({ message: 'Ignored - not a profile view email queue event' }),
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

    // Fetch recipient profile
    const { data: recipient, error: recipientError } = await supabase
      .from('profiles')
      .select('id, email, full_name, is_test_account, onboarding_completed, notify_profile_views')
      .eq('id', queueRecord.recipient_id)
      .single()

    if (recipientError || !recipient) {
      logger.error('Failed to fetch recipient profile', { error: recipientError?.message })
      return new Response(
        JSON.stringify({ error: 'Failed to fetch recipient profile' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    logger.info('Fetched recipient', {
      recipientId: recipient.id,
      name: recipient.full_name,
      isTestAccount: recipient.is_test_account,
      notifyProfileViews: recipient.notify_profile_views,
    })

    // Safety check: skip test accounts
    if (recipient.is_test_account) {
      logger.info('Ignoring digest for test account', { recipientId: recipient.id })
      await markQueueProcessed(supabase, queueRecord.id, logger)
      return new Response(
        JSON.stringify({ message: 'Ignored - recipient is a test account' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Skip recipients who haven't completed onboarding or have no email
    if (!recipient.onboarding_completed) {
      logger.info('Ignoring digest - recipient has not completed onboarding', { recipientId: recipient.id })
      await markQueueProcessed(supabase, queueRecord.id, logger)
      return new Response(
        JSON.stringify({ message: 'Ignored - recipient has not completed onboarding' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!recipient.email) {
      logger.info('Ignoring digest - recipient has no email address', { recipientId: recipient.id })
      await markQueueProcessed(supabase, queueRecord.id, logger)
      return new Response(
        JSON.stringify({ message: 'Ignored - recipient has no email address' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check notification preference
    if (recipient.notify_profile_views === false) {
      logger.info('Recipient has disabled profile view digest emails', { recipientId: recipient.id })
      await markQueueProcessed(supabase, queueRecord.id, logger)
      return new Response(
        JSON.stringify({ message: 'Ignored - recipient disabled profile view digests' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Fetch top viewer profiles
    let viewers: ViewerProfile[] = []
    if (queueRecord.top_viewer_ids && queueRecord.top_viewer_ids.length > 0) {
      const { data: viewerProfiles, error: viewerError } = await supabase
        .from('profiles')
        .select('id, full_name, role, avatar_url, base_location')
        .in('id', queueRecord.top_viewer_ids)

      if (viewerError) {
        logger.error('Failed to fetch viewer profiles', { error: viewerError.message })
      } else if (viewerProfiles) {
        // Preserve order from top_viewer_ids
        const viewerMap = new Map<string, ViewerProfile>()
        for (const vp of viewerProfiles) {
          viewerMap.set(vp.id, vp as ViewerProfile)
        }
        viewers = queueRecord.top_viewer_ids
          .map(id => viewerMap.get(id))
          .filter((v): v is ViewerProfile => v !== undefined)
      }
    }

    logger.info('Fetched viewer profiles', { count: viewers.length })

    const stats = {
      uniqueViewers: queueRecord.unique_viewers,
      totalViews: queueRecord.total_views,
      anonymousViewers: queueRecord.anonymous_viewers,
    }

    const firstName = recipient.full_name?.split(' ')[0]?.trim() || 'there'
    const PLAYR_BASE_URL = Deno.env.get('PUBLIC_SITE_URL') ?? 'https://oplayr.com'

    const templateVars = {
      first_name: firstName,
      view_count: stats.uniqueViewers === 1
        ? '1 person'
        : `${stats.uniqueViewers} people`,
      unique_viewers: String(stats.uniqueViewers),
      total_views: String(stats.totalViews),
      anonymous_viewers: String(stats.anonymousViewers),
      cta_url: `${PLAYR_BASE_URL}/dashboard/profile?tab=profile&section=viewers`,
      cta_label: 'See Who Viewed Your Profile',
      settings_url: `${PLAYR_BASE_URL}/settings`,
    }

    // Try DB template, fall back to hardcoded
    let subject: string
    let emailHtml: string
    let emailText: string

    const rendered = await renderTemplate(supabase, 'profile_view_digest', templateVars)
    if (rendered) {
      subject = rendered.subject
      emailHtml = rendered.html
      emailText = rendered.text
      logger.info('Using DB template for profile_view_digest')
    } else {
      emailHtml = generateEmailHtml(recipient as RecipientData, viewers, stats)
      emailText = generateEmailText(recipient as RecipientData, viewers, stats)
      subject = stats.uniqueViewers === 1
        ? 'Someone viewed your PLAYR profile'
        : `${stats.uniqueViewers} people viewed your PLAYR profile`
      logger.info('Falling back to hardcoded template')
    }

    // Send tracked email
    const result = await sendTrackedEmail({
      supabase,
      resendApiKey,
      to: recipient.email,
      subject,
      html: emailHtml,
      text: emailText,
      templateKey: 'profile_view_digest',
      recipientId: recipient.id,
      logger,
    })

    // Mark queue row as processed regardless of email success
    await markQueueProcessed(supabase, queueRecord.id, logger)

    if (!result.success) {
      logger.error('Failed to send profile view digest email', { error: result.error })
      return new Response(
        JSON.stringify({ error: 'Failed to send email', details: result.error }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    logger.info('=== Profile view digest email sent successfully ===', {
      recipient: recipient.email,
      subject,
      uniqueViewers: stats.uniqueViewers,
      resendEmailId: result.resendEmailId,
    })

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Profile view digest email sent',
        recipient: recipient.email,
        uniqueViewers: stats.uniqueViewers,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error('Unhandled error', { error: errorMessage })
    captureException(error, { functionName: 'notify-profile-views', correlationId })
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

/**
 * Mark a queue row as processed (audit trail).
 */
async function markQueueProcessed(
  supabase: any,
  queueId: string,
  logger: { error: (msg: string, meta?: Record<string, unknown>) => void }
): Promise<void> {
  const { error } = await supabase
    .from('profile_view_email_queue')
    .update({ processed_at: new Date().toISOString() })
    .eq('id', queueId)

  if (error) {
    logger.error('Failed to mark queue row as processed', {
      queueId,
      error: error.message,
    })
  }
}
