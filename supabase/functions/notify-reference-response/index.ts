// deno-lint-ignore-file no-explicit-any
import { getServiceClient } from '../_shared/supabase-client.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { captureException } from '../_shared/sentry.ts'
import {
  ReferenceResponsePayload,
  EndorserData,
  RecipientData,
  buildEndorserProfileUrl,
  createLogger,
  generateAcceptedEmailHtml,
  generateAcceptedEmailText,
} from '../_shared/reference-response-email.ts'
import { renderTemplate } from '../_shared/email-renderer.ts'
import { sendTrackedEmail } from '../_shared/email-sender.ts'

/**
 * ============================================================================
 * Reference Response Notification Edge Function
 * ============================================================================
 *
 * Purpose:
 * - Sends email notification when a reference REQUEST is accepted.
 * - Triggered on UPDATE to profile_references where status transitions
 *   pending → accepted.
 * - Notifies the original requester (the person who asked) that their ask
 *   was answered with a yes.
 *
 * Decline path is intentionally in-app only — declines are sensitive and
 * an email arriving "X declined to write a reference for you" is the kind
 * of nudge a user can do without. The in-app notification (config.ts kind
 * `reference_request_rejected`) already covers it.
 *
 * Safety guarantees:
 * 1. Checks is_test_account on BOTH endorser (the person who accepted)
 *    and recipient (the original requester).
 * 2. Respects recipient.notify_references preference.
 * 3. Only processes UPDATE events where the transition is pending → accepted.
 * 4. Idempotent against re-firing — if status is already accepted before
 *    the webhook arrives (manual replay, double-fire, etc.) the function
 *    returns 200 with a "no-op" message rather than re-sending.
 *
 * Webhook configuration (Supabase dashboard, Database Webhooks):
 *   - Trigger on: UPDATE on profile_references
 *   - HTTP method: POST
 *   - URL: https://<project>.supabase.co/functions/v1/notify-reference-response
 *   - Auth: Bearer <service_role_key>
 *   - HTTP filter: status_old = 'pending' AND status_new = 'accepted'
 *     (or omit and let this function filter — both work; the function-level
 *     filter is the source of truth.)
 * ============================================================================
 */

Deno.serve(async (req: Request) => {
  const correlationId = crypto.randomUUID().slice(0, 8)
  const logger = createLogger('NOTIFY_REFERENCE_RESPONSE', correlationId)

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
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const payload: ReferenceResponsePayload = await req.json()
    logger.info('Parsed payload', {
      type: payload.type,
      table: payload.table,
      referenceId: payload.record?.id,
      requesterId: payload.record?.requester_id,
      endorserId: payload.record?.reference_id,
      newStatus: payload.record?.status,
      oldStatus: payload.old_record?.status ?? null,
    })

    if (payload.table !== 'profile_references') {
      logger.info('Ignoring non-reference event')
      return new Response(
        JSON.stringify({ message: 'Ignored - not a reference event' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    if (payload.type !== 'UPDATE') {
      logger.info('Ignoring non-UPDATE event', { type: payload.type })
      return new Response(
        JSON.stringify({ message: 'Ignored - not an UPDATE event' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // Only fire on pending → accepted transitions. Decline (pending → declined)
    // and revoke transitions intentionally don't email.
    const oldStatus = payload.old_record?.status ?? null
    const newStatus = payload.record?.status ?? null

    if (newStatus !== 'accepted') {
      logger.info('Ignoring - new status is not accepted', { oldStatus, newStatus })
      return new Response(
        JSON.stringify({ message: 'Ignored - status not accepted' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    if (oldStatus === 'accepted') {
      // Idempotency guard: webhook re-fire on the same already-accepted row
      // (e.g. an unrelated UPDATE touching responded_at). Don't re-email.
      logger.info('Ignoring - already accepted before this UPDATE', { oldStatus, newStatus })
      return new Response(
        JSON.stringify({ message: 'Ignored - already accepted' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    if (oldStatus !== 'pending') {
      // Defensive: the only valid transition into accepted is pending → accepted
      // (enforced server-side by handle_profile_reference_state). If we see
      // anything else we don't fire — protects against weird webhook replay.
      logger.info('Ignoring - unexpected transition', { oldStatus, newStatus })
      return new Response(
        JSON.stringify({ message: 'Ignored - unexpected transition' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const reference = payload.record

    logger.info('Reference acceptance detected', {
      referenceRecordId: reference.id,
      requesterId: reference.requester_id,
      endorserId: reference.reference_id,
      relationshipType: reference.relationship_type,
      hasEndorsementText: !!reference.endorsement_text,
    })

    const supabase = getServiceClient()

    // Fetch endorser (the person who accepted — was reference_id on the row).
    const { data: endorser, error: endorserError } = await supabase
      .from('profiles')
      .select('id, username, full_name, avatar_url, is_test_account, role')
      .eq('id', reference.reference_id)
      .single()

    if (endorserError || !endorser) {
      logger.error('Failed to fetch endorser profile', { error: endorserError?.message })
      return new Response(
        JSON.stringify({ error: 'Failed to fetch endorser profile' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    if (endorser.is_test_account) {
      logger.info('Ignoring acceptance from test account', {
        endorserId: endorser.id,
        isTestAccount: true,
      })
      return new Response(
        JSON.stringify({ message: 'Ignored - endorser is a test account' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // Fetch recipient (the original requester — gets the email).
    const { data: recipient, error: recipientError } = await supabase
      .from('profiles')
      .select('id, email, full_name, is_test_account, onboarding_completed, notify_references')
      .eq('id', reference.requester_id)
      .single()

    if (recipientError || !recipient) {
      logger.error('Failed to fetch recipient profile', { error: recipientError?.message })
      return new Response(
        JSON.stringify({ error: 'Failed to fetch recipient profile' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    if (recipient.is_test_account) {
      logger.info('Ignoring acceptance to test account', {
        recipientId: recipient.id,
        isTestAccount: true,
      })
      return new Response(
        JSON.stringify({ message: 'Ignored - recipient is a test account' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    if (!recipient.onboarding_completed) {
      logger.info('Ignoring - recipient has not completed onboarding', { recipientId: recipient.id })
      return new Response(
        JSON.stringify({ message: 'Ignored - recipient has not completed onboarding' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    if (!recipient.email) {
      logger.info('Ignoring - recipient has no email address', { recipientId: recipient.id })
      return new Response(
        JSON.stringify({ message: 'Ignored - recipient has no email address' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    if (recipient.notify_references === false) {
      logger.info('Recipient has disabled reference notifications', {
        recipientId: recipient.id,
        notifyReferences: false,
      })
      return new Response(
        JSON.stringify({ message: 'Ignored - recipient has disabled reference notifications' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    logger.info('All checks passed - proceeding with email')

    const endorserName = endorser.full_name?.trim() || 'Someone'
    const HOCKIA_BASE_URL = Deno.env.get('PUBLIC_SITE_URL') ?? 'https://inhockia.com'
    const profileUrl = buildEndorserProfileUrl(endorser, HOCKIA_BASE_URL)

    const templateVars = {
      endorser_name: endorserName,
      endorser_avatar_url: endorser.avatar_url || '',
      endorser_profile_url: profileUrl,
      relationship_type: reference.relationship_type || '',
      endorsement_text: reference.endorsement_text || '',
      cta_url: `${HOCKIA_BASE_URL}/dashboard/profile/references`,
      settings_url: `${HOCKIA_BASE_URL}/settings`,
    }

    let subject: string
    let emailHtml: string
    let emailText: string

    const rendered = await renderTemplate(supabase, 'reference_accepted', templateVars)
    if (rendered) {
      subject = rendered.subject
      emailHtml = rendered.html
      emailText = rendered.text
      logger.info('Using DB template for reference_accepted')
    } else {
      emailHtml = generateAcceptedEmailHtml(
        endorser as EndorserData,
        reference.relationship_type,
        reference.endorsement_text,
      )
      emailText = generateAcceptedEmailText(
        endorser as EndorserData,
        reference.relationship_type,
        reference.endorsement_text,
      )
      // Subject is what determines open rate. Lead with the endorser's name
      // and a warm verb ("vouched for you") instead of the generic
      // "accepted your reference request" — references are a trust/scouting
      // signal on HOCKIA, the email should reflect that.
      subject = `${endorserName} vouched for you on HOCKIA`
      logger.info('Falling back to hardcoded template')
    }

    const result = await sendTrackedEmail({
      supabase,
      resendApiKey,
      to: recipient.email,
      subject,
      html: emailHtml,
      text: emailText,
      templateKey: 'reference_accepted',
      recipientId: recipient.id,
      logger,
    })

    if (!result.success) {
      logger.error('Failed to send email', { error: result.error })
      return new Response(
        JSON.stringify({ error: 'Failed to send email', details: result.error }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    logger.info('=== Email sent successfully ===', {
      recipient: recipient.email,
      subject,
      endorserName: endorser.full_name,
      relationshipType: reference.relationship_type,
      resendEmailId: result.resendEmailId,
    })

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Reference accepted notification email sent',
        recipient: recipient.email,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error('Unhandled error', { error: errorMessage })
    captureException(error, { functionName: 'notify-reference-response', correlationId })
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
