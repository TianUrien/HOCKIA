import { differenceInCalendarDays } from 'date-fns'
import { humanizeToken, roleLabel } from '@/lib/identity'

/**
 * Copy and arithmetic for the club's recruiting screens (Figma 04 Club ·
 * Opportunities 324:264, Applicants 324:411, Applicant review 326:319,
 * Decline 326:528). Everything here is CLUB-facing: fit and applicant counts
 * never reach a player surface.
 */

export const DEFAULT_EXPIRY_DAYS = 14
/** "Days left" turns amber at or below this (time-sensitive, per DEV NOTE). */
export const DAYS_LEFT_AMBER = 5

/** Days until a pending application closes: applied_at + expiry_days − today (never below 0). */
export function daysLeftToReply(appliedAt: string | null | undefined, expiryDays = DEFAULT_EXPIRY_DAYS, now = new Date()): number | null {
  if (!appliedAt) return null
  const d = new Date(appliedAt)
  if (Number.isNaN(d.getTime())) return null
  return Math.max(0, expiryDays - differenceInCalendarDays(now, d))
}

export function daysLeftLabel(days: number | null): string | null {
  if (days === null) return null
  if (days === 0) return 'Closes today'
  return days === 1 ? '1 day left' : `${days} days left`
}

export function isDaysLeftUrgent(days: number | null): boolean {
  return days !== null && days <= DAYS_LEFT_AMBER
}

export type AppStatus = 'pending' | 'shortlisted' | 'maybe' | 'rejected' | 'no_response' | 'withdrawn' | string

export interface Pipeline { toReview: number; shortlisted: number; maybe: number; declined: number; closed: number; total: number }

export function pipelineOf(statuses: AppStatus[]): Pipeline {
  const p: Pipeline = { toReview: 0, shortlisted: 0, maybe: 0, declined: 0, closed: 0, total: 0 }
  for (const s of statuses) {
    if (s === 'withdrawn') continue
    p.total += 1
    if (s === 'pending') p.toReview += 1
    else if (s === 'shortlisted') p.shortlisted += 1
    else if (s === 'maybe') p.maybe += 1
    else if (s === 'rejected') p.declined += 1
    else if (s === 'no_response') p.closed += 1
  }
  return p
}

/** "3 applicants waiting for a reply" + "The oldest closes in 5 days if you don't answer." */
export function waitingNotice(pendingAppliedAt: (string | null)[], expiryDays = DEFAULT_EXPIRY_DAYS, now = new Date()): { title: string; detail: string | null } | null {
  const dates = pendingAppliedAt.filter((d): d is string => Boolean(d))
  if (dates.length === 0) return null
  const oldest = dates.reduce((a, b) => (new Date(a) < new Date(b) ? a : b))
  const days = daysLeftToReply(oldest, expiryDays, now)
  const title = dates.length === 1 ? '1 applicant waiting for a reply' : `${dates.length} applicants waiting for a reply`
  const detail = days === null ? null
    : days === 0 ? 'The oldest closes today if you don’t answer.'
    : `The oldest closes in ${days === 1 ? '1 day' : `${days} days`} if you don’t answer.`
  return { title, detail }
}

export type FitState = 'green' | 'yellow' | 'grey'
/** Fit chip: green "Strong fit", yellow "Possible fit", grey = no chip. */
export function fitChipLabel(state: FitState | null | undefined): string | null {
  if (state === 'green') return 'Strong fit'
  if (state === 'yellow') return 'Possible fit'
  return null
}

/**
 * compute_club_fit's target: "Men" / "Women" / "Mixed" (Figma D1.2). Never a
 * raw youth value — _target_accepts_category has no Boys/Girls branch and
 * _club_level_band would band Boys against the women's league. Player roles
 * can't be youth (DB CHECK, ruling 2026-09-25); a youth coach/staff role ranks
 * against the same side's pool, like recruitingTarget in lib/postRole.
 */
export function fitTarget(gender: string | null | undefined): 'Men' | 'Women' | 'Mixed' | null {
  if (!gender) return null
  const canonical: Record<string, 'Men' | 'Women' | 'Mixed'> = { men: 'Men', women: 'Women', mixed: 'Mixed', boys: 'Men', girls: 'Women' }
  return canonical[gender.trim().toLowerCase()] ?? null
}

export interface FitComponents { gender_match?: number; competition_proximity?: number; availability?: number; recency?: number }
export interface FitRow { key: 'category' | 'open' | 'active' | 'level'; label: string; ok: boolean; detail: string }

/**
 * The four components of compute_club_fit as plain checks (DEV NOTE 327:563).
 * Level names the missing side instead of ever showing 0%.
 */
export function fitRows(c: FitComponents, ctx: {
  roleGender: string | null
  playerCategoryLabel: string | null
  firstName: string
  lastActiveDays: number | null
  playerClub: string | null
  playerLeagueKnown: boolean
  clubLeagueKnown: boolean
}): FitRow[] {
  const roleWord = ctx.roleGender ? `a ${ctx.roleGender}’s role`.replace('Mixed’s', 'Mixed') : 'this role'
  const category: FitRow = {
    key: 'category', label: 'Category', ok: (c.gender_match ?? 0) >= 1,
    detail: (c.gender_match ?? 0) >= 1
      ? `${ctx.playerCategoryLabel ?? 'Category'} — matches ${roleWord}`
      : ctx.playerCategoryLabel ? `${ctx.playerCategoryLabel} — doesn’t match ${roleWord}` : 'No playing category on the profile yet',
  }
  const open: FitRow = {
    key: 'open', label: 'Open to play', ok: (c.availability ?? 0) >= 0.6,
    detail: (c.availability ?? 0) >= 0.6 ? 'Marked available' : 'Not marked available right now',
  }
  const d = ctx.lastActiveDays
  const active: FitRow = {
    key: 'active', label: 'Active', ok: (c.recency ?? 0) > 0,
    detail: d === null ? 'No recent activity' : d <= 0 ? 'On Hockia today' : d === 1 ? 'On Hockia yesterday' : d <= 30 ? `On Hockia ${d} days ago` : 'Not on Hockia in the last month',
  }
  const prox = c.competition_proximity ?? 0
  let levelDetail: string
  if (!ctx.playerLeagueKnown) {
    levelDetail = ctx.playerClub
      ? `Can’t compare yet — plays for ${ctx.playerClub}, which has no league on Hockia.`
      : 'Can’t compare yet — no club with a league on the profile.'
  } else if (!ctx.clubLeagueKnown) {
    levelDetail = 'Can’t compare yet — your league has no level on Hockia.'
  } else if (prox >= 0.75) {
    levelDetail = 'Plays at a level close to yours'
  } else if (prox > 0) {
    levelDetail = 'Plays a little further from your level'
  } else {
    levelDetail = 'Plays at a very different level'
  }
  const level: FitRow = { key: 'level', label: 'Level', ok: prox >= 0.75, detail: levelDetail }
  return [category, open, active, level]
}

/** Short chip labels for the nine reason codes (Decline sheet, Figma 326:528). */
export const DECLINE_REASON_CHIPS: { code: string; label: string }[] = [
  { code: 'position_filled', label: 'Position filled' },
  { code: 'different_position', label: 'Different position' },
  { code: 'different_level', label: 'Different level' },
  { code: 'timing', label: 'Timing' },
  { code: 'location', label: 'Location' },
  { code: 'eligibility', label: 'Eligibility' },
  { code: 'profile_incomplete', label: 'Profile incomplete' },
  { code: 'video_missing', label: 'Video missing' },
  { code: 'other', label: 'Other' },
]

export function decisionToast(firstName: string, status: 'shortlisted' | 'maybe' | 'rejected'): string {
  return status === 'shortlisted' ? `${firstName} shortlisted` : status === 'maybe' ? `${firstName} marked maybe` : `${firstName} declined`
}

/** "Player · Midfielder · Defender" — the role line under every person row. */
export function personRoleLine(p: { role: string | null; position: string | null; secondaryPosition: string | null }): string {
  const positions = [p.position, p.secondaryPosition].filter((v, i, a): v is string => Boolean(v) && a.indexOf(v) === i).map((v) => humanizeToken(v) ?? v)
  return [roleLabel((p.role ?? 'player') as 'player'), ...positions].join(' · ')
}

