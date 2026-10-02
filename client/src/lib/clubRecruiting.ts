import { differenceInCalendarDays } from 'date-fns'
import { humanizeToken, roleLabel } from '@/lib/identity'
import { NO_REPLY_DAYS, STATUS_TONE_TEXT, noReplyTone } from '@/lib/statusTone'

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

/**
 * The club owes this pending application an answer soon: it closes within
 * DAYS_LEFT_AMBER days, or it has gone NO_REPLY_DAYS (14) without a reply.
 * Club-facing only — the same "No reply · 14d+" is grey for the player
 * (lib/statusTone noReplyTone).
 */
export function isClubReplyUrgent(appliedAt: string | null | undefined, daysLeft: number | null, now = new Date()): boolean {
  if (isDaysLeftUrgent(daysLeft)) return true
  if (!appliedAt) return false
  const d = new Date(appliedAt)
  return !Number.isNaN(d.getTime()) && differenceInCalendarDays(now, d) >= NO_REPLY_DAYS
}

/** Text colour for the club's reply-by line: amber when the club must act. */
export function clubReplyLineClass(urgent: boolean): string {
  return urgent ? `font-semibold ${STATUS_TONE_TEXT[noReplyTone('club')]}` : 'text-ink-3'
}

export type AppStatus = 'pending' | 'shortlisted' | 'maybe' | 'rejected' | 'no_response' | 'withdrawn' | string

/**
 * closed = no reply, role filled and withdrawn by the applicant — the Closed
 * chip. Since the D4 re-check (2026-10-02) clubs can read withdrawn
 * applications to their own roles, so they count here and in total; they
 * stay out of every "waiting" / live count (lib/clubInbox, useScouting).
 */
export interface Pipeline { toReview: number; shortlisted: number; maybe: number; declined: number; closed: number; withdrawn: number; total: number }

export function pipelineOf(statuses: AppStatus[]): Pipeline {
  const p: Pipeline = { toReview: 0, shortlisted: 0, maybe: 0, declined: 0, closed: 0, withdrawn: 0, total: 0 }
  for (const s of statuses) {
    p.total += 1
    if (s === 'pending') p.toReview += 1
    else if (s === 'shortlisted') p.shortlisted += 1
    else if (s === 'maybe') p.maybe += 1
    else if (s === 'rejected') p.declined += 1
    else if (s === 'no_response' || s === 'filled') p.closed += 1
    else if (s === 'withdrawn') { p.closed += 1; p.withdrawn += 1 }
  }
  return p
}

/**
 * The applicants header line: "3 applied since Sep 12" — "since" is the FIRST
 * application, i.e. the real applications window (a withdrawn applicant did
 * apply, so it counts). The role's published_at is re-stamped on every reopen
 * and created_at can predate publishing (drafts), so neither describes when
 * applications came in.
 */
export function appliedSinceLine(apps: { status: AppStatus; appliedAt: string | null }[], formatDay: (iso: string) => string | null): string {
  const counted = apps
  if (!counted.length) return 'No applicants yet'
  const first = counted.map((a) => a.appliedAt).filter((x): x is string => Boolean(x)).sort()[0]
  const n = `${counted.length} applied`
  const day = first ? formatDay(first) : null
  return day ? `${n} since ${day}` : n
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

export interface FitComponents {
  gender_match?: number
  competition_proximity?: number
  availability?: number
  recency?: number
  /** Round 5 (20260930100000_club_fit_position): present only when the role has
   *  a position. 1 = primary match, 0.5 = secondary, 0 = no match. */
  position_match?: number
  role_position?: string | null
  candidate_position?: string | null
  candidate_secondary_position?: string | null
}
export interface FitRow { key: 'position' | 'category' | 'open' | 'active' | 'level'; label: string; ok: boolean; detail: string }

/** "Goalkeeper", "Head coach", "Other" (other_coach) — the role vocabulary. */
function fitPositionLabel(token: string | null | undefined): string | null {
  if (!token) return null
  if (token === 'other_coach' || token === 'other') return 'Other'
  if (token === 'strength_conditioning') return 'Strength & conditioning'
  return humanizeToken(token)
}

/**
 * The Position row (founder ruling 2026-09-27): only when the role has a
 * position. Gender-neutral, no pronouns.
 */
export function fitPositionRow(c: FitComponents): FitRow | null {
  if (typeof c.position_match !== 'number' || !c.role_position) return null
  const role = fitPositionLabel(c.role_position) ?? 'this position'
  const primary = fitPositionLabel(c.candidate_position)
  if (c.position_match >= 1) return { key: 'position', label: 'Position', ok: true, detail: `Plays ${role} — matches` }
  if (c.position_match > 0) {
    return { key: 'position', label: 'Position', ok: false, detail: `${primary ?? 'Another position'} — plays ${role} as a second position` }
  }
  return {
    key: 'position', label: 'Position', ok: false,
    detail: primary ? `${primary} — the role is for a ${role}` : `No position on the profile yet — the role is for a ${role}`,
  }
}

/** "Men’s", "Women’s", "Mixed", "Boys", "Girls" — the role's team, for Fit copy. */
export function roleTeamWord(gender: string | null | undefined): string | null {
  const g = gender?.trim().toLowerCase()
  if (g === 'men') return 'Men’s'
  if (g === 'women') return 'Women’s'
  if (g === 'mixed') return 'Mixed'
  if (g === 'boys') return 'Boys'
  if (g === 'girls') return 'Girls'
  return null
}

/**
 * A CONFIRMED miss that compute_club_fit turns into "no chip" (grey): a wrong
 * position the profile does name (round 5 — goalkeeper / position-required
 * roles), or a playing category the role is not for (round 6 — women on a
 * Men’s role, men on a Women’s role). The profile Fit card still shows then,
 * without a chip, so the recruiter sees why.
 */
export function fitHasConfirmedMiss(c: FitComponents, playerCategory: string | null | undefined): boolean {
  const wrongPosition = c.position_match === 0 && !!c.candidate_position
  const wrongCategory = (c.gender_match ?? 0) < 1 && !!playerCategory
  return wrongPosition || wrongCategory
}

/**
 * The components of compute_club_fit as plain checks (DEV NOTE 327:563):
 * Position (when the role has one) + the original four.
 * Level names the missing side instead of ever showing 0%.
 */
export function fitRows(c: FitComponents, ctx: {
  roleGender: string | null
  playerCategoryLabel: string | null
  firstName: string
  lastActiveDays: number | null
  playerClub: string | null
  playerLeagueKnown: boolean
  /** The only league on the profile is the one the player typed (never counted for level). */
  playerLeagueSelfReported?: boolean
  clubLeagueKnown: boolean
}): FitRow[] {
  const team = roleTeamWord(ctx.roleGender)
  const roleWord = team ? `a ${team} role` : 'this role'
  const category: FitRow = {
    key: 'category', label: 'Category', ok: (c.gender_match ?? 0) >= 1,
    detail: (c.gender_match ?? 0) >= 1
      ? `${ctx.playerCategoryLabel ?? 'Category'} — matches ${roleWord}`
      // Round 6: a category mismatch is a no-chip miss — say what the role is for.
      : ctx.playerCategoryLabel ? `${ctx.playerCategoryLabel} — ${team ? `the role is for ${team}` : 'doesn’t match this role'}` : 'No playing category on the profile yet',
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
  // Neutral wording — no pronouns on any club surface (founder ruling 2026-09-26).
  if (!ctx.playerLeagueKnown) {
    levelDetail = ctx.playerLeagueSelfReported
      ? 'Can’t compare yet — league is self-reported'
      : ctx.playerClub
        ? `Can’t compare yet — Club: ${ctx.playerClub} has no league on Hockia.`
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
  const position = fitPositionRow(c)
  return position ? [position, category, open, active, level] : [category, open, active, level]
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

