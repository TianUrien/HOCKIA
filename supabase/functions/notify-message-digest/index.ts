// deno-lint-ignore-file no-explicit-any
import { getServiceClient } from '../_shared/supabase-client.ts'
import { captureException } from '../_shared/sentry.ts'
import { corsHeaders } from '../_shared/cors.ts'
import {
  DigestWebhookPayload,
  RecipientData,
  ConversationDigest,
  createLogger,
  generateEmailHtml,
  generateEmailText,
  sendEmail,
} from '../_shared/message-digest-email.ts'
import { renderTemplate } from '../_shared/email-renderer.ts'
import { sendTrackedEmail } from '../_shared/email-sender.ts'

/**
 * ============================================================================
 * Message Digest Email Edge Function
 * ============================================================================
 *
 * Purpose:
 * - Sends a single digest email summarizing unread messages across conversations
 * - Triggered by database webhook on INSERT to message_digest_queue
 * - pg_cron runs enqueue_message_digests() every 30 min, which inserts queue rows
 *
 * Safety guarantees:
 * 1. Only processes real accounts (is_test_account = false)
 * 2. Respects notify_messages preference
 * 3. EMAIL_ALLOWED_RECIPIENTS whitelist for staging safety
 *
 * Webhook configuration:
 * - Trigger on: INSERT on message_digest_queue table
 * ============================================================================
 */

Deno.serve(async (req: Request) => {
  const correlationId = crypto.randomUUID().slice(0, 8)
  const logger = createLogger('NOTIFY_MESSAGE_DIGEST', correlationId)

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
    const payload: DigestWebhookPayload = await req.json()
    logger.info('Parsed payload', {
      type: payload.type,
      table: payload.table,
      queueId: payload.record?.id,
      recipientId: payload.record?.recipient_id,
      notificationCount: payload.record?.notification_ids?.length,
    })

    // Only process message_digest_queue events
    if (payload.table !== 'message_digest_queue') {
      logger.info('Ignoring non-queue event')
      return new Response(
        JSON.stringify({ message: 'Ignored - not a message digest queue event' }),
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
      .select('id, email, full_name, is_test_account, onboarding_completed, notify_messages')
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
      notifyMessages: recipient.notify_messages,
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
    if (recipient.notify_messages === false) {
      logger.info('Recipient has disabled message digest emails', { recipientId: recipient.id })
      await markQueueProcessed(supabase, queueRecord.id, logger)
      return new Response(
        JSON.stringify({ message: 'Ignored - recipient disabled message digests' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Fetch the notifications by ID to get conversation metadata
    const { data: notifications, error: notifError } = await supabase
      .from('profile_notifications')
      .select('id, source_entity_id, metadata, actor_profile_id')
      .in('id', queueRecord.notification_ids)

    if (notifError || !notifications || notifications.length === 0) {
      logger.error('Failed to fetch notifications', {
        error: notifError?.message,
        notificationIds: queueRecord.notification_ids,
      })
      await markQueueProcessed(supabase, queueRecord.id, logger)
      return new Response(
        JSON.stringify({ error: 'Failed to fetch notifications' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    logger.info('Fetched notifications', { count: notifications.length })

    // Collect unique sender IDs from all notifications
    const senderIdSet = new Set<string>()
    for (const notif of notifications) {
      const senderIds = notif.metadata?.sender_ids as string[] | undefined
      if (senderIds) {
        for (const sid of senderIds) {
          senderIdSet.add(sid)
        }
      }
      // Fallback: use actor_profile_id if sender_ids is missing
      if (notif.actor_profile_id) {
        senderIdSet.add(notif.actor_profile_id)
      }
    }

    // Fetch sender profiles
    const senderIds = Array.from(senderIdSet)
    const { data: senders, error: sendersError } = await supabase
      .from('profiles')
      .select('id, full_name, avatar_url')
      .in('id', senderIds)

    if (sendersError) {
      logger.error('Failed to fetch sender profiles', { error: sendersError.message })
    }

    const senderMap = new Map<string, { full_name: string | null; avatar_url: string | null }>()
    if (senders) {
      for (const s of senders) {
        senderMap.set(s.id, { full_name: s.full_name, avatar_url: s.avatar_url })
      }
    }

    // Build conversation digest entries
    const conversations: ConversationDigest[] = notifications.map(notif => {
      const metadata = notif.metadata as any
      const conversationId = (notif.source_entity_id || metadata?.conversation_id) as string

      // Determine the primary sender name
      // Use the most recent sender (actor_profile_id) or first from sender_ids
      const primarySenderId = notif.actor_profile_id
        || (metadata?.sender_ids?.[0] as string | undefined)

      const senderProfile = primarySenderId ? senderMap.get(primarySenderId) : null
      const senderName = senderProfile?.full_name?.trim() || 'Someone'
      const senderAvatar = senderProfile?.avatar_url || null

      return {
        conversation_id: conversationId,
        message_count: (metadata?.message_count as number) || 1,
        sender_name: senderName,
        sender_avatar_url: senderAvatar,
      }
    })

    logger.info('Built conversation digests', {
      conversationCount: conversations.length,
      totalMessages: conversations.reduce((sum, c) => sum + c.message_count, 0),
    })

    const totalMessages = conversations.reduce((sum, c) => sum + c.message_count, 0)
    const firstName = recipient.full_name?.split(' ')[0]?.trim() || 'there'
    const HOCKIA_BASE_URL = Deno.env.get('PUBLIC_SITE_URL') ?? 'https://inhockia.com'

    const templateVars = {
      first_name: firstName,
      heading: conversations.length === 1
        ? `New message from ${conversations[0].sender_name}`
        : `You have ${totalMessages} new message${totalMessages === 1 ? '' : 's'}`,
      message_count: String(totalMessages),
      conversations: JSON.stringify(conversations),
      conversations_text: conversations
        .map(c => `${c.sender_name}: ${c.message_count} new message${c.message_count === 1 ? '' : 's'}`)
        .join('\n'),
      cta_url: `${HOCKIA_BASE_URL}/messages`,
      cta_label: 'View Messages',
      settings_url: `${HOCKIA_BASE_URL}/settings`,
    }

    // Try DB template, fall back to hardcoded
    let subject: string
    let emailHtml: string
    let emailText: string

    const rendered = await renderTemplate(supabase, 'message_digest', templateVars)
    if (rendered) {
      subject = rendered.subject
      emailHtml = rendered.html
      emailText = rendered.text
      logger.info('Using DB template for message_digest')
    } else {
      emailHtml = generateEmailHtml(recipient as RecipientData, conversations)
      emailText = generateEmailText(recipient as RecipientData, conversations)
      subject = conversations.length === 1
        ? `New message from ${conversations[0].sender_name} on HOCKIA`
        : 'You have new messages on HOCKIA'
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
      templateKey: 'message_digest',
      recipientId: recipient.id,
      logger,
    })

    // Mark queue row as processed regardless of email success
    await markQueueProcessed(supabase, queueRecord.id, logger)

    if (!result.success) {
      logger.error('Failed to send digest email', { error: result.error })
      return new Response(
        JSON.stringify({ error: 'Failed to send email', details: result.error }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    logger.info('=== Digest email sent successfully ===', {
      recipient: recipient.email,
      subject,
      conversationCount: conversations.length,
      resendEmailId: result.resendEmailId,
    })

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Message digest email sent',
        recipient: recipient.email,
        conversationCount: conversations.length,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error('Unhandled error', { error: errorMessage })
    captureException(error, { functionName: 'notify-message-digest', correlationId })
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
    .from('message_digest_queue')
    .update({ processed_at: new Date().toISOString() })
    .eq('id', queueId)

  if (error) {
    logger.error('Failed to mark queue row as processed', {
      queueId,
      error: error.message,
    })
  }
}
