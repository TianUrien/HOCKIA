// NOTE: This file runs on Supabase Edge Functions (Deno runtime).
declare const Deno: { env: { get(key: string): string | undefined } }

/**
 * Shared Email Template for Reference Request Notifications
 *
 * This module contains the email generation functions used by the
 * notify-reference-request Edge Function.
 *
 * Sent when: A user requests a reference from someone
 * Recipient: The user asked to write the reference (reference_id)
 */

export const RESEND_API_URL = 'https://api.resend.com/emails'
export const SENDER_EMAIL = 'HOCKIA <team@inhockia.com>'
export const REPLY_TO_EMAIL = 'team@inhockia.com'
export const HOCKIA_BASE_URL = Deno.env.get('PUBLIC_SITE_URL') ?? 'https://inhockia.com'
export const UNSUBSCRIBE_URL = `${HOCKIA_BASE_URL}/settings`

export interface ReferenceRecord {
  id: string
  requester_id: string
  reference_id: string
  status: string
  relationship_type: string
  request_note: string | null
}

export interface ReferenceRequestPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE'
  table: 'profile_references'
  schema: 'public'
  record: ReferenceRecord
  old_record: ReferenceRecord | null
}

export interface RequesterData {
  id: string
  username: string | null
  full_name: string | null
  base_location: string | null
  avatar_url: string | null
  is_test_account: boolean
  /** 'player' | 'coach' | 'umpire' — determines the public profile path.
   * Null fallback routes to /players/ (legacy behavior for pre-role-aware data). */
  role: string | null
}

/**
 * Map a requester to the correct public profile path.
 *
 * request_reference currently allows player / coach / umpire. Coaches still
 * live on /players/ (legacy shared route). Umpires have their own /umpires/
 * tree. Any other role defaults to /players/ as a defensive fallback.
 */
export function buildRequesterProfileUrl(
  requester: Pick<RequesterData, 'id' | 'username' | 'role'>,
  baseUrl: string
): string {
  const slug = requester.role === 'umpire' ? 'umpires' : 'players'
  return requester.username
    ? `${baseUrl}/${slug}/${requester.username}`
    : `${baseUrl}/${slug}/id/${requester.id}`
}

export interface RecipientData {
  id: string
  email: string
  full_name: string | null
  is_test_account: boolean
  notify_references: boolean
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
  requester: RequesterData,
  relationshipType: string,
  requestNote: string | null
): string {
  const displayName = requester.full_name?.trim() || 'A HOCKIA member'
  const location = requester.base_location?.trim() || null

  const profileUrl = buildRequesterProfileUrl(requester, HOCKIA_BASE_URL)

  const initials = getInitials(displayName)

  const avatarHtml = requester.avatar_url
    ? `<img src="${requester.avatar_url}" alt="${displayName}" style="width: 48px; height: 48px; border-radius: 24px;" />`
    : `<table cellpadding="0" cellspacing="0" border="0" style="width: 48px; height: 48px; border-radius: 24px; background: linear-gradient(135deg, #8026FA 0%, #924CEC 100%);">
        <tr>
          <td align="center" valign="middle" style="width: 48px; height: 48px; color: white; font-weight: bold; font-size: 16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">${initials}</td>
        </tr>
      </table>`

  const detailItems: string[] = []

  detailItems.push(
    `<span style="display: inline-block; background: #f3f4f6; padding: 4px 12px; border-radius: 16px; font-size: 14px; color: #374151; margin-right: 8px; margin-bottom: 8px;">${relationshipType}</span>`
  )

  if (location) {
    detailItems.push(
      `<span style="display: inline-block; background: #f3f4f6; padding: 4px 12px; border-radius: 16px; font-size: 14px; color: #374151; margin-right: 8px; margin-bottom: 8px;">\u{1F4CD} ${location}</span>`
    )
  }

  const requestNoteHtml = requestNote?.trim()
    ? `
    <div style="background: #fefce8; border: 1px solid #fde68a; border-radius: 8px; padding: 12px 16px; margin-top: 12px;">
      <p style="color: #92400e; margin: 0 0 4px 0; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">Message from ${displayName}</p>
      <p style="color: #78350f; margin: 0; font-size: 14px; line-height: 1.5;">${requestNote.trim()}</p>
    </div>`
    : ''

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">

  <div style="padding: 16px 0 24px 0; text-align: left;">
    <img src="https://www.inhockia.com/hockia-logo-white.png" alt="HOCKIA" width="100" height="24" style="height: 24px; width: 100px; background: #8026FA; padding: 8px 12px; border-radius: 6px;" />
  </div>

  <div style="padding: 0 0 24px 0;">

    <h1 style="color: #1f2937; margin: 0 0 8px 0; font-size: 22px; font-weight: 700;">Reference request</h1>
    <p style="color: #6b7280; margin: 0 0 24px 0; font-size: 16px;">A HOCKIA member has asked you to write a reference for them.</p>

    <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px 20px; margin-bottom: 24px;">
      <table cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr>
          <td width="56" valign="top">
            ${avatarHtml}
          </td>
          <td style="padding-left: 12px;" valign="middle">
            <p style="color: #1f2937; margin: 0 0 4px 0; font-size: 18px; font-weight: 600;">${displayName}</p>
            <div>
              ${detailItems.join('\n              ')}
            </div>
          </td>
        </tr>
      </table>
      ${requestNoteHtml}
    </div>

    <p style="margin: 0 0 8px 0;">
      <a href="${HOCKIA_BASE_URL}/dashboard/profile?tab=friends&section=requests" style="color: #8026FA; font-weight: 600; text-decoration: none;">View request &rarr;</a>
    </p>

    <p style="color: #9ca3af; font-size: 14px; margin: 0;">
      <a href="${profileUrl}" style="color: #8026FA; text-decoration: none;">View their profile</a> to learn more.
    </p>
  </div>

  <div style="border-top: 1px solid #e5e7eb; padding: 16px 0 0 0; text-align: left;">
    <p style="color: #9ca3af; font-size: 12px; margin: 0;">
      You're receiving this because you have a HOCKIA account.<br>
      <a href="${UNSUBSCRIBE_URL}" style="color: #8026FA; text-decoration: none;">Notification settings</a>
    </p>
  </div>

</body>
</html>`
}

export function generateEmailText(
  requester: RequesterData,
  relationshipType: string,
  requestNote: string | null
): string {
  const displayName = requester.full_name?.trim() || 'A HOCKIA member'
  const location = requester.base_location?.trim() || null

  const profileUrl = buildRequesterProfileUrl(requester, HOCKIA_BASE_URL)

  const lines = [
    'Reference Request on HOCKIA',
    '',
    `${displayName} has asked you to write a reference for them.`,
    `Relationship: ${relationshipType}`,
  ]

  if (location) {
    lines.push(`Location: ${location}`)
  }

  if (requestNote?.trim()) {
    lines.push('', `Message: "${requestNote.trim()}"`)
  }

  lines.push(
    '',
    'View the request:',
    `${HOCKIA_BASE_URL}/dashboard/profile?tab=friends&section=requests`,
    '',
    'View their profile:',
    profileUrl,
    '',
    '---',
    "You're receiving this because you're on HOCKIA.",
    `Manage preferences: ${UNSUBSCRIBE_URL}`
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

const MAX_RETRIES = 2
const RETRY_DELAY_BASE_MS = 500

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

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
