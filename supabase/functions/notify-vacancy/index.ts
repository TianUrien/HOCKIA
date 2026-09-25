// NOTE: This file runs on Supabase Edge Functions (Deno runtime).
// Some TS tooling in the workspace may not include Deno types, so we declare a minimal Deno shape.
declare const Deno: {
  env: { get(key: string): string | undefined }
  serve: (handler: (req: Request) => Response | Promise<Response>) => void
}

import { getServiceClient } from '../_shared/supabase-client.ts'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { Database } from '../_shared/database.types.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { assertServiceRole } from '../_shared/webhook-auth.ts'
import { captureException } from '../_shared/sentry.ts'
import {
  VacancyPayload,
  VacancyRecord,
  createLogger,
  generateEmailHtml,
  generateEmailText,
  isVacancyNewlyPublished,
  claimFirstAnnouncement,
  announcementSendOutcome,
  reportAnnouncementFailure,
} from '../_shared/vacancy-email.ts'
import { renderTemplate } from '../_shared/email-renderer.ts'
import { sendTrackedBatch, RecipientInfo } from '../_shared/email-sender.ts'

/**
 * ============================================================================
 * REAL MODE Vacancy Notification Edge Function
 * ============================================================================
 * 
 * ISOLATION: This function is COMPLETELY ISOLATED from test traffic.
 * 
 * Purpose:
 * - Sends vacancy notification emails to REAL users (players/coaches)
 * - Triggered ONLY by vacancies from REAL accounts (is_test_account = false)
 * - Matches vacancy opportunity_type to user role (player/coach)
 * 
 * Safety guarantees:
 * 1. Only processes vacancies from NON-test accounts
 * 2. Never sends to test recipients or test accounts
 * 3. Only sends when vacancy is newly published (status becomes 'open')
 *    AND it has never been announced before (first publish only; reopen and
 *    renewal never re-send — see claimFirstAnnouncement)
 * 4. Recipients are queried from database based on role matching
 * 
 * Webhook configuration:
 * - Create a separate webhook pointing to this function
 * - Trigger on: INSERT, UPDATE on vacancies table
 * - This function will filter for real accounts only
 * 
 * The TEST mode function (notify-test-vacancy) handles test traffic.
 * ============================================================================
 */

// =============================================================================
// BLOCKED RECIPIENTS (via env) - These should NEVER receive production emails
// =============================================================================
// Example: BLOCKED_NOTIFICATION_RECIPIENTS="a@example.com,b@example.com"
const BLOCKED_TEST_RECIPIENTS = (Deno.env.get('BLOCKED_NOTIFICATION_RECIPIENTS') ?? '')
  .split(',')
  .map((s: string) => s.trim().toLowerCase())
  .filter(Boolean)

interface ClubProfile {
  id: string
  full_name: string | null
  is_test_account: boolean
}

interface RecipientProfile {
  id: string
  email: string
  full_name: string | null
  role: string
  countries: { code: string; name: string } | null
  is_test_account: boolean
  notify_opportunities: boolean
}

/**
 * Page size for paginated recipient fetching.
 * Keeps each query fast and memory usage bounded.
 */
const RECIPIENT_PAGE_SIZE = 200

/**
 * Fetch eligible recipients based on vacancy opportunity type
 * - For 'player' vacancies: fetch players
 * - For 'coach' vacancies: fetch coaches
 * - Excludes test accounts
 * - Excludes users who opted out of opportunity notifications
 * - Excludes blocked test recipients
 * - Paginates to avoid timeout on large result sets
 */
async function fetchEligibleRecipients(
  supabase: SupabaseClient<Database>,
  vacancy: VacancyRecord,
  logger: ReturnType<typeof createLogger>
): Promise<{ recipients: RecipientInfo[]; error: string | null }> {
  const targetRole = vacancy.opportunity_type // 'player' or 'coach'

  logger.info('Fetching eligible recipients (paginated)', {
    targetRole,
    vacancyId: vacancy.id,
    pageSize: RECIPIENT_PAGE_SIZE,
  })

  const eligible: RecipientInfo[] = []
  let offset = 0
  let hasMore = true
  // A failed page means the audience is incomplete — surfaced to the caller
  // so the (already-claimed) announcement is reported, not silently short.
  let fetchError: string | null = null

  while (hasMore) {
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, email, full_name, role, countries!profiles_nationality_country_id_fkey(code, name), is_test_account, notify_opportunities')
      .eq('role', targetRole)
      .eq('is_test_account', false)
      .eq('onboarding_completed', true)
      .eq('notify_opportunities', true)
      // Hidden profiles (admin ban / frozen minor) never receive emails. This
      // client is service_role, so profiles RLS does NOT fence this query —
      // the filter must live here.
      .eq('is_blocked', false)
      .is('frozen_minor_at', null)
      .not('email', 'is', null)
      .order('id', { ascending: true })
      .range(offset, offset + RECIPIENT_PAGE_SIZE - 1)

    if (error) {
      logger.error('Failed to fetch recipient profiles', { error: error.message, offset })
      fetchError = error.message
      break
    }

    if (!profiles || profiles.length === 0) {
      hasMore = false
      break
    }

    const batch = (profiles as RecipientProfile[])
      .filter(p => !BLOCKED_TEST_RECIPIENTS.includes(p.email.toLowerCase()))
      .map(p => ({
        email: p.email,
        recipientId: p.id,
        recipientName: p.full_name || undefined,
        recipientRole: p.role,
        recipientCountry: p.countries?.name || undefined,
      }))

    eligible.push(...batch)

    logger.info('Fetched recipient page', {
      offset,
      pageSize: profiles.length,
      batchEmails: batch.length,
      totalSoFar: eligible.length,
    })

    offset += RECIPIENT_PAGE_SIZE
    hasMore = profiles.length === RECIPIENT_PAGE_SIZE
  }

  logger.info('Found eligible recipients', {
    totalEligible: eligible.length,
    targetRole,
    pagesQueried: Math.ceil(offset / RECIPIENT_PAGE_SIZE) || 1,
  })

  return { recipients: eligible, error: fetchError }
}

Deno.serve(async (req: Request) => {
  const correlationId = crypto.randomUUID().slice(0, 8)
  const logger = createLogger('NOTIFY_VACANCY', correlationId)

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // SECURITY (2026-08-08): `verify_jwt` only proves the caller sent *a* valid
  // Supabase JWT — and the anon key is public. Database webhooks call us with a
  // service_role token, which an attacker cannot mint. See _shared/webhook-auth.ts.
  const unauthorized = assertServiceRole(req)
  if (unauthorized) return unauthorized

  // Set once the first-announcement claim is won. From then on there is NO
  // automatic retry (a re-delivery sees 'already_announced'), so any failure
  // must be alerted as "resend manually" — see reportAnnouncementFailure.
  let claimedVacancy: VacancyRecord | null = null

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
    const payload: VacancyPayload = await req.json()
    logger.info('Parsed payload', { 
      type: payload.type, 
      table: payload.table,
      vacancyId: payload.record?.id,
      clubId: payload.record?.club_id,
      opportunityType: payload.record?.opportunity_type
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
      opportunityType: vacancy.opportunity_type,
      previousStatus: payload.old_record?.status
    })

    // Service role client (shared singleton)
    const supabase = getServiceClient()

    // Fetch the club profile to check is_test_account + hidden state
    const { data: clubProfile, error: profileError } = await supabase
      .from('profiles')
      .select('id, full_name, is_test_account, is_blocked, frozen_minor_at')
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
    // CRITICAL SAFETY CHECK: Only process REAL (non-test) accounts
    // This ensures REAL MODE never processes test vacancies
    // ==========================================================================
    if (clubProfile.is_test_account) {
      logger.info('Ignoring vacancy from TEST account (correct behavior)', {
        clubId: vacancy.club_id,
        isTestAccount: true
      })
      return new Response(
        JSON.stringify({ message: 'Ignored - club is a test account' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Hidden publishers (admin ban / frozen minor) never trigger sends. Without
    // this, a hidden publisher's listing flipping closed->open (e.g. a renewal
    // token click) would mass-email every eligible player.
    if (clubProfile.is_blocked === true || clubProfile.frozen_minor_at !== null) {
      logger.info('Ignoring vacancy from hidden publisher', { clubId: vacancy.club_id })
      return new Response(
        JSON.stringify({ message: 'Ignored - publisher profile is hidden' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    logger.info('Processing REAL vacancy notification', {
      vacancyId: vacancy.id,
      vacancyTitle: vacancy.title,
      clubName: clubProfile.full_name,
      opportunityType: vacancy.opportunity_type,
      isTestAccount: false,
    })

    // ==========================================================================
    // FIRST-PUBLISH-ONLY GUARD (founder ruling E, 2026-09-26)
    // A role is announced by email ONCE — the first time it is published.
    // Closing and reopening, renewing, or a webhook re-delivery never re-sends.
    // The old guard only looked back 10 minutes in email_sends, so a club
    // toggling closed->open every ~11 minutes re-mailed every opted-in player.
    // The claim is atomic in the DB (opportunity_first_publications), so only
    // one delivery can ever win it. Fails closed: on error, do not send.
    // ==========================================================================
    const claim = await claimFirstAnnouncement(supabase, vacancy.id)

    if (claim.outcome === 'error') {
      logger.error('Announcement claim failed - not sending', {
        vacancyId: vacancy.id,
        error: claim.message,
      })
      captureException(new Error(`notify-vacancy claim failed: ${claim.message}`), {
        functionName: 'notify-vacancy',
        correlationId,
      })
      return new Response(
        JSON.stringify({ error: 'Announcement claim failed', vacancyId: vacancy.id }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (claim.outcome === 'already_announced') {
      logger.info('Role already announced once - not re-sending (reopen/renewal/duplicate)', {
        vacancyId: vacancy.id,
        previousStatus: payload.old_record?.status,
      })
      return new Response(
        JSON.stringify({
          success: true,
          mode: 'REAL',
          message: 'Ignored - role was already announced',
          vacancyId: vacancy.id,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    claimedVacancy = vacancy

    // Fetch eligible recipients based on vacancy type
    const { recipients, error: recipientsError } = await fetchEligibleRecipients(supabase, vacancy, logger)

    if (recipients.length === 0 && recipientsError) {
      reportAnnouncementFailure(captureException, {
        opportunityId: vacancy.id,
        clubId: vacancy.club_id,
        correlationId,
        stage: 'recipients',
        cause: recipientsError,
      })
      return new Response(
        JSON.stringify({ error: 'Failed to fetch recipients', vacancyId: vacancy.id }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (recipients.length === 0) {
      logger.info('No eligible recipients found - skipping email send')
      return new Response(
        JSON.stringify({ 
          success: true, 
          mode: 'REAL',
          message: 'No eligible recipients found',
          sent: [],
          failed: [],
          vacancyId: vacancy.id,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Generate email content — try DB template first, fall back to hardcoded
    const clubName = clubProfile.full_name || 'Unknown Club'
    const position = vacancy.position
      ? vacancy.position.charAt(0).toUpperCase() + vacancy.position.slice(1)
      : ''
    const city = vacancy.location_city?.trim() || ''
    const country = vacancy.location_country?.trim() || ''
    const location = city && country ? `${city}, ${country}` : city || country || ''
    const summary = vacancy.description?.trim()?.slice(0, 200) || ''

    const HOCKIA_BASE_URL = Deno.env.get('PUBLIC_SITE_URL') ?? 'https://inhockia.com'

    // Use a sentinel placeholder for first_name so we can personalize per-recipient.
    // The template will render "Hi __FIRST_NAME__," and we replace it per-recipient.
    const FIRST_NAME_SENTINEL = '__FIRST_NAME_SENTINEL__'
    const templateVars = {
      vacancy_title: vacancy.title,
      club_name: clubName,
      position,
      location,
      summary,
      first_name: FIRST_NAME_SENTINEL,
      cta_url: `${HOCKIA_BASE_URL}/opportunities/${vacancy.id}`,
      settings_url: `${HOCKIA_BASE_URL}/settings`,
    }

    let baseSubject: string
    let baseHtml: string
    let baseText: string

    const rendered = await renderTemplate(supabase, 'vacancy_notification', templateVars)
    if (rendered) {
      baseSubject = rendered.subject
      baseHtml = rendered.html
      baseText = rendered.text
      logger.info('Using DB template for vacancy_notification')
    } else {
      baseSubject = `New opportunity on HOCKIA: ${vacancy.title}`
      baseHtml = generateEmailHtml(vacancy, clubName)
      baseText = generateEmailText(vacancy, clubName)
      logger.info('Falling back to hardcoded template')
    }

    // ==========================================================================
    // SEND TO REAL USERS ONLY with tracking
    // Per-recipient personalization: each email gets a unique greeting with the
    // recipient's first name. This makes each email's HTML unique, which prevents
    // Gmail from fingerprinting identical content and routing to Promotions.
    // ==========================================================================
    logger.info('Sending to real recipients (personalized)', {
      recipientCount: recipients.length,
      opportunityType: vacancy.opportunity_type
    })

    const emailResult = await sendTrackedBatch({
      supabase,
      resendApiKey,
      recipients,
      subject: baseSubject,
      html: baseHtml,
      text: baseText,
      templateKey: 'vacancy_notification',
      logger,
      // Stamp the vacancy id on every success row (audit / analytics).
      metadata: { vacancy_id: vacancy.id },
      renderForRecipient: (r: RecipientInfo) => {
        const firstName = r.recipientName
          ? r.recipientName.split(' ')[0]
          : ''
        const personalizedHtml = baseHtml.replace(FIRST_NAME_SENTINEL, firstName)
        const personalizedText = baseText.replace(FIRST_NAME_SENTINEL, firstName)
        return {
          html: personalizedHtml,
          text: personalizedText,
          subject: baseSubject,
        }
      },
    })

    if (!emailResult.success) {
      logger.warn('Some emails failed to send', {
        sent: emailResult.sent.length,
        failed: emailResult.failed.length,
        failedEmails: emailResult.failed.slice(0, 10),
      })
    }

    const outcome = announcementSendOutcome(emailResult.stats, recipientsError)
    if (outcome !== 'ok') {
      reportAnnouncementFailure(captureException, {
        opportunityId: vacancy.id,
        clubId: vacancy.club_id,
        correlationId,
        stage: emailResult.stats.failed > 0 ? 'send' : 'recipients',
        sent: emailResult.stats.sent,
        failed: emailResult.stats.failed,
        totalRecipients: emailResult.stats.totalRecipients,
        cause: recipientsError ?? `${emailResult.stats.failed} Resend send(s) failed`,
      })
    }

    logger.info('=== REAL MODE: Notification completed ===', {
      vacancyId: vacancy.id,
      sentCount: emailResult.stats.sent,
      failedCount: emailResult.stats.failed,
      durationMs: emailResult.stats.durationMs,
      batchApiCalls: emailResult.stats.batchApiCalls,
    })

    return new Response(
      JSON.stringify({
        success: outcome === 'ok',
        mode: 'REAL',
        message: 'Production notifications sent via Batch API',
        announcementOutcome: outcome,
        sentCount: emailResult.stats.sent,
        failedCount: emailResult.stats.failed,
        stats: emailResult.stats,
        vacancyId: vacancy.id,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error('Unexpected error', { error: errorMessage })
    if (claimedVacancy) {
      // Claimed but not (fully) sent, and nothing will retry it.
      reportAnnouncementFailure(captureException, {
        opportunityId: claimedVacancy.id,
        clubId: claimedVacancy.club_id,
        correlationId,
        stage: 'exception',
        cause: errorMessage,
      })
    } else {
      captureException(error, { functionName: 'notify-vacancy', correlationId })
    }
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
