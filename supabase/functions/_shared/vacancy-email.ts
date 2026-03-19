// NOTE: This file runs on Supabase Edge Functions (Deno runtime).
declare const Deno: { env: { get(key: string): string | undefined } }

/**
 * Shared Email Template for Vacancy Notifications
 *
 * This module contains the email generation functions used by both
 * TEST and REAL vacancy notification Edge Functions.
 *
 * IMPORTANT: Both functions use IDENTICAL email templates.
 * Only the recipient routing logic differs.
 */

export const RESEND_API_URL = 'https://api.resend.com/emails'
export const SENDER_EMAIL = 'HOCKIA <team@inhockia.com>'
export const REPLY_TO_EMAIL = 'team@inhockia.com'
export const HOCKIA_BASE_URL = Deno.env.get('PUBLIC_SITE_URL') ?? 'https://inhockia.com'
export const UNSUBSCRIBE_URL = `${HOCKIA_BASE_URL}/settings`

export interface VacancyRecord {
  id: string
  club_id: string
  title: string
  position: string | null
  location_city: string
  location_country: string
  description: string | null
  status: string
  opportunity_type: string
}

export interface VacancyPayload {
  type: 'INSERT' | 'UPDATE'
  table: 'opportunities'
  schema: 'public'
  record: VacancyRecord
  old_record: VacancyRecord | null
}

export function generateEmailHtml(vacancy: VacancyRecord, clubName: string): string {
  // Safe field extraction with fallbacks
  const position = vacancy.position 
    ? vacancy.position.charAt(0).toUpperCase() + vacancy.position.slice(1) 
    : null
  
  // Build location string, handling missing city or country
  const city = vacancy.location_city?.trim() || null
  const country = vacancy.location_country?.trim() || null
  const location = city && country 
    ? `${city}, ${country}` 
    : city || country || null
  
  const summary = vacancy.description?.trim()?.slice(0, 200) || null
  const hasMoreSummary = vacancy.description && vacancy.description.length > 200
  const vacancyUrl = `${HOCKIA_BASE_URL}/opportunities/${vacancy.id}`
  const safeClubName = clubName?.trim() || 'A club'

  // Build details section conditionally
  const detailItems: string[] = []
  
  if (position) {
    detailItems.push(`<span style="display: inline-block; background: #f3f4f6; padding: 4px 12px; border-radius: 16px; font-size: 14px; color: #374151; margin-right: 8px; margin-bottom: 8px;">${position}</span>`)
  }
  
  if (location) {
    detailItems.push(`<span style="display: inline-block; background: #f3f4f6; padding: 4px 12px; border-radius: 16px; font-size: 14px; color: #374151; margin-right: 8px; margin-bottom: 8px;">📍 ${location}</span>`)
  }

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>New Opportunity on HOCKIA</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9fafb;">
  
  <!-- Header -->
  <div style="background: linear-gradient(135deg, #8026FA 0%, #924CEC 100%); padding: 32px 24px; border-radius: 16px 16px 0 0; text-align: center;">
    <img src="https://www.inhockia.com/hockia-logo-white.png" alt="HOCKIA" width="120" height="29" style="height: 29px; width: 120px;" />
  </div>
  
  <!-- Main Content -->
  <div style="background: #ffffff; padding: 32px 24px; border-left: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">
    
    <h1 style="color: #1f2937; margin: 0 0 8px 0; font-size: 24px; font-weight: 700;">New Opportunity Available! 🏑</h1>
    <p style="color: #6b7280; margin: 0 0 24px 0; font-size: 16px;">A club has just published a new opportunity.</p>
    
    <!-- Vacancy Card -->
    <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
      <h2 style="color: #1f2937; margin: 0 0 4px 0; font-size: 20px; font-weight: 600;">${vacancy.title}</h2>
      <p style="color: #8026FA; margin: 0 0 16px 0; font-size: 15px; font-weight: 500;">${safeClubName}</p>
      
      ${detailItems.length > 0 ? `<div style="margin-bottom: 16px;">${detailItems.join('')}</div>` : ''}
      
      ${summary ? `<p style="color: #4b5563; margin: 0; font-size: 14px; line-height: 1.6;">${summary}${hasMoreSummary ? '...' : ''}</p>` : ''}
    </div>
    
    <!-- CTA Button -->
    <div style="text-align: center;">
      <a href="${vacancyUrl}" style="display: inline-block; background: linear-gradient(135deg, #8026FA 0%, #924CEC 100%); color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
        View Opportunity
      </a>
    </div>
    
    <p style="color: #9ca3af; font-size: 13px; margin: 24px 0 0 0; text-align: center;">
      Don't miss out – great opportunities go fast!
    </p>
  </div>
  
  <!-- Footer -->
  <div style="background: #f3f4f6; padding: 24px; border-radius: 0 0 16px 16px; border: 1px solid #e5e7eb; border-top: none; text-align: center;">
    <p style="color: #6b7280; font-size: 13px; margin: 0 0 8px 0;">
      You're receiving this because you're on HOCKIA.
    </p>
    <p style="color: #9ca3af; font-size: 12px; margin: 0;">
      <a href="${HOCKIA_BASE_URL}/settings" style="color: #8026FA; text-decoration: none;">Manage notification preferences</a>
    </p>
  </div>
  
</body>
</html>
  `.trim()
}

export function generateEmailText(vacancy: VacancyRecord, clubName: string): string {
  // Safe field extraction with fallbacks
  const position = vacancy.position 
    ? vacancy.position.charAt(0).toUpperCase() + vacancy.position.slice(1) 
    : null
  
  // Build location string, handling missing city or country
  const city = vacancy.location_city?.trim() || null
  const country = vacancy.location_country?.trim() || null
  const location = city && country 
    ? `${city}, ${country}` 
    : city || country || null
  
  const summary = vacancy.description?.trim()?.slice(0, 200) || null
  const hasMoreSummary = vacancy.description && vacancy.description.length > 200
  const vacancyUrl = `${HOCKIA_BASE_URL}/opportunities/${vacancy.id}`
  const safeClubName = clubName?.trim() || 'A club'

  // Build text content
  const lines: string[] = [
    'New Opportunity Available on HOCKIA! 🏑',
    '',
    'A club has just published a new opportunity.',
    '',
    `${vacancy.title}`,
    `${safeClubName}`,
  ]
  
  if (position) {
    lines.push(`Position: ${position}`)
  }
  
  if (location) {
    lines.push(`Location: ${location}`)
  }
  
  if (summary) {
    lines.push('')
    lines.push(`${summary}${hasMoreSummary ? '...' : ''}`)
  }
  
  lines.push(
    '',
    'View this opportunity:',
    vacancyUrl,
    '',
    "Don't miss out – great opportunities go fast!",
    '',
    '---',
    "You're receiving this because you're on HOCKIA.",
    `Manage preferences: ${HOCKIA_BASE_URL}/settings`
  )

  return lines.join('\n')
}

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

// =============================================================================
// EMAIL SENDING CONFIGURATION - USING RESEND BATCH API
// =============================================================================

/**
 * Resend Batch API endpoint - sends up to 100 emails per request
 * This is MUCH more efficient than individual sends
 */
const RESEND_BATCH_API_URL = 'https://api.resend.com/emails/batch'

/**
 * Recipient whitelist guard for safe email testing.
 * Set EMAIL_ALLOWED_RECIPIENTS env var to a comma-separated list of emails.
 * When set, only those addresses receive emails. When unset, all recipients are allowed.
 */
function isRecipientAllowed(to: string, logger: Logger): boolean {
  const allowedRecipients = Deno.env.get('EMAIL_ALLOWED_RECIPIENTS')
  if (!allowedRecipients || allowedRecipients.trim() === '') {
    return true
  }
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

/**
 * Maximum emails per batch (Resend limit is 100)
 */
const BATCH_SIZE = 100

/**
 * Delay between batch API calls in milliseconds
 * Even with batch API, we respect rate limits (2 req/sec on your plan)
 * 600ms gives us margin under the 2 req/sec limit
 */
const BATCH_API_DELAY_MS = 600

/**
 * Maximum retry attempts for transient failures (429 rate limits, 5xx errors)
 */
const MAX_RETRIES = 3

/**
 * Delay between retries in milliseconds (exponential backoff base)
 * 1000ms base means: 1s, 2s, 4s for retries 1, 2, 3
 */
const RETRY_DELAY_BASE_MS = 1000

/**
 * Helper function to delay execution
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Send a single email with retry logic (used for small sends like test mode)
 */
export async function sendEmail(
  resendApiKey: string,
  to: string,
  subject: string,
  html: string,
  text: string,
  logger: Logger,
  retryCount = 0
): Promise<{ success: boolean; error?: string; retried?: boolean }> {
  if (retryCount === 0 && !isRecipientAllowed(to, logger)) {
    return { success: true }
  }

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
        headers: {
          'List-Unsubscribe': `<${UNSUBSCRIBE_URL}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }),
    })

    // Handle rate limiting (429) with retry
    if (response.status === 429 && retryCount < MAX_RETRIES) {
      const retryAfter = response.headers.get('Retry-After')
      const delayMs = retryAfter 
        ? parseInt(retryAfter, 10) * 1000 
        : RETRY_DELAY_BASE_MS * Math.pow(2, retryCount)
      
      logger.warn('Rate limited, retrying', { 
        recipient: to, 
        retryCount: retryCount + 1, 
        delayMs 
      })
      
      await delay(delayMs)
      return sendEmail(resendApiKey, to, subject, html, text, logger, retryCount + 1)
    }

    // Handle server errors (5xx) with retry
    if (response.status >= 500 && retryCount < MAX_RETRIES) {
      const delayMs = RETRY_DELAY_BASE_MS * Math.pow(2, retryCount)
      
      logger.warn('Server error, retrying', { 
        status: response.status,
        recipient: to, 
        retryCount: retryCount + 1, 
        delayMs 
      })
      
      await delay(delayMs)
      return sendEmail(resendApiKey, to, subject, html, text, logger, retryCount + 1)
    }

    if (!response.ok) {
      const errorData = await response.text()
      logger.error('Resend API error', { 
        status: response.status, 
        error: errorData, 
        recipient: to,
        retryCount 
      })
      return { 
        success: false, 
        error: `Resend API error: ${response.status} - ${errorData}`,
        retried: retryCount > 0
      }
    }

    const result = await response.json()
    logger.info('Email sent successfully', { 
      emailId: result.id, 
      recipient: to,
      retried: retryCount > 0
    })
    return { success: true, retried: retryCount > 0 }
  } catch (error) {
    // Retry on network errors
    if (retryCount < MAX_RETRIES) {
      const delayMs = RETRY_DELAY_BASE_MS * Math.pow(2, retryCount)
      
      logger.warn('Network error, retrying', { 
        error: error instanceof Error ? error.message : 'Unknown',
        recipient: to, 
        retryCount: retryCount + 1, 
        delayMs 
      })
      
      await delay(delayMs)
      return sendEmail(resendApiKey, to, subject, html, text, logger, retryCount + 1)
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error('Failed to send email after retries', { 
      error: errorMessage, 
      recipient: to,
      retryCount 
    })
    return { success: false, error: errorMessage, retried: retryCount > 0 }
  }
}

/**
 * Response structure from Resend Batch API
 */
interface ResendBatchResponse {
  data?: Array<{ id: string }>
  errors?: Array<{ index: number; message: string }>
}

/**
 * Send a batch of emails using Resend Batch API with retry logic
 * Returns the list of successful and failed recipients
 */
async function sendBatchWithRetry(
  resendApiKey: string,
  emailPayloads: Array<{
    from: string
    to: string
    subject: string
    html: string
    text: string
  }>,
  logger: Logger,
  retryCount = 0
): Promise<{ sent: string[]; failed: Array<{ email: string; error: string }> }> {
  const sent: string[] = []
  const failed: Array<{ email: string; error: string }> = []

  try {
    const response = await fetch(RESEND_BATCH_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
        'x-batch-validation': 'permissive', // Allow partial success
      },
      body: JSON.stringify(emailPayloads),
    })

    // Handle rate limiting (429) with retry
    if (response.status === 429 && retryCount < MAX_RETRIES) {
      const retryAfter = response.headers.get('Retry-After')
      const delayMs = retryAfter 
        ? parseInt(retryAfter, 10) * 1000 
        : RETRY_DELAY_BASE_MS * Math.pow(2, retryCount)
      
      logger.warn('Batch rate limited, retrying', { 
        batchSize: emailPayloads.length,
        retryCount: retryCount + 1, 
        delayMs 
      })
      
      await delay(delayMs)
      return sendBatchWithRetry(resendApiKey, emailPayloads, logger, retryCount + 1)
    }

    // Handle server errors (5xx) with retry
    if (response.status >= 500 && retryCount < MAX_RETRIES) {
      const delayMs = RETRY_DELAY_BASE_MS * Math.pow(2, retryCount)
      
      logger.warn('Batch server error, retrying', { 
        status: response.status,
        batchSize: emailPayloads.length,
        retryCount: retryCount + 1, 
        delayMs 
      })
      
      await delay(delayMs)
      return sendBatchWithRetry(resendApiKey, emailPayloads, logger, retryCount + 1)
    }

    if (!response.ok) {
      const errorData = await response.text()
      logger.error('Batch API error - all emails failed', { 
        status: response.status, 
        error: errorData,
        batchSize: emailPayloads.length 
      })
      // Mark all as failed
      emailPayloads.forEach(p => {
        failed.push({ email: p.to, error: `Batch API error: ${response.status}` })
      })
      return { sent, failed }
    }

    const result: ResendBatchResponse = await response.json()
    
    // Track which indices failed
    const failedIndices = new Set<number>()
    if (result.errors && result.errors.length > 0) {
      result.errors.forEach(err => {
        failedIndices.add(err.index)
        const email = emailPayloads[err.index]?.to || `index-${err.index}`
        failed.push({ email, error: err.message })
        logger.warn('Email failed in batch', { 
          index: err.index, 
          email, 
          error: err.message 
        })
      })
    }

    // All emails not in failed indices are successful
    emailPayloads.forEach((payload, index) => {
      if (!failedIndices.has(index)) {
        sent.push(payload.to)
      }
    })

    logger.info('Batch sent', { 
      batchSize: emailPayloads.length,
      sent: sent.length,
      failed: failed.length,
      emailIds: result.data?.map(d => d.id).slice(0, 5) // Log first 5 IDs
    })

    return { sent, failed }
  } catch (error) {
    // Retry on network errors
    if (retryCount < MAX_RETRIES) {
      const delayMs = RETRY_DELAY_BASE_MS * Math.pow(2, retryCount)
      
      logger.warn('Batch network error, retrying', { 
        error: error instanceof Error ? error.message : 'Unknown',
        batchSize: emailPayloads.length,
        retryCount: retryCount + 1, 
        delayMs 
      })
      
      await delay(delayMs)
      return sendBatchWithRetry(resendApiKey, emailPayloads, logger, retryCount + 1)
    }

    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error('Batch failed after retries', { 
      error: errorMessage,
      batchSize: emailPayloads.length 
    })
    // Mark all as failed
    emailPayloads.forEach(p => {
      failed.push({ email: p.to, error: errorMessage })
    })
    return { sent, failed }
  }
}

/**
 * Send emails using Resend Batch API - dramatically faster than individual sends!
 * 
 * Performance comparison for 200 recipients:
 * - Old method (2 req/sec): 100 batches × 1.1s = ~110 seconds
 * - Batch API: 2 API calls × 0.6s = ~1.2 seconds (90x faster!)
 * 
 * Resend Batch API allows up to 100 emails per request.
 * We use permissive mode to allow partial success.
 */
export async function sendEmailsIndividually(
  resendApiKey: string,
  recipients: string[],
  subject: string,
  html: string,
  text: string,
  logger: Logger
): Promise<{ success: boolean; sent: string[]; failed: string[]; stats: EmailStats }> {
  const allSent: string[] = []
  const allFailed: string[] = []
  const startTime = Date.now()

  // Filter recipients through whitelist guard
  const originalCount = recipients.length
  recipients = recipients.filter(r => isRecipientAllowed(r, logger))
  if (recipients.length < originalCount) {
    logger.info('Whitelist filtered recipients', {
      original: originalCount,
      allowed: recipients.length,
      skipped: originalCount - recipients.length,
    })
  }

  if (recipients.length === 0) {
    logger.info('No recipients after whitelist filtering, skipping send')
    return {
      success: true,
      sent: [],
      failed: [],
      stats: {
        totalRecipients: 0,
        sent: 0,
        failed: 0,
        retriedCount: 0,
        durationMs: 0,
        avgTimePerEmail: 0,
        batchApiCalls: 0,
      },
    }
  }

  const totalBatches = Math.ceil(recipients.length / BATCH_SIZE)
  
  logger.info('Starting Resend Batch API send', { 
    totalRecipients: recipients.length,
    batchSize: BATCH_SIZE,
    totalBatches,
    estimatedTime: `${(totalBatches * BATCH_API_DELAY_MS / 1000).toFixed(1)}s`
  })

  // Process in batches of BATCH_SIZE (100)
  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const batchRecipients = recipients.slice(i, i + BATCH_SIZE)
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1
    
    logger.info(`Processing batch ${batchNumber}/${totalBatches}`, { 
      batchSize: batchRecipients.length,
      progress: `${Math.min(i + BATCH_SIZE, recipients.length)}/${recipients.length}`
    })

    // Build the batch payload - each recipient gets their own email object
    const emailPayloads = batchRecipients.map(recipient => ({
      from: SENDER_EMAIL,
      to: recipient,
      reply_to: REPLY_TO_EMAIL,
      subject,
      html,
      text,
      headers: {
        'List-Unsubscribe': `<${UNSUBSCRIBE_URL}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    }))

    // Send the batch
    const batchResult = await sendBatchWithRetry(resendApiKey, emailPayloads, logger)
    
    allSent.push(...batchResult.sent)
    allFailed.push(...batchResult.failed.map(f => f.email))

    // Add delay between batch API calls (except for last batch)
    if (i + BATCH_SIZE < recipients.length) {
      await delay(BATCH_API_DELAY_MS)
    }
  }

  const durationMs = Date.now() - startTime
  const stats: EmailStats = {
    totalRecipients: recipients.length,
    sent: allSent.length,
    failed: allFailed.length,
    retriedCount: 0, // Batch API handles retries internally
    durationMs,
    avgTimePerEmail: recipients.length > 0 ? Math.round(durationMs / recipients.length) : 0,
    batchApiCalls: totalBatches,
  }

  logger.info('Batch API send completed', { ...stats })

  return {
    success: allFailed.length === 0,
    sent: allSent,
    failed: allFailed,
    stats,
  }
}

export interface EmailStats {
  totalRecipients: number
  sent: number
  failed: number
  retriedCount: number
  durationMs: number
  avgTimePerEmail: number
  batchApiCalls?: number
}

/**
 * Check if a vacancy was just published (status changed to 'open')
 */
export function isVacancyNewlyPublished(payload: VacancyPayload): boolean {
  const vacancy = payload.record
  
  // Case 1: INSERT with status = 'open' (directly published)
  if (payload.type === 'INSERT' && vacancy.status === 'open') {
    return true
  }
  
  // Case 2: UPDATE where old status was not 'open' and new status is 'open'
  if (payload.type === 'UPDATE' && vacancy.status === 'open' && payload.old_record?.status !== 'open') {
    return true
  }
  
  return false
}
