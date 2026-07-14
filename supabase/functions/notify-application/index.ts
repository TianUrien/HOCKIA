// deno-lint-ignore-file no-explicit-any
import { getServiceClient } from '../_shared/supabase-client.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { captureException } from '../_shared/sentry.ts'
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
 * REAL MODE Application Notification Edge Function
 * ============================================================================
 * 
 * ISOLATION: This function handles PRODUCTION traffic only.
 * 
 * Purpose:
 * - Sends application notification emails to REAL clubs
 * - Triggered when a player applies to a vacancy
 * - Notifies the club that owns the vacancy
 * - Uses identical email template as test mode
 * 
 * Safety guarantees:
 * 1. Only processes applications where the applicant is NOT a test account
 * 2. Only sends to clubs that are NOT test accounts
 * 3. Test accounts will NEVER be processed by this function
 * 
 * Webhook configuration:
 * - Create a webhook pointing to this function
 * - Trigger on: INSERT on opportunity_applications table
 * - This function will filter out test accounts
 * 
 * The TEST mode function (notify-test-application) handles test traffic.
 * ============================================================================
 */

/** Mirrors public.profile_is_hidden(is_blocked, frozen_minor_at). */
function isHidden(p: { is_blocked?: boolean | null; frozen_minor_at?: string | null }): boolean {
  return Boolean(p.is_blocked) || Boolean(p.frozen_minor_at)
}

Deno.serve(async (req: Request) => {
  const correlationId = crypto.randomUUID().slice(0, 8)
  const logger = createLogger('NOTIFY_APPLICATION', correlationId)

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    logger.info('=== REAL MODE: Received webhook request ===')

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

    // Service role client (shared singleton)
    const supabase = getServiceClient()

    // ==========================================================================
    // TRUST THE DATABASE, NOT THE PAYLOAD (2026-07-14 audit — was a live P1)
    // ==========================================================================
    // This function used to compose the email straight from payload.record.
    // But `verify_jwt` is NOT a security boundary here: the anon key is public
    // (it ships inside every browser bundle), so ANY caller could POST a forged
    // "INSERT" naming a real opportunity + a real player and make the club
    // receive "New application from <that player>" for an application that
    // never happened — repeatable, no rate limit.
    //
    // Fix: the payload is now only a POINTER. We re-read the application row
    // from the database and use ITS values for everything downstream; a row
    // that doesn't exist means there is nothing to notify about.
    const claimedId = payload.record?.id
    if (!claimedId) {
      logger.info('Ignoring payload without an application id')
      return new Response(
        JSON.stringify({ message: 'Ignored - no application id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: application, error: applicationError } = await supabase
      .from('opportunity_applications')
      .select('id, opportunity_id, applicant_id, status')
      .eq('id', claimedId)
      .maybeSingle()

    if (applicationError) {
      logger.error('Failed to fetch application', { error: applicationError.message })
      return new Response(
        JSON.stringify({ error: 'Failed to fetch application' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!application) {
      // Either a forged payload or a row deleted before we got here. Neither
      // is a server error — refuse quietly (and loudly in the logs).
      logger.error('Rejected: no such application row — payload not backed by the DB', {
        claimedApplicationId: claimedId,
      })
      return new Response(
        JSON.stringify({ error: 'Unknown application' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    logger.info('New application detected (DB-verified)', {
      applicationId: application.id,
      opportunityId: application.opportunity_id,
      applicantId: application.applicant_id,
      status: application.status,
    })

    // Only the initial pending application warrants a "new application" email.
    // At INSERT the status is always 'pending'; a webhook re-delivery arriving
    // after the applicant withdrew or the club decided must not re-send.
    if (application.status !== 'pending') {
      logger.info('Ignoring application that is no longer pending', {
        applicationId: application.id,
        status: application.status,
      })
      return new Response(
        JSON.stringify({ message: 'Ignored - application not pending' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

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
      .select('id, username, full_name, position, secondary_position, base_location, avatar_url, is_test_account, is_blocked, frozen_minor_at')
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

    // ==========================================================================
    // CRITICAL SAFETY CHECK: Skip TEST accounts
    // This ensures REAL MODE never processes test accounts
    // ==========================================================================
    if (applicant.is_test_account) {
      logger.info('Ignoring application from TEST applicant (correct behavior)', { 
        applicantId: applicant.id,
        isTestAccount: true 
      })
      return new Response(
        JSON.stringify({ message: 'Ignored - applicant is a test account' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Hidden-profile invariant (CLAUDE.md): service-role reads that surface
    // PEOPLE carry the predicate themselves — RLS never runs here. A banned or
    // frozen applicant must never be named in a club's inbox.
    if (isHidden(applicant)) {
      logger.info('Ignoring application from hidden (banned/frozen) applicant', {
        applicantId: applicant.id,
      })
      return new Response(
        JSON.stringify({ message: 'Ignored - applicant is hidden' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Fetch the club profile (recipient)
    const { data: club, error: clubError } = await supabase
      .from('profiles')
      .select('id, email, full_name, is_test_account, onboarding_completed, notify_applications, is_blocked, frozen_minor_at')
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
      isTestAccount: club.is_test_account,
      notifyApplications: club.notify_applications
    })

    // ==========================================================================
    // CRITICAL SAFETY CHECK: Skip TEST club accounts
    // This ensures REAL MODE never sends to test clubs
    // ==========================================================================
    if (club.is_test_account) {
      logger.info('Ignoring application to TEST club (correct behavior)', { 
        clubId: club.id,
        isTestAccount: true 
      })
      return new Response(
        JSON.stringify({ message: 'Ignored - club is a test account' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // A banned / frozen club is never emailed (same invariant as the digest).
    if (isHidden(club)) {
      logger.info('Ignoring application to hidden (banned/frozen) club', { clubId: club.id })
      return new Response(
        JSON.stringify({ message: 'Ignored - club is hidden' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ==========================================================================
    // SAFETY CHECK: Skip clubs that haven't completed onboarding or have no email
    // ==========================================================================
    if (!club.onboarding_completed) {
      logger.info('Ignoring - club has not completed onboarding', { clubId: club.id })
      return new Response(
        JSON.stringify({ message: 'Ignored - club has not completed onboarding' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!club.email) {
      logger.info('Ignoring - club has no email address', { clubId: club.id })
      return new Response(
        JSON.stringify({ message: 'Ignored - club has no email address' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ==========================================================================
    // CHECK NOTIFICATION PREFERENCE
    // Respect the club's notification preferences
    // ==========================================================================
    if (club.notify_applications === false) {
      logger.info('Club has disabled application notifications', { 
        clubId: club.id,
        notifyApplications: false
      })
      return new Response(
        JSON.stringify({ message: 'Ignored - club has disabled application notifications' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ==========================================================================
    // IDEMPOTENCY (house pattern — mirrors notify-vacancy's metadata guard)
    // ==========================================================================
    // Supabase DB webhooks are at-least-once: a re-delivered INSERT would have
    // emailed the club twice. Keyed on the application id we stamp onto
    // email_sends.metadata below.
    const { count: alreadySentCount } = await supabase
      .from('email_sends')
      .select('id', { count: 'exact', head: true })
      .eq('template_key', 'application_notification')
      .eq('status', 'sent')
      .eq('metadata->>application_id', application.id)

    if (alreadySentCount && alreadySentCount > 0) {
      logger.info('Idempotency guard: application notification already sent', {
        applicationId: application.id,
        existingSendCount: alreadySentCount,
      })
      return new Response(
        JSON.stringify({ message: 'Duplicate webhook — notification already sent' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    logger.info('Both applicant and club are REAL accounts - proceeding with email')

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
      logger.info('Using DB template for application_notification')
    } else {
      emailHtml = generateEmailHtml(applicant as ApplicantData, opportunity as OpportunityData)
      emailText = generateEmailText(applicant as ApplicantData, opportunity as OpportunityData)
      subject = `New application for "${opportunity.title}"`
      logger.info('Falling back to hardcoded template')
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
      metadata: { application_id: application.id, opportunity_id: opportunity.id },
      logger,
    })

    if (!result.success) {
      logger.error('Failed to send email', { error: result.error })
      return new Response(
        JSON.stringify({ error: 'Failed to send email', details: result.error }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    logger.info('=== REAL MODE: Email sent successfully ===', {
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
    captureException(error, { functionName: 'notify-application', correlationId })
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
