// NOTE: This file runs on Supabase Edge Functions (Deno runtime).
declare const Deno: { env: { get(key: string): string | undefined } }
import { escapeHtml } from './html-escape.ts'
import { EMAIL_LOGO_HTML } from './email-brand.ts'

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

/**
 * Window over which one weekly batch of digest invocations spreads its sends
 * (ms). The generator inserts every recipient's queue row in one statement,
 * so the batch shares one created_at and each row fires its own webhook at
 * once. Resend allows 10 req/s; aim for 5 so the 429 retries and other mail
 * have room. A fixed 8 s window stopped fitting when batches grew past ~80
 * (122 rows on 2026-10-26: 4 digests failed with 429). The 100 s cap
 * (500 recipients) keeps the wait plus a fully retried send inside the
 * 150 s edge wall-clock limit.
 */
export const DIGEST_SENDS_PER_SECOND = 5
export const DIGEST_SPREAD_MIN_MS = 8_000
export const DIGEST_SPREAD_MAX_MS = 100_000
/** Batch size assumed when the count query fails: wide enough for today's batches. */
export const DIGEST_BATCH_FALLBACK = 150

export function digestSpreadMs(batchSize: number | null): number {
  const size = batchSize ?? DIGEST_BATCH_FALLBACK
  const ms = Math.ceil(size / DIGEST_SENDS_PER_SECOND) * 1000
  return Math.min(DIGEST_SPREAD_MAX_MS, Math.max(DIGEST_SPREAD_MIN_MS, ms))
}

export interface ProfileViewQueueRecord {
  id: string
  recipient_id: string
  unique_viewers: number
  total_views: number
  anonymous_viewers: number
  top_viewer_ids: string[]
  /** Distinct identified viewers per role, e.g. {"club":2,"player":4}. NULL on pre-upgrade rows. */
  viewers_by_role: Record<string, number> | null
  /** Identified views in the prior 7-day window. NULL on pre-upgrade rows. */
  views_prior_7d: number | null
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

// Recruiter-first display order; unknown roles are MERGED into one
// "other" bucket before labeling (never "1 other · 2 others").
const ROLE_LABELS: Record<string, [singular: string, plural: string]> = {
  club: ['club', 'clubs'],
  coach: ['coach', 'coaches'],
  player: ['player', 'players'],
  brand: ['brand', 'brands'],
  umpire: ['umpire', 'umpires'],
}
const ROLE_ORDER = ['club', 'coach', 'player', 'brand', 'umpire', 'other']

/**
 * "2 clubs · 1 coach · 4 players" from the enqueue-time role breakdown.
 * Empty string when the queue row predates the breakdown column.
 */
export function composeStatsLine(viewersByRole: Record<string, number> | null): string {
  if (!viewersByRole) return ''
  const buckets = new Map<string, number>()
  for (const [role, n] of Object.entries(viewersByRole)) {
    if (n <= 0) continue
    const key = ROLE_LABELS[role] ? role : 'other'
    buckets.set(key, (buckets.get(key) ?? 0) + n)
  }
  if (buckets.size === 0) return ''
  return ROLE_ORDER.filter((role) => buckets.has(role))
    .map((role) => {
      const n = buckets.get(role)!
      const [singular, plural] = ROLE_LABELS[role] ?? ['other', 'others']
      return `${n} ${n === 1 ? singular : plural}`
    })
    .join(' · ')
}

/**
 * Week-over-week trend from the enqueue-time prior-week count. The line is
 * SELF-CONTAINED — it states this week's total views before comparing, so
 * the direction can never contradict the headline (which counts people,
 * not views). Empty when the row predates views_prior_7d, and no
 * comparison when the prior week had nothing to compare against — never
 * invent a number we didn't measure.
 */
export function composeTrendLine(totalViews: number, viewsPrior7d: number | null): string {
  if (viewsPrior7d === null || viewsPrior7d === undefined) return ''
  const views = totalViews === 1 ? '1 profile view' : `${totalViews} profile views`
  if (viewsPrior7d === 0) return `${views} this week.`
  if (totalViews > viewsPrior7d) return `${views} this week, up from ${viewsPrior7d} the week before.`
  if (totalViews < viewsPrior7d) return `${views} this week, down from ${viewsPrior7d} the week before.`
  return `${views} this week, the same as the week before.`
}


export function generateEmailHtml(
  recipient: RecipientData,
  _viewers: ViewerProfile[],
  stats: { uniqueViewers: number; totalViews: number; anonymousViewers: number; statsLine?: string; trendLine?: string }
): string {
  const firstName = getFirstName(recipient.full_name)

  const viewCountText = stats.uniqueViewers === 1
    ? '1 person checked out your Hockia profile this week.'
    : `${stats.uniqueViewers} people checked out your Hockia profile this week.`

  const breakdownHtml = stats.statsLine
    ? `<p style="color: #6b6878; margin: 0 0 8px 0; font-size: 15px;">${escapeHtml(stats.statsLine)}</p>`
    : ''
  const trendHtml = stats.trendLine
    ? `<p style="color: #6b6878; margin: 0 0 16px 0; font-size: 15px;">${escapeHtml(stats.trendLine)}</p>`
    : ''

  // ?tab=pulse REQUIRED since Feed became the default tab (2026-07-27):
  // bare /home lands on the feed, which has no weekly-visibility card.
  const ctaUrl = `${HOCKIA_BASE_URL}/home?tab=pulse`

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #0e0b1a; max-width: 600px; margin: 0 auto; padding: 20px;">

  <div style="padding: 16px 0 24px 0; text-align: left;">
    ${EMAIL_LOGO_HTML}
  </div>

  <div style="padding: 0 0 24px 0;">

    <p style="color: #0e0b1a; margin: 0 0 8px 0; font-size: 16px;">Hi ${escapeHtml(firstName)},</p>

    <p style="color: #0e0b1a; margin: 0 0 16px 0; font-size: 16px;">${viewCountText}</p>

    ${breakdownHtml}${trendHtml}<p style="color: #6b6878; margin: 0 0 24px 0; font-size: 15px;">Log in to see who viewed your profile.</p>

    <p style="margin: 0;">
      <a href="${ctaUrl}" style="color: #6c2bd9; font-weight: 600; text-decoration: none;">See your week on Hockia &rarr;</a>
    </p>

  </div>

  <div style="border-top: 1px solid #e6e3ee; padding: 16px 0 0 0; text-align: left;">
    <p style="color: #73707c; font-size: 12px; margin: 0;">
      You're receiving this because you have a Hockia account.<br>
      <a href="${UNSUBSCRIBE_URL}" style="color: #6c2bd9; text-decoration: none;">Notification settings</a>
    </p>
  </div>

</body>
</html>`.trim()
}

export function generateEmailText(
  recipient: RecipientData,
  _viewers: ViewerProfile[],
  stats: { uniqueViewers: number; totalViews: number; anonymousViewers: number; statsLine?: string; trendLine?: string }
): string {
  const firstName = getFirstName(recipient.full_name)

  const viewCountText = stats.uniqueViewers === 1
    ? '1 person checked out your Hockia profile this week.'
    : `${stats.uniqueViewers} people checked out your Hockia profile this week.`

  // ?tab=pulse REQUIRED since Feed became the default tab (2026-07-27):
  // bare /home lands on the feed, which has no weekly-visibility card.
  const ctaUrl = `${HOCKIA_BASE_URL}/home?tab=pulse`

  const lines = [
    `Hi ${firstName},`,
    '',
    viewCountText,
    ...(stats.statsLine ? [stats.statsLine] : []),
    ...(stats.trendLine ? [stats.trendLine] : []),
    '',
    "Log in to see who's been looking and what caught their attention.",
    '',
    'See your week on Hockia:',
    ctaUrl,
    '',
    'Tip: Keep your profile up to date so others can see everything you have to offer.',
    '',
    '---',
    "You're receiving this because you're on Hockia.",
    `Manage preferences: ${UNSUBSCRIBE_URL}`
  ]

  return lines.join('\n')
}
