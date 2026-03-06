// deno-lint-ignore-file no-explicit-any
// NOTE: This file runs on Supabase Edge Functions (Deno runtime).
// Some TS tooling in the workspace may not include Deno types, so we declare a minimal Deno shape.
declare const Deno: {
  env: { get(key: string): string | undefined }
  serve: (handler: (req: Request) => Response | Promise<Response>) => void
}

import { getServiceClient } from '../_shared/supabase-client.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { captureException } from '../_shared/sentry.ts'
import {
  VacancyPayload,
  VacancyRecord,
  createLogger,
  generateEmailHtml,
  generateEmailText,
  sendEmailsIndividually,
  isVacancyNewlyPublished,
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
  supabase: any,
  vacancy: VacancyRecord,
  logger: ReturnType<typeof createLogger>
): Promise<RecipientInfo[]> {
  const targetRole = vacancy.opportunity_type // 'player' or 'coach'

  logger.info('Fetching eligible recipients (paginated)', {
    targetRole,
    vacancyId: vacancy.id,
    pageSize: RECIPIENT_PAGE_SIZE,
  })

  const eligible: RecipientInfo[] = []
  let offset = 0
  let hasMore = true

  while (hasMore) {
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, email, full_name, role, countries!profiles_nationality_country_id_fkey(code, name), is_test_account, notify_opportunities')
      .eq('role', targetRole)
      .eq('is_test_account', false)
      .eq('onboarding_completed', true)
      .eq('notify_opportunities', true)
      .not('email', 'is', null)
      .order('id', { ascending: true })
      .range(offset, offset + RECIPIENT_PAGE_SIZE - 1)

    if (error) {
      logger.error('Failed to fetch recipient profiles', { error: error.message, offset })
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

  return eligible
}

Deno.serve(async (req: Request) => {
  const correlationId = crypto.randomUUID().slice(0, 8)
  const logger = createLogger('NOTIFY_VACANCY', correlationId)

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

    logger.info('Processing REAL vacancy notification', {
      vacancyId: vacancy.id,
      vacancyTitle: vacancy.title,
      clubName: clubProfile.full_name,
      opportunityType: vacancy.opportunity_type,
      isTestAccount: false,
    })

    // ==========================================================================
    // IDEMPOTENCY CHECK: Prevent duplicate sends from webhook double-delivery
    // If we already sent vacancy_notification emails for this vacancy in the
    // last 10 minutes, skip to avoid spamming recipients.
    // ==========================================================================
    const { count: alreadySentCount } = await supabase
      .from('email_sends')
      .select('id', { count: 'exact', head: true })
      .eq('template_key', 'vacancy_notification')
      .eq('status', 'sent')
      .gte('sent_at', new Date(Date.now() - 10 * 60 * 1000).toISOString())
      .ilike('subject', `%${vacancy.title}%`)

    if (alreadySentCount && alreadySentCount > 0) {
      logger.info('Idempotency guard: vacancy notification already sent recently', {
        vacancyId: vacancy.id,
        vacancyTitle: vacancy.title,
        existingSendCount: alreadySentCount,
      })
      return new Response(
        JSON.stringify({
          success: true,
          mode: 'REAL',
          message: 'Duplicate webhook — notification already sent',
          vacancyId: vacancy.id,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Fetch eligible recipients based on vacancy type
    const recipients = await fetchEligibleRecipients(supabase, vacancy, logger)

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

    const PLAYR_BASE_URL = Deno.env.get('PUBLIC_SITE_URL') ?? 'https://oplayr.com'

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
      cta_url: `${PLAYR_BASE_URL}/opportunities/${vacancy.id}`,
      settings_url: `${PLAYR_BASE_URL}/settings`,
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
      baseSubject = `New opportunity on PLAYR: ${vacancy.title}`
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

    logger.info('=== REAL MODE: Notification completed ===', {
      vacancyId: vacancy.id,
      sentCount: emailResult.stats.sent,
      failedCount: emailResult.stats.failed,
      durationMs: emailResult.stats.durationMs,
      batchApiCalls: emailResult.stats.batchApiCalls,
    })

    return new Response(
      JSON.stringify({
        success: true,
        mode: 'REAL',
        message: 'Production notifications sent via Batch API',
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
    captureException(error, { functionName: 'notify-vacancy', correlationId })
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
