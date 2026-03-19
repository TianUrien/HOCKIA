// deno-lint-ignore-file no-explicit-any
import { getServiceClient } from '../_shared/supabase-client.ts'
import { captureException } from '../_shared/sentry.ts'
import { corsHeaders } from '../_shared/cors.ts'
import {
  ApplicationPayload,
  ApplicantData,
  OpportunityData,
  ClubData,
  createLogger,
  generateEmailHtml,
  generateEmailText,
  sendEmail,
} from '../_shared/application-email.ts'
import { renderTemplate } from '../_shared/email-renderer.ts'
import { sendTrackedEmail } from '../_shared/email-sender.ts'

/**
 * ============================================================================
 * TEST MODE Application Notification Edge Function
 * ============================================================================
 * 
 * ISOLATION: This function is COMPLETELY ISOLATED from production traffic.
 * 
 * Purpose:
 * - Sends application notification emails ONLY for test accounts
 * - Triggered when a player applies to a vacancy
 * - Notifies the club that owns the vacancy
 * - Uses identical email template as production
 * 
 * Safety guarantees:
 * 1. Only processes applications where BOTH the applicant AND club are test accounts
 * 2. Real users will NEVER receive emails from this function
 * 
 * Webhook configuration:
 * - Create a webhook pointing to this function
 * - Trigger on: INSERT on opportunity_applications table
 * - This function will filter for test accounts only
 * 
 * The REAL mode function (notify-application) handles production traffic.
 * ============================================================================
 */

Deno.serve(async (req: Request) => {
  const correlationId = crypto.randomUUID().slice(0, 8)
  const logger = createLogger('NOTIFY_TEST_APPLICATION', correlationId)

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    logger.info('=== TEST MODE: Received webhook request ===')

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
    const payload: ApplicationPayload = await req.json()
    logger.info('Parsed payload', {
      type: payload.type,
      table: payload.table,
      applicationId: payload.record?.id,
      opportunityId: payload.record?.opportunity_id,
      applicantId: payload.record?.applicant_id,
    })

    // Validate this is an opportunity_applications INSERT event
    if (payload.table !== 'opportunity_applications') {
      logger.info('Ignoring non-application event')
      return new Response(
        JSON.stringify({ message: 'Ignored - not an application event' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Only process INSERT events (new applications)
    if (payload.type !== 'INSERT') {
      logger.info('Ignoring non-INSERT event', { type: payload.type })
      return new Response(
        JSON.stringify({ message: 'Ignored - not a new application' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const application = payload.record
    logger.info('New application detected', {
      applicationId: application.id,
      opportunityId: application.opportunity_id,
      applicantId: application.applicant_id,
    })

    // Create Supabase client
    const supabase = getServiceClient()

    // Fetch the opportunity details
    const { data: opportunity, error: opportunityError } = await supabase
      .from('opportunities')
      .select('id, title, club_id')
      .eq('id', application.opportunity_id)
      .single()

    if (opportunityError || !opportunity) {
      logger.error('Failed to fetch opportunity', { error: opportunityError?.message })
      return new Response(
        JSON.stringify({ error: 'Failed to fetch opportunity' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    logger.info('Fetched opportunity', { opportunityId: opportunity.id, title: opportunity.title, clubId: opportunity.club_id })

    // Fetch the applicant profile
    const { data: applicant, error: applicantError } = await supabase
      .from('profiles')
      .select('id, username, full_name, position, secondary_position, base_location, avatar_url, is_test_account')
      .eq('id', application.applicant_id)
      .single()

    if (applicantError || !applicant) {
      logger.error('Failed to fetch applicant profile', { error: applicantError?.message })
      return new Response(
        JSON.stringify({ error: 'Failed to fetch applicant profile' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    logger.info('Fetched applicant', { 
      applicantId: applicant.id, 
      name: applicant.full_name,
      isTestAccount: applicant.is_test_account 
    })

    // Fetch the club profile (recipient)
    const { data: club, error: clubError } = await supabase
      .from('profiles')
      .select('id, email, full_name, is_test_account')
      .eq('id', opportunity.club_id)
      .single()

    if (clubError || !club) {
      logger.error('Failed to fetch club profile', { error: clubError?.message })
      return new Response(
        JSON.stringify({ error: 'Failed to fetch club profile' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    logger.info('Fetched club', { 
      clubId: club.id, 
      name: club.full_name,
      isTestAccount: club.is_test_account 
    })

    // ==========================================================================
    // CRITICAL SAFETY CHECK: Only process TEST accounts
    // Both the applicant AND the club must be test accounts
    // This ensures TEST MODE never affects real users
    // ==========================================================================
    if (!applicant.is_test_account) {
      logger.info('Ignoring application from NON-TEST applicant (correct behavior)', { 
        applicantId: applicant.id,
        isTestAccount: false 
      })
      return new Response(
        JSON.stringify({ message: 'Ignored - applicant is not a test account' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!club.is_test_account) {
      logger.info('Ignoring application to NON-TEST club (correct behavior)', { 
        clubId: club.id,
        isTestAccount: false 
      })
      return new Response(
        JSON.stringify({ message: 'Ignored - club is not a test account' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    logger.info('Both applicant and club are TEST accounts - proceeding with email')

    // Build positions string
    const positions: string[] = []
    if (applicant.position) positions.push(applicant.position.charAt(0).toUpperCase() + applicant.position.slice(1))
    if (applicant.secondary_position && applicant.secondary_position !== applicant.position) {
      positions.push(applicant.secondary_position.charAt(0).toUpperCase() + applicant.secondary_position.slice(1))
    }

    const HOCKIA_BASE_URL = Deno.env.get('PUBLIC_SITE_URL') ?? 'https://inhockia.com'
    const profileUrl = applicant.username
      ? `${HOCKIA_BASE_URL}/players/${applicant.username}`
      : `${HOCKIA_BASE_URL}/players/id/${applicant.id}`

    const templateVars = {
      opportunity_title: opportunity.title,
      applicant_name: applicant.full_name?.trim() || 'Player',
      applicant_position: positions.join(' \u2022 '),
      applicant_location: applicant.base_location?.trim() || '',
      applicant_avatar_url: applicant.avatar_url || '',
      cta_url: profileUrl,
      settings_url: `${HOCKIA_BASE_URL}/settings`,
    }

    // Try DB template, fall back to hardcoded
    let subject: string
    let emailHtml: string
    let emailText: string

    const rendered = await renderTemplate(supabase, 'application_notification', templateVars)
    if (rendered) {
      subject = rendered.subject
      emailHtml = rendered.html
      emailText = rendered.text
      logger.info('Using DB template for application_notification (test mode)')
    } else {
      emailHtml = generateEmailHtml(applicant as ApplicantData, opportunity as OpportunityData)
      emailText = generateEmailText(applicant as ApplicantData, opportunity as OpportunityData)
      subject = `New application for "${opportunity.title}"`
      logger.info('Falling back to hardcoded template (test mode)')
    }

    // Send tracked email to the club
    const result = await sendTrackedEmail({
      supabase,
      resendApiKey,
      to: club.email,
      subject,
      html: emailHtml,
      text: emailText,
      templateKey: 'application_notification',
      recipientId: club.id,
      recipientRole: 'club',
      logger,
    })

    if (!result.success) {
      logger.error('Failed to send email', { error: result.error })
      return new Response(
        JSON.stringify({ error: 'Failed to send email', details: result.error }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    logger.info('=== TEST MODE: Email sent successfully ===', {
      recipient: club.email,
      subject,
      applicantName: applicant.full_name,
      opportunityTitle: opportunity.title,
      resendEmailId: result.resendEmailId,
    })

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Application notification email sent',
        recipient: club.email,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error('Unhandled error', { error: errorMessage })
    captureException(error, { functionName: 'notify-test-application', correlationId })
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
