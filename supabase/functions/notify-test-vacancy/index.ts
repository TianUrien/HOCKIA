// deno-lint-ignore-file no-explicit-any
// NOTE: This file runs on Supabase Edge Functions (Deno runtime).
// Some TS tooling in the workspace may not include Deno types, so we declare a minimal Deno shape.
declare const Deno: {
  env: { get(key: string): string | undefined }
  serve: (handler: (req: Request) => Response | Promise<Response>) => void
}

import { getServiceClient } from '../_shared/supabase-client.ts'
import { captureException } from '../_shared/sentry.ts'
import { corsHeaders } from '../_shared/cors.ts'
import {
  VacancyPayload,
  createLogger,
  generateEmailHtml,
  generateEmailText,
  sendEmailsIndividually,
  isVacancyNewlyPublished,
} from '../_shared/vacancy-email.ts'
import { renderTemplate } from '../_shared/email-renderer.ts'
import { sendTrackedBatch } from '../_shared/email-sender.ts'

/**
 * ============================================================================
 * TEST MODE Vacancy Notification Edge Function
 * ============================================================================
 * 
 * ISOLATION: This function is COMPLETELY ISOLATED from production traffic.
 * 
 * Purpose:
 * - Sends vacancy notification emails ONLY to hardcoded test recipients
 * - Triggered ONLY by vacancies from test accounts (is_test_account = true)
 * - Uses identical email template as production (same subject, HTML, sender)
 * 
 * Safety guarantees:
 * 1. Recipients are HARDCODED - no database lookup for recipients
 * 2. Only processes vacancies from test accounts
 * 3. Real users will NEVER receive emails from this function
 * 
 * Webhook configuration:
 * - Create a separate webhook pointing to this function
 * - Trigger on: INSERT, UPDATE on vacancies table
 * - This function will filter for test accounts only
 * 
 * The REAL mode function (notify-vacancy) handles production traffic.
 * ============================================================================
 */

// =============================================================================
// TEST RECIPIENTS (via env) - ONLY these emails will ever receive notifications
// =============================================================================
// Configure in Supabase Dashboard → Functions → notify-test-vacancy → Settings
// Example: TEST_NOTIFICATION_RECIPIENTS="a@example.com,b@example.com"
const TEST_RECIPIENTS = (Deno.env.get('TEST_NOTIFICATION_RECIPIENTS') ?? '')
  .split(',')
  .map((s: string) => s.trim().toLowerCase())
  .filter(Boolean)

interface ClubProfile {
  id: string
  full_name: string | null
  is_test_account: boolean
}

Deno.serve(async (req: Request) => {
  const correlationId = crypto.randomUUID().slice(0, 8)
  const logger = createLogger('NOTIFY_TEST_VACANCY', correlationId)

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    logger.info('=== TEST MODE: Received webhook request ===')

    if (TEST_RECIPIENTS.length === 0) {
      logger.error('TEST_NOTIFICATION_RECIPIENTS is not configured')
      return new Response(
        JSON.stringify({ error: 'TEST_NOTIFICATION_RECIPIENTS is not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get environment variables
    const resendApiKey = Deno.env.get('RESEND_API_KEY')

    if (!resendApiKey) {
      logger.error('RESEND_API_KEY not configured')
      return new Response(
        JSON.stringify({ error: 'RESEND_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Parse the webhook payload
    const payload: VacancyPayload = await req.json()
    logger.info('Parsed payload', { 
      type: payload.type, 
      table: payload.table,
      vacancyId: payload.record?.id,
      clubId: payload.record?.club_id 
    })

    // Validate this is an opportunity event
    if (payload.table !== 'opportunities') {
      logger.info('Ignoring non-opportunity event')
      return new Response(
        JSON.stringify({ message: 'Ignored - not a vacancy event' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check if vacancy was newly published using shared utility
    const vacancy = payload.record
    if (!isVacancyNewlyPublished(payload)) {
      logger.info('Ignoring - vacancy not newly published', { 
        type: payload.type,
        currentStatus: vacancy.status,
        previousStatus: payload.old_record?.status 
      })
      return new Response(
        JSON.stringify({ message: 'Ignored - vacancy not newly published' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    logger.info('Vacancy newly published', {
      type: payload.type,
      vacancyId: vacancy.id,
      status: vacancy.status,
      previousStatus: payload.old_record?.status
    })

    // Service role client (shared singleton)
    const supabase = getServiceClient()

    // Fetch the club profile to check is_test_account
    const { data: clubProfile, error: profileError } = await supabase
      .from('profiles')
      .select('id, full_name, is_test_account')
      .eq('id', vacancy.club_id)
      .single()

    if (profileError || !clubProfile) {
      logger.error('Failed to fetch club profile', { error: profileError?.message })
      return new Response(
        JSON.stringify({ error: 'Failed to fetch club profile' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ==========================================================================
    // CRITICAL SAFETY CHECK: Only process TEST accounts
    // This ensures TEST MODE never affects real users
    // ==========================================================================
    if (!clubProfile.is_test_account) {
      logger.info('Ignoring vacancy from NON-TEST account (correct behavior)', { 
        clubId: vacancy.club_id,
        isTestAccount: false 
      })
      return new Response(
        JSON.stringify({ message: 'Ignored - club is not a test account' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    logger.info('Processing TEST vacancy notification', {
      vacancyId: vacancy.id,
      vacancyTitle: vacancy.title,
      clubName: clubProfile.full_name,
      isTestAccount: true,
      recipients: TEST_RECIPIENTS,
    })

    // Generate email content (using shared template - identical to production)
    const clubName = clubProfile.full_name || 'Unknown Club'
    const HOCKIA_BASE_URL = Deno.env.get('PUBLIC_SITE_URL') ?? 'https://inhockia.com'

    const templateVars = {
      club_name: clubName,
      vacancy_title: vacancy.title || 'Untitled',
      position: vacancy.position || '',
      location: vacancy.location || '',
      summary: vacancy.description?.slice(0, 200) || '',
      cta_url: `${HOCKIA_BASE_URL}/opportunities/${vacancy.id}`,
      settings_url: `${HOCKIA_BASE_URL}/settings`,
    }

    // Try DB template, fall back to hardcoded
    let subject: string
    let html: string
    let text: string

    const rendered = await renderTemplate(supabase, 'vacancy_notification', templateVars)
    if (rendered) {
      subject = rendered.subject
      html = rendered.html
      text = rendered.text
      logger.info('Using DB template for vacancy_notification (test mode)')
    } else {
      subject = `New opportunity on HOCKIA: ${vacancy.title}`
      html = generateEmailHtml(vacancy, clubName)
      text = generateEmailText(vacancy, clubName)
      logger.info('Falling back to hardcoded template (test mode)')
    }

    // ==========================================================================
    // SEND TO HARDCODED TEST RECIPIENTS ONLY
    // These are the only recipients that will ever receive emails from TEST MODE
    // ==========================================================================
    const recipients = TEST_RECIPIENTS.map(email => ({ email }))
    const emailResult = await sendTrackedBatch({
      supabase,
      resendApiKey,
      recipients,
      subject,
      html,
      text,
      templateKey: 'vacancy_notification',
      logger,
    })

    if (!emailResult.success) {
      logger.warn('Some test emails failed to send', {
        sent: emailResult.sent,
        failed: emailResult.failed
      })
    }

    logger.info('=== TEST MODE: Notification completed ===', {
      vacancyId: vacancy.id,
      sent: emailResult.sent,
      failed: emailResult.failed,
    })

    return new Response(
      JSON.stringify({
        success: true,
        mode: 'TEST',
        message: 'Test notifications sent',
        sent: emailResult.sent,
        failed: emailResult.failed,
        vacancyId: vacancy.id,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error('Unexpected error', { error: errorMessage })
    captureException(error, { functionName: 'notify-test-vacancy', correlationId })
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
