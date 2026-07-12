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

export const HOCKIA_BASE_URL = Deno.env.get('PUBLIC_SITE_URL') ?? 'https://inhockia.com'
export const UNSUBSCRIBE_URL = `${HOCKIA_BASE_URL}/settings`

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
    ? '1 person checked out your HOCKIA profile this week.'
    : `${stats.uniqueViewers} people checked out your HOCKIA profile this week.`

  const ctaUrl = `${HOCKIA_BASE_URL}/dashboard/profile?tab=profile&section=viewers`

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

    <p style="color: #1f2937; margin: 0 0 8px 0; font-size: 16px;">Hi ${firstName},</p>

    <p style="color: #1f2937; margin: 0 0 16px 0; font-size: 16px;">${viewCountText}</p>

    <p style="color: #6b7280; margin: 0 0 24px 0; font-size: 15px;">Log in to see who viewed your profile.</p>

    <p style="margin: 0;">
      <a href="${ctaUrl}" style="color: #6d28d9; font-weight: 600; text-decoration: none;">See who viewed your profile &rarr;</a>
    </p>

  </div>

  <div style="border-top: 1px solid #e5e7eb; padding: 16px 0 0 0; text-align: left;">
    <p style="color: #9ca3af; font-size: 12px; margin: 0;">
      You're receiving this because you have a HOCKIA account.<br>
      <a href="${UNSUBSCRIBE_URL}" style="color: #6d28d9; text-decoration: none;">Notification settings</a>
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
    ? '1 person checked out your HOCKIA profile this week.'
    : `${stats.uniqueViewers} people checked out your HOCKIA profile this week.`

  const ctaUrl = `${HOCKIA_BASE_URL}/dashboard/profile?tab=profile&section=viewers`

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
    "You're receiving this because you're on HOCKIA.",
    `Manage preferences: ${UNSUBSCRIBE_URL}`
  ]

  return lines.join('\n')
}
