// NOTE: This file runs on Supabase Edge Functions (Deno runtime).
declare const Deno: { env: { get(key: string): string | undefined } }

/**
 * Shared Email Template for Friend Request Notifications
 *
 * This module contains the email generation functions used by the
 * notify-friend-request Edge Function.
 *
 * Sent when: A user sends a friend request
 * Recipient: The user receiving the friend request
 */

export const RESEND_API_URL = 'https://api.resend.com/emails'
export const SENDER_EMAIL = 'HOCKIA <team@inhockia.com>'
export const REPLY_TO_EMAIL = 'team@inhockia.com'
export const HOCKIA_BASE_URL = Deno.env.get('PUBLIC_SITE_URL') ?? 'https://inhockia.com'
export const UNSUBSCRIBE_URL = `${HOCKIA_BASE_URL}/settings`

export interface FriendshipRecord {
  id: string
  user_one: string
  user_two: string
  requester_id: string
  status: string
}

export interface FriendRequestPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE'
  table: 'profile_friendships'
  schema: 'public'
  record: FriendshipRecord
  old_record: FriendshipRecord | null
}

export interface RequesterData {
  id: string
  username: string | null
  full_name: string | null
  base_location: string | null
  avatar_url: string | null
  is_test_account: boolean
  /** 'player' | 'coach' | 'club' | 'brand' | 'umpire' — determines the public profile path.
   * Null/unknown falls back to /players/ (legacy shared route for player + coach). */
  role: string | null
}

/**
 * Map a requester to the correct public profile path for the friend-request
 * email. Umpires live at /umpires/, clubs at /clubs/, everyone else (player,
 * coach, brand without a slug) falls back to /players/.
 */
export function buildRequesterProfileUrl(
  requester: Pick<RequesterData, 'id' | 'username' | 'role'>,
  baseUrl: string
): string {
  const slug =
    requester.role === 'umpire' ? 'umpires' :
    requester.role === 'club' ? 'clubs' :
    'players'
  return requester.username
    ? `${baseUrl}/${slug}/${requester.username}`
    : `${baseUrl}/${slug}/id/${requester.id}`
}

export interface RecipientData {
  id: string
  email: string
  full_name: string | null
  is_test_account: boolean
  notify_friends: boolean
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function generateEmailHtml(requester: RequesterData): string {
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

  const locationHtml = location
    ? `<span style="display: inline-block; background: #f3f4f6; padding: 4px 12px; border-radius: 16px; font-size: 14px; color: #374151; margin-top: 8px;">\u{1F4CD} ${location}</span>`
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

    <h1 style="color: #1f2937; margin: 0 0 8px 0; font-size: 22px; font-weight: 700;">New friend request</h1>
    <p style="color: #6b7280; margin: 0 0 24px 0; font-size: 16px;">Someone wants to connect with you on HOCKIA.</p>

    <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px 20px; margin-bottom: 24px;">
      <table cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr>
          <td width="56" valign="top">
            ${avatarHtml}
          </td>
          <td style="padding-left: 12px;" valign="middle">
            <p style="color: #1f2937; margin: 0; font-size: 18px; font-weight: 600;">${displayName}</p>
            ${locationHtml}
          </td>
        </tr>
      </table>
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

export function generateEmailText(requester: RequesterData): string {
  const displayName = requester.full_name?.trim() || 'A HOCKIA member'
  const location = requester.base_location?.trim() || null

  const profileUrl = buildRequesterProfileUrl(requester, HOCKIA_BASE_URL)

  const lines = [
    'New Friend Request on HOCKIA',
    '',
    `${displayName} wants to connect with you on HOCKIA.`,
  ]

  if (location) {
    lines.push(`Location: ${location}`)
  }

  lines.push(
    '',
    'View their request:',
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
