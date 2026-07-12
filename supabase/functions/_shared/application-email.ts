// NOTE: This file runs on Supabase Edge Functions (Deno runtime).
declare const Deno: { env: { get(key: string): string | undefined } }

/**
 * Shared Email Template for Application Notifications (to Clubs)
 *
 * This module contains the email generation functions used by both
 * TEST and REAL application notification Edge Functions.
 *
 * IMPORTANT: Both functions use IDENTICAL email templates.
 * Only the recipient routing logic differs.
 *
 * Sent when: A player applies to a club's vacancy
 * Recipient: The club that created the vacancy
 */

export const RESEND_API_URL = 'https://api.resend.com/emails'
export const SENDER_EMAIL = 'HOCKIA <team@inhockia.com>'
export const REPLY_TO_EMAIL = 'team@inhockia.com'
export const HOCKIA_BASE_URL = Deno.env.get('PUBLIC_SITE_URL') ?? 'https://inhockia.com'
export const UNSUBSCRIBE_URL = `${HOCKIA_BASE_URL}/settings`

export interface ApplicationRecord {
  id: string
  opportunity_id: string
  applicant_id: string
  status: string
  applied_at: string
}

export interface OpportunityData {
  id: string
  title: string
  club_id: string
}

export interface ApplicantData {
  id: string
  username: string | null
  full_name: string | null
  position: string | null
  secondary_position: string | null
  base_location: string | null
  avatar_url: string | null
  is_test_account: boolean
}

export interface ClubData {
  id: string
  email: string
  full_name: string | null
  is_test_account: boolean
}

export interface ApplicationPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE'
  table: 'opportunity_applications'
  schema: 'public'
  record: ApplicationRecord
  old_record: ApplicationRecord | null
}

function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function generateEmailHtml(
  applicant: ApplicantData,
  opportunity: OpportunityData,
): string {
  const displayName = applicant.full_name?.trim() || 'Player'
  
  // Build positions string
  const positions: string[] = []
  if (applicant.position) {
    positions.push(capitalizeFirst(applicant.position))
  }
  if (applicant.secondary_position && applicant.secondary_position !== applicant.position) {
    positions.push(capitalizeFirst(applicant.secondary_position))
  }
  const positionsText = positions.length > 0 ? positions.join(' • ') : null
  
  const location = applicant.base_location?.trim() || null
  
  // Two distinct destinations:
  //   - applicantsUrl: the dashboard applicants list for THIS opportunity.
  //     Primary CTA. Clubs/coaches want to review the application alongside
  //     other applicants and triage (good fit / maybe / reject), not just
  //     read one profile. Mirrors the in-app new-application notification
  //     which already routes here (see notifications/config.ts).
  //   - profileUrl: the applicant's public profile. Secondary CTA.
  const applicantsUrl = `${HOCKIA_BASE_URL}/dashboard/opportunities/${opportunity.id}/applicants`
  const profileUrl = applicant.username
    ? `${HOCKIA_BASE_URL}/players/${applicant.username}`
    : `${HOCKIA_BASE_URL}/players/id/${applicant.id}`

  // Build detail items for applicant card
  const detailItems: string[] = []

  if (positionsText) {
    detailItems.push(`<span style="display: inline-block; background: #f3f4f6; padding: 4px 12px; border-radius: 16px; font-size: 14px; color: #374151; margin-right: 8px; margin-bottom: 8px;">${positionsText}</span>`)
  }

  if (location) {
    detailItems.push(`<span style="display: inline-block; background: #f3f4f6; padding: 4px 12px; border-radius: 16px; font-size: 14px; color: #374151; margin-right: 8px; margin-bottom: 8px;">📍 ${location}</span>`)
  }

  // Generate initials for fallback avatar
  const initials = getInitials(displayName)
  
  // Generate avatar HTML - use table-based layout for email compatibility
  const avatarHtml = applicant.avatar_url 
    ? `<img src="${applicant.avatar_url}" alt="${displayName}" style="width: 48px; height: 48px; border-radius: 24px;" />`
    : `<table cellpadding="0" cellspacing="0" border="0" style="width: 48px; height: 48px; border-radius: 24px; background: linear-gradient(135deg, #6d28d9 0%, #7c3aed 100%);">
        <tr>
          <td align="center" valign="middle" style="width: 48px; height: 48px; color: white; font-weight: bold; font-size: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">${initials}</td>
        </tr>
      </table>`

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">

  <div style="padding: 16px 0 24px 0; text-align: left;">
    <img src="https://www.inhockia.com/hockia-logo-white.png" alt="HOCKIA" width="100" height="24" style="height: 24px; width: 100px; background: #6d28d9; padding: 8px 12px; border-radius: 6px;" />
  </div>

  <div style="padding: 0 0 24px 0;">

    <h1 style="color: #1f2937; margin: 0 0 8px 0; font-size: 22px; font-weight: 700;">New application received</h1>
    <p style="color: #6b7280; margin: 0 0 24px 0; font-size: 16px;">Someone applied to one of your opportunities.</p>

    <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px 20px; margin-bottom: 16px;">
      <p style="color: #6b7280; margin: 0 0 4px 0; font-size: 13px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px;">Opportunity</p>
      <h2 style="color: #1f2937; margin: 0; font-size: 18px; font-weight: 600;">${opportunity.title}</h2>
    </div>

    <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
      <p style="color: #6b7280; margin: 0 0 12px 0; font-size: 13px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px;">Applicant</p>

      <table cellpadding="0" cellspacing="0" border="0" style="width: 100%;">
        <tr>
          <td style="vertical-align: top; width: 60px;">
            ${avatarHtml}
          </td>
          <td style="vertical-align: middle; padding-left: 12px;">
            <h3 style="color: #1f2937; margin: 0 0 8px 0; font-size: 18px; font-weight: 600;">${displayName}</h3>
            ${detailItems.length > 0 ? `<div>${detailItems.join('')}</div>` : ''}
          </td>
        </tr>
      </table>
    </div>

    <p style="margin: 0 0 8px 0;">
      <a href="${applicantsUrl}" style="color: #6d28d9; font-weight: 600; text-decoration: none;">Review applicants &rarr;</a>
    </p>

    <p style="color: #9ca3af; font-size: 14px; margin: 0;">
      <a href="${profileUrl}" style="color: #6d28d9; text-decoration: none;">View ${displayName}'s profile</a>
    </p>
  </div>

  <div style="border-top: 1px solid #e5e7eb; padding: 16px 0 0 0; text-align: left;">
    <p style="color: #9ca3af; font-size: 12px; margin: 0;">
      You're receiving this because you have a HOCKIA account.<br>
      <a href="${HOCKIA_BASE_URL}/settings" style="color: #6d28d9; text-decoration: none;">Notification settings</a>
    </p>
  </div>

</body>
</html>
  `.trim()
}

export function generateEmailText(
  applicant: ApplicantData,
  opportunity: OpportunityData,
): string {
  const displayName = applicant.full_name?.trim() || 'Player'
  
  // Build positions string
  const positions: string[] = []
  if (applicant.position) {
    positions.push(capitalizeFirst(applicant.position))
  }
  if (applicant.secondary_position && applicant.secondary_position !== applicant.position) {
    positions.push(capitalizeFirst(applicant.secondary_position))
  }
  const positionsText = positions.length > 0 ? positions.join(' • ') : null
  
  const location = applicant.base_location?.trim() || null
  
  // Mirror the HTML template: primary applicants-list CTA, secondary
  // profile CTA. See generateEmailHtml for the rationale.
  const applicantsUrl = `${HOCKIA_BASE_URL}/dashboard/opportunities/${opportunity.id}/applicants`
  const profileUrl = applicant.username
    ? `${HOCKIA_BASE_URL}/players/${applicant.username}`
    : `${HOCKIA_BASE_URL}/players/id/${applicant.id}`

  // Build text content
  const lines: string[] = [
    "New application received on HOCKIA",
    '',
    'You have a new application for one of your opportunities.',
    '',
    'OPPORTUNITY:',
    opportunity.title,
    '',
    'APPLICANT:',
    displayName,
  ]

  if (positionsText) {
    lines.push(`Position: ${positionsText}`)
  }

  if (location) {
    lines.push(`Location: ${location}`)
  }

  lines.push(
    '',
    'Review applicants:',
    applicantsUrl,
    '',
    `View ${displayName}'s profile:`,
    profileUrl,
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
 * Maximum retry attempts for transient failures
 */
const MAX_RETRIES = 2

/**
 * Delay between retries in milliseconds (exponential backoff base)
 */
const RETRY_DELAY_BASE_MS = 500

/**
 * Helper function to delay execution
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Send a single email with retry logic for transient failures
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
          'List-Unsubscribe': `<${UNSUBSCRIBE_URL}>, <mailto:team@inhockia.com?subject=Unsubscribe>`,
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
