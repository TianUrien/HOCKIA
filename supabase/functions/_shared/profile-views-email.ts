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

function getInitials(name: string): string {
  return name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

function getFirstName(fullName: string | null): string {
  if (!fullName?.trim()) return 'there'
  return fullName.trim().split(' ')[0]
}

function getRoleBadgeHtml(role: string | null): string {
  const roleColors: Record<string, { bg: string; text: string }> = {
    player: { bg: '#EFF6FF', text: '#2563EB' },
    coach: { bg: '#F0FDFA', text: '#0D9488' },
    club: { bg: '#FFF7ED', text: '#EA580C' },
    brand: { bg: '#FFF1F2', text: '#E11D48' },
  }
  if (!role || !roleColors[role]) return ''
  const colors = roleColors[role]
  return `<span style="display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 11px; font-weight: 600; background: ${colors.bg}; color: ${colors.text}; text-transform: capitalize; margin-left: 6px;">${role}</span>`
}

function buildViewerCardHtml(viewer: ViewerProfile): string {
  const name = viewer.full_name?.trim() || 'PLAYR member'
  const initials = getInitials(name)

  const avatarHtml = viewer.avatar_url
    ? `<img src="${viewer.avatar_url}" alt="${name}" style="width: 40px; height: 40px; border-radius: 20px; object-fit: cover;" />`
    : `<table cellpadding="0" cellspacing="0" border="0" style="width: 40px; height: 40px; border-radius: 20px; background: linear-gradient(135deg, #8026FA 0%, #924CEC 100%);">
        <tr>
          <td align="center" valign="middle" style="width: 40px; height: 40px; color: white; font-weight: bold; font-size: 14px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">${initials}</td>
        </tr>
      </table>`

  const locationHtml = viewer.base_location
    ? `<span style="color: #9ca3af; font-size: 12px;"> &middot; ${viewer.base_location}</span>`
    : ''

  return `
    <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px 16px; margin-bottom: 8px;">
      <table cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr>
          <td width="48" valign="middle">
            ${avatarHtml}
          </td>
          <td style="padding-left: 12px;" valign="middle">
            <p style="color: #1f2937; margin: 0; font-size: 15px; font-weight: 600;">
              ${name}${getRoleBadgeHtml(viewer.role)}
            </p>
            <p style="color: #6b7280; margin: 2px 0 0 0; font-size: 13px;">
              Viewed your profile${locationHtml}
            </p>
          </td>
        </tr>
      </table>
    </div>`
}

export function generateEmailHtml(
  recipient: RecipientData,
  viewers: ViewerProfile[],
  stats: { uniqueViewers: number; totalViews: number; anonymousViewers: number }
): string {
  const firstName = getFirstName(recipient.full_name)

  const heading = stats.uniqueViewers === 1
    ? `${viewers[0]?.full_name?.trim() || 'Someone'} viewed your profile`
    : `${stats.uniqueViewers} people viewed your profile`

  const subheading = stats.totalViews > stats.uniqueViewers
    ? `${stats.totalViews} total views this week`
    : 'This week'

  const viewerCards = viewers.map(buildViewerCardHtml).join('\n')

  const anonymousNote = stats.anonymousViewers > 0
    ? `<p style="color: #9ca3af; font-size: 13px; margin: 12px 0 0 0; text-align: center;">
        +${stats.anonymousViewers} anonymous ${stats.anonymousViewers === 1 ? 'viewer' : 'viewers'}
      </p>`
    : ''

  const ctaUrl = `${PLAYR_BASE_URL}/dashboard/profile?tab=profile&section=viewers`

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${heading}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9fafb;">

  <!-- Header -->
  <div style="background: linear-gradient(135deg, #8026FA 0%, #924CEC 100%); padding: 32px 24px; border-radius: 16px 16px 0 0; text-align: center;">
    <img src="https://www.oplayr.com/playr-logo-white.png" alt="PLAYR" width="120" height="29" style="height: 29px; width: 120px;" />
  </div>

  <!-- Main Content -->
  <div style="background: #ffffff; padding: 32px 24px; border-left: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">

    <h1 style="color: #1f2937; margin: 0 0 4px 0; font-size: 22px; font-weight: 700;">${heading}</h1>
    <p style="color: #6b7280; margin: 0 0 24px 0; font-size: 15px;">Hi ${firstName}, ${subheading.toLowerCase()}.</p>

    <!-- Viewer Cards -->
    <div style="margin-bottom: 16px;">
      ${viewerCards}
    </div>

    ${anonymousNote}

    <!-- CTA Button -->
    <div style="text-align: center; margin: 24px 0;">
      <a href="${ctaUrl}"
         style="display: inline-block; background: linear-gradient(135deg, #8026FA 0%, #924CEC 100%); color: #ffffff; padding: 14px 32px; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 16px;">
        See All Viewers
      </a>
    </div>

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
  viewers: ViewerProfile[],
  stats: { uniqueViewers: number; totalViews: number; anonymousViewers: number }
): string {
  const firstName = getFirstName(recipient.full_name)

  const heading = stats.uniqueViewers === 1
    ? `${viewers[0]?.full_name?.trim() || 'Someone'} viewed your profile`
    : `${stats.uniqueViewers} people viewed your profile`

  const lines = [
    heading,
    '',
    `Hi ${firstName},`,
    '',
  ]

  for (const v of viewers) {
    const name = v.full_name?.trim() || 'PLAYR member'
    const role = v.role ? ` (${v.role})` : ''
    const location = v.base_location ? ` — ${v.base_location}` : ''
    lines.push(`${name}${role}${location}`)
  }

  if (stats.anonymousViewers > 0) {
    lines.push(`+${stats.anonymousViewers} anonymous ${stats.anonymousViewers === 1 ? 'viewer' : 'viewers'}`)
  }

  if (stats.totalViews > stats.uniqueViewers) {
    lines.push('', `${stats.totalViews} total views this week`)
  }

  const ctaUrl = `${PLAYR_BASE_URL}/dashboard/profile?tab=profile&section=viewers`

  lines.push(
    '',
    'See all viewers:',
    ctaUrl,
    '',
    '---',
    "You're receiving this because you're on PLAYR.",
    `Manage preferences: ${UNSUBSCRIBE_URL}`
  )

  return lines.join('\n')
}
