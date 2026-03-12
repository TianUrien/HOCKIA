// NOTE: This file runs on Supabase Edge Functions (Deno runtime).
declare const Deno: { env: { get(key: string): string | undefined } }

/**
 * Consolidated Email Sending Module with Tracking
 *
 * Sends emails via Resend API and records each send in the email_sends table.
 * Adds Resend tags for webhook event correlation.
 *
 * Features:
 *   - Individual send with retry + rate limit handling
 *   - Batch send (up to 100 per request) with retry
 *   - Recipient whitelist guard (EMAIL_ALLOWED_RECIPIENTS)
 *   - Automatic recording to email_sends table
 *   - Resend tags for webhook correlation
 */

// @ts-expect-error Deno URL imports are resolved at runtime in Supabase Edge Functions.
import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { captureException } from './sentry.ts'

// ============================================================================
// Constants
// ============================================================================

const RESEND_API_URL = 'https://api.resend.com/emails'
const RESEND_BATCH_API_URL = 'https://api.resend.com/emails/batch'
const SENDER_EMAIL = 'PLAYR Hockey <team@oplayr.com>'
const REPLY_TO_EMAIL = 'team@oplayr.com'
const PLAYR_BASE_URL = Deno.env.get('PUBLIC_SITE_URL') ?? 'https://oplayr.com'
const UNSUBSCRIBE_URL = `${PLAYR_BASE_URL}/settings`

const BATCH_SIZE = 100
const BATCH_API_DELAY_MS = 600
const MAX_RETRIES = 3
const RETRY_DELAY_BASE_MS = 1000

// ============================================================================
// Types
// ============================================================================

export interface Logger {
  info: (message: string, meta?: Record<string, unknown>) => void
  warn: (message: string, meta?: Record<string, unknown>) => void
  error: (message: string, meta?: Record<string, unknown>) => void
}

export function createLogger(prefix: string, correlationId: string): Logger {
  return {
    info: (message: string, meta?: Record<string, unknown>) =>
      console.log(`[${prefix}][${correlationId}] ${message}`, meta ?? ''),
    warn: (message: string, meta?: Record<string, unknown>) =>
      console.warn(`[${prefix}][${correlationId}] ${message}`, meta ?? ''),
    error: (message: string, meta?: Record<string, unknown>) =>
      console.error(`[${prefix}][${correlationId}] ${message}`, meta ?? ''),
  }
}

export interface SendResult {
  success: boolean
  resendEmailId?: string
  error?: string
}

export interface BatchSendResult {
  success: boolean
  sent: string[]
  failed: string[]
  resendEmailIds: string[]
  stats: {
    totalRecipients: number
    sent: number
    failed: number
    durationMs: number
    batchApiCalls: number
  }
}

export interface RecipientInfo {
  email: string
  recipientId?: string
  recipientRole?: string
  recipientCountry?: string
  recipientName?: string
}

// ============================================================================
// Helpers
// ============================================================================

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function isRecipientAllowed(to: string, logger: Logger): boolean {
  const allowedRecipients = Deno.env.get('EMAIL_ALLOWED_RECIPIENTS')
  if (!allowedRecipients || allowedRecipients.trim() === '') return true
  const allowedList = allowedRecipients.split(',').map(e => e.trim().toLowerCase())
  const isAllowed = allowedList.includes(to.toLowerCase())
  if (!isAllowed) {
    logger.info('Recipient not on whitelist, skipping email', {
      recipient: to,
      whitelistCount: allowedList.length,
    })
  }
  return isAllowed
}

// ============================================================================
// Record send to database
// ============================================================================

async function recordSend(
  supabase: SupabaseClient,
  params: {
    resendEmailId: string | null
    templateKey: string
    campaignId?: string
    recipientEmail: string
    recipientId?: string
    recipientRole?: string
    recipientCountry?: string
    subject: string
    status?: string
    metadata?: Record<string, unknown>
  },
  logger: Logger
): Promise<void> {
  try {
    const { error } = await supabase.from('email_sends').insert({
      resend_email_id: params.resendEmailId,
      template_key: params.templateKey,
      campaign_id: params.campaignId || null,
      recipient_email: params.recipientEmail,
      recipient_id: params.recipientId || null,
      recipient_role: params.recipientRole || null,
      recipient_country: params.recipientCountry || null,
      subject: params.subject,
      status: params.status || 'sent',
      metadata: params.metadata || {},
    })
    if (error) {
      logger.warn('Failed to record email send', { error: error.message, recipient: params.recipientEmail })
      captureException(new Error(`DB record send failed: ${error.message}`), {
        functionName: 'email-sender/recordSend',
        tags: { template_key: params.templateKey, ...(params.campaignId ? { campaign_id: params.campaignId } : {}) },
        extra: { recipient: params.recipientEmail },
      })
    }
  } catch (err) {
    logger.warn('Error recording email send', {
      error: err instanceof Error ? err.message : 'Unknown',
      recipient: params.recipientEmail,
    })
    captureException(err, {
      functionName: 'email-sender/recordSend',
      tags: { template_key: params.templateKey, ...(params.campaignId ? { campaign_id: params.campaignId } : {}) },
      extra: { recipient: params.recipientEmail },
    })
  }
}

// ============================================================================
// Individual Send with Tracking
// ============================================================================

/**
 * Send a single email via Resend with retry logic, tags, and DB recording.
 */
export async function sendTrackedEmail(params: {
  supabase: SupabaseClient
  resendApiKey: string
  to: string
  subject: string
  html: string
  text: string
  templateKey: string
  campaignId?: string
  recipientId?: string
  recipientRole?: string
  recipientCountry?: string
  logger: Logger
  isTest?: boolean
}): Promise<SendResult> {
  const { supabase, resendApiKey, to, subject, html, text, templateKey,
    campaignId, recipientId, recipientRole, recipientCountry, logger, isTest } = params

  if (!isRecipientAllowed(to, logger)) {
    return { success: true }
  }

  const tags = [
    { name: 'template_key', value: templateKey },
  ]
  if (campaignId) {
    tags.push({ name: 'campaign_id', value: campaignId })
  }
  if (isTest) {
    tags.push({ name: 'test', value: 'true' })
  }

  let lastError = ''
  for (let retryCount = 0; retryCount <= MAX_RETRIES; retryCount++) {
    try {
      const response = await fetch(RESEND_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: SENDER_EMAIL,
          to,
          reply_to: REPLY_TO_EMAIL,
          subject,
          html,
          text,
          tags,
          headers: {
            'List-Unsubscribe': `<${UNSUBSCRIBE_URL}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        }),
      })

      if (response.status === 429 && retryCount < MAX_RETRIES) {
        const retryAfter = response.headers.get('Retry-After')
        const delayMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : RETRY_DELAY_BASE_MS * Math.pow(2, retryCount)
        logger.warn('Rate limited, retrying', { recipient: to, retryCount: retryCount + 1, delayMs })
        await delay(delayMs)
        continue
      }

      if (response.status >= 500 && retryCount < MAX_RETRIES) {
        const delayMs = RETRY_DELAY_BASE_MS * Math.pow(2, retryCount)
        logger.warn('Server error, retrying', { status: response.status, recipient: to, retryCount: retryCount + 1, delayMs })
        await delay(delayMs)
        continue
      }

      if (!response.ok) {
        const errorData = await response.text()
        lastError = `Resend API error: ${response.status} - ${errorData}`
        logger.error('Resend API error', { status: response.status, error: errorData, recipient: to })
        captureException(new Error(lastError), {
          functionName: 'email-sender/sendTrackedEmail',
          tags: { template_key: templateKey, ...(campaignId ? { campaign_id: campaignId } : {}), http_status: String(response.status) },
          extra: { recipient: to },
        })
        // Record as failed
        await recordSend(supabase, {
          resendEmailId: null, templateKey, campaignId,
          recipientEmail: to, recipientId, recipientRole, recipientCountry,
          subject, status: 'failed', metadata: { error: lastError },
        }, logger)
        return { success: false, error: lastError }
      }

      const result = await response.json()
      const resendEmailId = result.id

      logger.info('Email sent successfully', { emailId: resendEmailId, recipient: to })

      // Record successful send
      if (!isTest) {
        await recordSend(supabase, {
          resendEmailId, templateKey, campaignId,
          recipientEmail: to, recipientId, recipientRole, recipientCountry,
          subject,
        }, logger)
      }

      return { success: true, resendEmailId }
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Unknown error'
      if (retryCount < MAX_RETRIES) {
        const delayMs = RETRY_DELAY_BASE_MS * Math.pow(2, retryCount)
        logger.warn('Network error, retrying', { error: lastError, recipient: to, retryCount: retryCount + 1, delayMs })
        await delay(delayMs)
        continue
      }
    }
  }

  logger.error('Failed to send email after retries', { error: lastError, recipient: to })
  captureException(new Error(`Email send failed after ${MAX_RETRIES} retries: ${lastError}`), {
    functionName: 'email-sender/sendTrackedEmail',
    tags: { template_key: templateKey, ...(campaignId ? { campaign_id: campaignId } : {}) },
    extra: { recipient: to, maxRetries: MAX_RETRIES },
  })
  await recordSend(supabase, {
    resendEmailId: null, templateKey, campaignId,
    recipientEmail: to, recipientId, recipientRole, recipientCountry,
    subject, status: 'failed', metadata: { error: lastError },
  }, logger)
  return { success: false, error: lastError }
}

// ============================================================================
// Batch Send with Tracking
// ============================================================================

interface ResendBatchResponse {
  data?: Array<{ id: string }>
  errors?: Array<{ index: number; message: string }>
}

async function sendBatchWithRetry(
  resendApiKey: string,
  // deno-lint-ignore no-explicit-any
  emailPayloads: Array<Record<string, any>>,
  logger: Logger,
  retryCount = 0
): Promise<{ sent: string[]; failed: Array<{ email: string; error: string }>; resendEmailIds: string[] }> {
  const sent: string[] = []
  const failed: Array<{ email: string; error: string }> = []
  const resendEmailIds: string[] = []

  try {
    const response = await fetch(RESEND_BATCH_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
        'x-batch-validation': 'permissive',
      },
      body: JSON.stringify(emailPayloads),
    })

    if (response.status === 429 && retryCount < MAX_RETRIES) {
      const retryAfter = response.headers.get('Retry-After')
      const delayMs = retryAfter
        ? parseInt(retryAfter, 10) * 1000
        : RETRY_DELAY_BASE_MS * Math.pow(2, retryCount)
      logger.warn('Batch rate limited, retrying', { batchSize: emailPayloads.length, retryCount: retryCount + 1, delayMs })
      await delay(delayMs)
      return sendBatchWithRetry(resendApiKey, emailPayloads, logger, retryCount + 1)
    }

    if (response.status >= 500 && retryCount < MAX_RETRIES) {
      const delayMs = RETRY_DELAY_BASE_MS * Math.pow(2, retryCount)
      logger.warn('Batch server error, retrying', { status: response.status, batchSize: emailPayloads.length, retryCount: retryCount + 1 })
      await delay(delayMs)
      return sendBatchWithRetry(resendApiKey, emailPayloads, logger, retryCount + 1)
    }

    if (!response.ok) {
      const errorData = await response.text()
      logger.error('Batch API error', { status: response.status, error: errorData, batchSize: emailPayloads.length })
      captureException(new Error(`Batch API error: ${response.status} - ${errorData}`), {
        functionName: 'email-sender/sendBatchWithRetry',
        tags: { http_status: String(response.status) },
        extra: { batchSize: emailPayloads.length },
      })
      emailPayloads.forEach(p => {
        failed.push({ email: p.to, error: `Batch API error: ${response.status}` })
      })
      return { sent, failed, resendEmailIds }
    }

    const result: ResendBatchResponse = await response.json()

    const failedIndices = new Set<number>()
    if (result.errors?.length) {
      result.errors.forEach(err => {
        failedIndices.add(err.index)
        const email = emailPayloads[err.index]?.to || `index-${err.index}`
        failed.push({ email, error: err.message })
      })
    }

    emailPayloads.forEach((payload, index) => {
      if (!failedIndices.has(index)) {
        sent.push(payload.to)
      }
    })

    if (result.data) {
      resendEmailIds.push(...result.data.map(d => d.id))
    }

    logger.info('Batch sent', {
      batchSize: emailPayloads.length,
      sent: sent.length,
      failed: failed.length,
      emailIds: resendEmailIds.slice(0, 5),
    })

    return { sent, failed, resendEmailIds }
  } catch (error) {
    if (retryCount < MAX_RETRIES) {
      const delayMs = RETRY_DELAY_BASE_MS * Math.pow(2, retryCount)
      logger.warn('Batch network error, retrying', {
        error: error instanceof Error ? error.message : 'Unknown',
        batchSize: emailPayloads.length,
        retryCount: retryCount + 1,
      })
      await delay(delayMs)
      return sendBatchWithRetry(resendApiKey, emailPayloads, logger, retryCount + 1)
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error('Batch failed after retries', { error: errorMessage, batchSize: emailPayloads.length })
    captureException(error, {
      functionName: 'email-sender/sendBatchWithRetry',
      extra: { batchSize: emailPayloads.length, maxRetries: MAX_RETRIES },
    })
    emailPayloads.forEach(p => {
      failed.push({ email: p.to, error: errorMessage })
    })
    return { sent, failed, resendEmailIds }
  }
}

/**
 * Send tracked batch emails via Resend Batch API.
 * Records each successful send in email_sends.
 */
export async function sendTrackedBatch(params: {
  supabase: SupabaseClient
  resendApiKey: string
  recipients: RecipientInfo[]
  subject: string
  html: string
  text: string
  templateKey: string
  campaignId?: string
  logger: Logger
  /** Optional per-recipient rendering. Returns {html, text, subject} overrides for each recipient.
   *  Used to personalize emails (e.g. greeting by name) which improves deliverability
   *  by making each email's content unique instead of byte-identical. */
  renderForRecipient?: (recipient: RecipientInfo) => { html: string; text: string; subject: string }
}): Promise<BatchSendResult> {
  const { supabase, resendApiKey, recipients, subject, html, text,
    templateKey, campaignId, logger, renderForRecipient } = params

  const startTime = Date.now()
  const allSent: string[] = []
  const allFailed: string[] = []
  const allResendIds: string[] = []

  // Filter through whitelist
  const filtered = recipients.filter(r => isRecipientAllowed(r.email, logger))
  if (filtered.length === 0) {
    logger.info('No recipients after whitelist filtering')
    return {
      success: true, sent: [], failed: [], resendEmailIds: [],
      stats: { totalRecipients: 0, sent: 0, failed: 0, durationMs: 0, batchApiCalls: 0 },
    }
  }

  const tags = [{ name: 'template_key', value: templateKey }]
  if (campaignId) tags.push({ name: 'campaign_id', value: campaignId })

  const totalBatches = Math.ceil(filtered.length / BATCH_SIZE)
  logger.info('Starting tracked batch send', {
    totalRecipients: filtered.length,
    totalBatches,
  })

  for (let i = 0; i < filtered.length; i += BATCH_SIZE) {
    const batch = filtered.slice(i, i + BATCH_SIZE)
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1

    logger.info(`Processing batch ${batchNumber}/${totalBatches}`, { batchSize: batch.length })

    const emailPayloads = batch.map(r => {
      // Per-recipient rendering creates unique HTML per email (improves deliverability)
      const content = renderForRecipient
        ? renderForRecipient(r)
        : { html, text, subject }

      return {
        from: SENDER_EMAIL,
        to: r.email,
        reply_to: REPLY_TO_EMAIL,
        subject: content.subject,
        html: content.html,
        text: content.text,
        tags,
        headers: {
          'List-Unsubscribe': `<${UNSUBSCRIBE_URL}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }
    })

    const batchResult = await sendBatchWithRetry(resendApiKey, emailPayloads, logger)

    allSent.push(...batchResult.sent)
    allFailed.push(...batchResult.failed.map(f => f.email))
    allResendIds.push(...batchResult.resendEmailIds)

    // Record sends to database
    const sendRows = batch
      .filter(r => batchResult.sent.includes(r.email))
      .map((r, idx) => {
        const recipientSubject = renderForRecipient
          ? renderForRecipient(r).subject
          : subject
        return {
          resend_email_id: batchResult.resendEmailIds[idx] || null,
          template_key: templateKey,
          campaign_id: campaignId || null,
          recipient_email: r.email,
          recipient_id: r.recipientId || null,
          recipient_role: r.recipientRole || null,
          recipient_country: r.recipientCountry || null,
          subject: recipientSubject,
          status: 'sent',
        }
      })

    if (sendRows.length > 0) {
      const { error } = await supabase.from('email_sends').insert(sendRows)
      if (error) {
        logger.warn('Failed to record batch sends', { error: error.message, count: sendRows.length })
        captureException(new Error(`DB batch send recording failed: ${error.message}`), {
          functionName: 'email-sender/sendTrackedBatch',
          tags: { template_key: templateKey, ...(campaignId ? { campaign_id: campaignId } : {}) },
          extra: { rowCount: sendRows.length },
        })
      }
    }

    // Record failures
    const failRows = batch
      .filter(r => batchResult.failed.some(f => f.email === r.email))
      .map(r => {
        const recipientSubject = renderForRecipient
          ? renderForRecipient(r).subject
          : subject
        return {
          resend_email_id: null,
          template_key: templateKey,
          campaign_id: campaignId || null,
          recipient_email: r.email,
          recipient_id: r.recipientId || null,
          recipient_role: r.recipientRole || null,
          recipient_country: r.recipientCountry || null,
          subject: recipientSubject,
          status: 'failed',
          metadata: { error: batchResult.failed.find(f => f.email === r.email)?.error },
        }
      })

    if (failRows.length > 0) {
      const { error } = await supabase.from('email_sends').insert(failRows)
      if (error) {
        logger.warn('Failed to record batch failures', { error: error.message, count: failRows.length })
        captureException(new Error(`DB batch failure recording failed: ${error.message}`), {
          functionName: 'email-sender/sendTrackedBatch',
          tags: { template_key: templateKey, ...(campaignId ? { campaign_id: campaignId } : {}) },
          extra: { rowCount: failRows.length },
        })
      }
    }

    if (i + BATCH_SIZE < filtered.length) {
      await delay(BATCH_API_DELAY_MS)
    }
  }

  const durationMs = Date.now() - startTime
  const stats = {
    totalRecipients: filtered.length,
    sent: allSent.length,
    failed: allFailed.length,
    durationMs,
    batchApiCalls: totalBatches,
  }

  logger.info('Tracked batch send completed', { ...stats })

  return {
    success: allFailed.length === 0,
    sent: allSent,
    failed: allFailed,
    resendEmailIds: allResendIds,
    stats,
  }
}
