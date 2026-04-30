// deno-lint-ignore-file no-explicit-any
import { getServiceClient } from '../_shared/supabase-client.ts'
import { captureException } from '../_shared/sentry.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { sendTrackedEmail, createLogger } from '../_shared/email-sender.ts'
import {
  generateReminderEmailHtml,
  generateReminderEmailText,
  type ReminderRecipient,
  type ReminderSuggestedFriend,
} from '../_shared/reference-reminder-email.ts'

/**
 * ============================================================================
 * Reference Reminder Email Edge Function (Phase 3.2)
 * ============================================================================
 *
 * Purpose:
 *   Sends a one-time reference-reminder email to users who have at least one
 *   accepted friend ≥7 days old but still have zero references (no accepted,
 *   no pending). The CTA deeplinks them into the AddReferenceModal preselected
 *   to a specific suggested friend.
 *
 * Trigger:
 *   Database webhook on INSERT to public.reference_reminder_queue. The cron
 *   job public.enqueue_reference_reminders() (daily at 14:00 UTC) is what
 *   inserts the rows.
 *
 * Webhook setup:
 *   See docs/notify-reference-reminder-webhook-setup.md
 *
 * Idempotency:
 *   Queue table has UNIQUE(recipient_id) so only one reminder per user, ever.
 *   Edge function ALSO marks processed_at on every exit path so a stuck row
 *   never re-fires the function via a webhook re-delivery.
 *
 * Defense-in-depth re-checks at send time:
 *   - Recipient still exists, is not blocked, is not a test account
 *   - Recipient still has notify_references = true and onboarding_completed
 *   - Recipient role still in (player/coach/umpire)
 *   - Recipient still has zero active references (pending or accepted)
 *   - Suggested friend still exists, is still an accepted friend, and the
 *     pair does not already have an active reference
 * ============================================================================
 */

interface ReminderQueueRecord {
  id: string
  recipient_id: string
  suggested_friend_id: string
  created_at: string
  processed_at: string | null
}

interface ReminderQueuePayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE'
  table: string
  record: ReminderQueueRecord
  old_record: any
}

Deno.serve(async (req: Request) => {
  const correlationId = crypto.randomUUID().slice(0, 8)
  const logger = createLogger('NOTIFY_REFERENCE_REMINDER', correlationId)

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

    const payload: ReminderQueuePayload = await req.json()
    logger.info('Parsed payload', {
      type: payload.type,
      table: payload.table,
      queueId: payload.record?.id,
      recipientId: payload.record?.recipient_id,
      suggestedFriendId: payload.record?.suggested_friend_id,
    })

    if (payload.table !== 'reference_reminder_queue') {
      logger.info('Ignoring non-queue event', { table: payload.table })
      return ok({ message: 'Ignored - not a reference reminder queue event' })
    }

    if (payload.type !== 'INSERT') {
      logger.info('Ignoring non-INSERT event', { type: payload.type })
      return ok({ message: 'Ignored - not a new queue entry' })
    }

    const queueRecord = payload.record
    const supabase = getServiceClient()

    // -------------------------------------------------------------------
    // Recipient: fetch + re-check eligibility
    // -------------------------------------------------------------------
    const { data: recipient, error: recipientError } = await supabase
      .from('profiles')
      .select(
        'id, email, full_name, username, role, is_test_account, is_blocked, notify_references, onboarding_completed',
      )
      .eq('id', queueRecord.recipient_id)
      .maybeSingle()

    if (recipientError) {
      logger.error('Failed to fetch recipient profile', { error: recipientError.message })
      await markProcessed(supabase, queueRecord.id, logger)
      return error500('Failed to fetch recipient profile', recipientError.message)
    }

    if (!recipient) {
      logger.info('Skipping - recipient profile not found (deleted)', {
        recipientId: queueRecord.recipient_id,
      })
      await markProcessed(supabase, queueRecord.id, logger)
      return ok({ message: 'Skipped - recipient not found' })
    }

    if (recipient.is_test_account) {
      logger.info('Skipping - recipient is a test account', { recipientId: recipient.id })
      await markProcessed(supabase, queueRecord.id, logger)
      return ok({ message: 'Skipped - test account' })
    }

    if (recipient.is_blocked) {
      logger.info('Skipping - recipient is blocked', { recipientId: recipient.id })
      await markProcessed(supabase, queueRecord.id, logger)
      return ok({ message: 'Skipped - blocked recipient' })
    }

    if (!recipient.email) {
      logger.info('Skipping - recipient has no email', { recipientId: recipient.id })
      await markProcessed(supabase, queueRecord.id, logger)
      return ok({ message: 'Skipped - no email' })
    }

    if (recipient.notify_references === false) {
      logger.info('Skipping - notify_references disabled', { recipientId: recipient.id })
      await markProcessed(supabase, queueRecord.id, logger)
      return ok({ message: 'Skipped - notify_references disabled' })
    }

    if (recipient.onboarding_completed === false) {
      logger.info('Skipping - onboarding not completed', { recipientId: recipient.id })
      await markProcessed(supabase, queueRecord.id, logger)
      return ok({ message: 'Skipped - onboarding incomplete' })
    }

    if (!['player', 'coach', 'umpire'].includes(recipient.role ?? '')) {
      logger.info('Skipping - role no longer eligible', {
        recipientId: recipient.id,
        role: recipient.role,
      })
      await markProcessed(supabase, queueRecord.id, logger)
      return ok({ message: 'Skipped - role not eligible' })
    }

    // Re-check: recipient may have created a reference between enqueue and
    // send (race window can be ~minutes if many rows are processed).
    const { count: activeRefCount, error: refCountError } = await supabase
      .from('profile_references')
      .select('*', { count: 'exact', head: true })
      .eq('requester_id', recipient.id)
      .in('status', ['pending', 'accepted'])

    if (refCountError) {
      logger.error('Failed to recount active references', { error: refCountError.message })
      await markProcessed(supabase, queueRecord.id, logger)
      return error500('Failed to recount references', refCountError.message)
    }

    if ((activeRefCount ?? 0) > 0) {
      logger.info('Skipping - recipient has active references since enqueue', {
        recipientId: recipient.id,
        activeRefCount,
      })
      await markProcessed(supabase, queueRecord.id, logger)
      return ok({ message: 'Skipped - already has references' })
    }

    // -------------------------------------------------------------------
    // Suggested friend: fetch + re-check friendship + re-check no active pair
    // -------------------------------------------------------------------
    const { data: friend, error: friendError } = await supabase
      .from('profiles')
      .select('id, full_name, username, avatar_url, role, is_blocked')
      .eq('id', queueRecord.suggested_friend_id)
      .maybeSingle()

    if (friendError) {
      logger.error('Failed to fetch suggested friend', { error: friendError.message })
      await markProcessed(supabase, queueRecord.id, logger)
      return error500('Failed to fetch friend', friendError.message)
    }

    if (!friend) {
      logger.info('Skipping - suggested friend profile no longer exists', {
        recipientId: recipient.id,
        suggestedFriendId: queueRecord.suggested_friend_id,
      })
      await markProcessed(supabase, queueRecord.id, logger)
      return ok({ message: 'Skipped - friend not found' })
    }

    if (friend.is_blocked) {
      logger.info('Skipping - suggested friend is blocked', { friendId: friend.id })
      await markProcessed(supabase, queueRecord.id, logger)
      return ok({ message: 'Skipped - friend blocked' })
    }

    // Re-check the friendship is still accepted. profile_friend_edges is a
    // bidirectional view; either direction matching is fine.
    const { data: friendship, error: friendshipError } = await supabase
      .from('profile_friend_edges')
      .select('status')
      .eq('profile_id', recipient.id)
      .eq('friend_id', friend.id)
      .eq('status', 'accepted')
      .maybeSingle()

    if (friendshipError) {
      logger.error('Failed to verify friendship', { error: friendshipError.message })
      await markProcessed(supabase, queueRecord.id, logger)
      return error500('Failed to verify friendship', friendshipError.message)
    }

    if (!friendship) {
      logger.info('Skipping - friendship is no longer accepted', {
        recipientId: recipient.id,
        friendId: friend.id,
      })
      await markProcessed(supabase, queueRecord.id, logger)
      return ok({ message: 'Skipped - friendship not active' })
    }

    // Re-check the pair has no active reference between them. The owner
    // could have asked this friend in the gap between enqueue and send via
    // the in-app flow.
    const { count: pairRefCount, error: pairRefError } = await supabase
      .from('profile_references')
      .select('*', { count: 'exact', head: true })
      .eq('requester_id', recipient.id)
      .eq('reference_id', friend.id)
      .in('status', ['pending', 'accepted'])

    if (pairRefError) {
      logger.error('Failed to recount pair references', { error: pairRefError.message })
      await markProcessed(supabase, queueRecord.id, logger)
      return error500('Failed to recount pair references', pairRefError.message)
    }

    if ((pairRefCount ?? 0) > 0) {
      logger.info('Skipping - active reference already exists for this pair', {
        recipientId: recipient.id,
        friendId: friend.id,
      })
      await markProcessed(supabase, queueRecord.id, logger)
      return ok({ message: 'Skipped - pair already has reference' })
    }

    // -------------------------------------------------------------------
    // Render + send
    // -------------------------------------------------------------------
    const reminderRecipient: ReminderRecipient = {
      id: recipient.id,
      email: recipient.email,
      full_name: recipient.full_name,
      username: recipient.username,
    }
    const reminderFriend: ReminderSuggestedFriend = {
      id: friend.id,
      full_name: friend.full_name,
      username: friend.username,
      avatar_url: friend.avatar_url,
      role: friend.role,
    }

    const subject = 'Add trust to your HOCKIA profile'
    const html = generateReminderEmailHtml(reminderRecipient, reminderFriend)
    const text = generateReminderEmailText(reminderRecipient, reminderFriend)

    const result = await sendTrackedEmail({
      supabase,
      resendApiKey,
      to: recipient.email,
      subject,
      html,
      text,
      templateKey: 'reference_reminder',
      recipientId: recipient.id,
      logger,
    })

    // Always mark processed even if Resend errored — keeps the queue
    // accurate. A failed send is captured in email_sends with status='failed'
    // by sendTrackedEmail itself; we don't retry here (one-time email).
    await markProcessed(supabase, queueRecord.id, logger)

    if (!result.success) {
      logger.error('Failed to send reference reminder email', { error: result.error })
      return new Response(
        JSON.stringify({ error: 'Failed to send email', details: result.error }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    logger.info('=== Reference reminder email sent successfully ===', {
      recipient: recipient.email,
      subject,
      resendEmailId: result.resendEmailId,
    })

    return ok({
      success: true,
      message: 'Reference reminder email sent',
      recipient: recipient.email,
    })
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'
    logger.error('Unhandled error', { error: errorMessage })
    captureException(err, { functionName: 'notify-reference-reminder', correlationId })
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})

// =============================================================================
// Helpers
// =============================================================================

function ok(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function error500(message: string, details: string): Response {
  return new Response(
    JSON.stringify({ error: message, details }),
    { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
}

async function markProcessed(
  supabase: any,
  queueId: string,
  logger: { error: (msg: string, meta?: Record<string, unknown>) => void },
): Promise<void> {
  const { error } = await supabase
    .from('reference_reminder_queue')
    .update({ processed_at: new Date().toISOString() })
    .eq('id', queueId)

  if (error) {
    logger.error('Failed to mark queue row as processed', {
      queueId,
      error: error.message,
    })
  }
}
