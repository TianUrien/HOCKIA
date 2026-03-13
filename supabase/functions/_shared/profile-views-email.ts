// NOTE: This file runs on Supabase Edge Functions (Deno runtime).
declare const Deno: { env: { get(key: string): string | undefined } }

/**
 * Shared Email Template for Profile View Digest Notifications
 *
 * This module contains the email generation functions used by the
 * notify-profile-views Edge Function.
 *
 * Sent when: A user has received profile views in the last 24 hours
 * Recipient: The user whose profile was viewed
 */

export const PLAYR_BASE_URL = Deno.env.get('PUBLIC_SITE_URL') ?? 'https://oplayr.com'
export const UNSUBSCRIBE_URL = `${PLAYR_BASE_URL}/settings`

export interface ProfileViewQueueRecord {
  id: string
  recipient_id: string
  unique_viewers: number
  total_views: number
  anonymous_viewers: number
  top_viewer_ids: string[]
  processed_at: string | null
  created_at: string
}

export interface ProfileViewWebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE'
  table: 'profile_view_email_queue'
  schema: 'public'
  record: ProfileViewQueueRecord
  old_record: ProfileViewQueueRecord | null
}

export interface RecipientData {
  id: string
  email: string
  full_name: string | null
  is_test_account: boolean
  notify_profile_views: boolean
}

export interface ViewerProfile {
  id: string
  full_name: string | null
  role: string | null
  avatar_url: string | null
  base_location: string | null
}

function getFirstName(fullName: string | null): string {
  if (!fullName?.trim()) return 'there'
  return fullName.trim().split(' ')[0]
}


export function generateEmailHtml(
  recipient: RecipientData,
  _viewers: ViewerProfile[],
  stats: { uniqueViewers: number; totalViews: number; anonymousViewers: number }
): string {
  const firstName = getFirstName(recipient.full_name)

  const viewCountText = stats.uniqueViewers === 1
    ? '1 person checked out your PLAYR profile this week.'
    : `${stats.uniqueViewers} people checked out your PLAYR profile this week.`

  const ctaUrl = `${PLAYR_BASE_URL}/dashboard/profile?tab=profile&section=viewers`

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${stats.uniqueViewers === 1 ? 'Someone viewed your PLAYR profile' : `${stats.uniqueViewers} people viewed your PLAYR profile`}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9fafb;">

  <!-- Header -->
  <div style="background: linear-gradient(135deg, #8026FA 0%, #924CEC 100%); padding: 32px 24px; border-radius: 16px 16px 0 0; text-align: center;">
    <img src="https://www.oplayr.com/playr-logo-white.png" alt="PLAYR" width="120" height="29" style="height: 29px; width: 120px;" />
  </div>

  <!-- Main Content -->
  <div style="background: #ffffff; padding: 32px 24px; border-left: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">

    <p style="color: #1f2937; margin: 0 0 8px 0; font-size: 16px;">Hi ${firstName},</p>

    <p style="color: #1f2937; margin: 0 0 16px 0; font-size: 16px;">${viewCountText}</p>

    <p style="color: #6b7280; margin: 0 0 24px 0; font-size: 15px;">Log in to see who's been looking and what caught their attention.</p>

    <!-- CTA Button -->
    <div style="text-align: center; margin: 24px 0;">
      <a href="${ctaUrl}"
         style="display: inline-block; background: linear-gradient(135deg, #8026FA 0%, #924CEC 100%); color: #ffffff; padding: 14px 32px; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 16px;">
        See Who Viewed Your Profile
      </a>
    </div>

    <p style="color: #9ca3af; font-size: 13px; margin: 24px 0 0 0; text-align: center; font-style: italic;">
      Tip: Keep your profile up to date so others can see everything you have to offer.
    </p>

  </div>

  <!-- Footer -->
  <div style="background: #f3f4f6; padding: 20px 24px; border-radius: 0 0 16px 16px; border: 1px solid #e5e7eb; border-top: none; text-align: center;">
    <p style="color: #9ca3af; font-size: 12px; margin: 0;">
      You're receiving this because you're on PLAYR.<br>
      <a href="${UNSUBSCRIBE_URL}" style="color: #8026FA; text-decoration: none;">Manage notification preferences</a>
    </p>
  </div>

</body>
</html>`.trim()
}

export function generateEmailText(
  recipient: RecipientData,
  _viewers: ViewerProfile[],
  stats: { uniqueViewers: number; totalViews: number; anonymousViewers: number }
): string {
  const firstName = getFirstName(recipient.full_name)

  const viewCountText = stats.uniqueViewers === 1
    ? '1 person checked out your PLAYR profile this week.'
    : `${stats.uniqueViewers} people checked out your PLAYR profile this week.`

  const ctaUrl = `${PLAYR_BASE_URL}/dashboard/profile?tab=profile&section=viewers`

  const lines = [
    `Hi ${firstName},`,
    '',
    viewCountText,
    '',
    "Log in to see who's been looking and what caught their attention.",
    '',
    'See Who Viewed Your Profile:',
    ctaUrl,
    '',
    'Tip: Keep your profile up to date so others can see everything you have to offer.',
    '',
    '---',
    "You're receiving this because you're on PLAYR.",
    `Manage preferences: ${UNSUBSCRIBE_URL}`
  ]

  return lines.join('\n')
}
