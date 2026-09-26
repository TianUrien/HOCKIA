/**
 * Player-facing copy and styling rules for the Opportunities screens
 * (Figma 03 Player: Opportunities v2, Opportunity detail v2, My applications,
 * Opportunities DEV NOTE). Rules that never bend: no applicant counts, no
 * match scores, no level, no reply-time estimates. Apply = solid purple;
 * Applied = tinted with a check and never re-submittable.
 */
import type { LucideIcon } from 'lucide-react'
import {
  Home, Plane, Briefcase, Shield, DollarSign, Globe, Car, Dumbbell, Utensils, GraduationCap, Target, Info,
} from 'lucide-react'
import { format, differenceInCalendarDays } from 'date-fns'
import type { Vacancy } from '@/lib/supabase'
import { compensationLabel } from '@/lib/opportunityIntent'
import { humanizeToken, positionLabel } from '@/lib/identity'
import { APPLICATION_STATUS_LABELS } from '@/lib/applicationStatus'

/** "Forward" — the position is the headline; free-text title is the fallback. */
export function roleTitle(v: { position: string | null; title: string; opportunity_type: string | null }): string {
  if (v.opportunity_type === 'player' && v.position) return humanizeToken(v.position) ?? v.title
  return v.title
}

/**
 * A role's headline: the club's title (opportunities.title) first, then the
 * position (or coaching role) · team as the secondary line — "[QA] Midfielder
 * test" over "Midfielder · Men's". No counts, fit or level, ever.
 */
export function roleHeadline(v: { position: string | null; title: string | null; opportunity_type: string | null; gender?: string | null }): { title: string; detail: string | null } {
  const pos = v.position ? positionLabel(v.position) : null
  const team = genderPill(v.gender ?? null)?.label ?? null
  const detail = [pos, team].filter(Boolean).join(' · ') || null
  const title = v.title?.trim() || detail || 'Role'
  return { title, detail }
}

export interface GenderPill { label: string; className: string }

export function genderPill(gender: string | null | undefined): GenderPill | null {
  switch (gender) {
    case 'Women': return { label: "Women's", className: 'bg-[#fce7f3] text-[#be185d]' }
    case 'Men': return { label: "Men's", className: 'bg-[#e0f2fe] text-[#0369a1]' }
    case 'Girls': return { label: 'Girls', className: 'bg-[#fce7f3] text-[#be185d]' }
    case 'Boys': return { label: 'Boys', className: 'bg-[#e0f2fe] text-[#0369a1]' }
    case 'Mixed': return { label: 'Mixed', className: 'bg-surface-grouped text-ink-1' }
    default: return null
  }
}

/**
 * The team a role is for — Men's / Women's / Mixed / Boys / Girls — on player
 * AND coach roles (a coach is hired for a team too). Desktop cards and detail
 * use this; the phone reads the same words from genderPill / roleHeadline.
 */
export function roleTeamLabel(gender: string | null | undefined): string | null {
  return genderPill(gender)?.label ?? null
}

/**
 * duration_text as the reader should see it. The column holds free text
 * ("3 months", "Season March-September") and, from the old form, bare numbers
 * ("7", "3") that meant months. A bare integer becomes "N months"; anything
 * else is trimmed and shown as written. Empty → null. Founder ruling
 * 2026-09-23: no data migration, format on display; the Post-a-role picker
 * keeps new rows clean.
 */
export function formatDurationText(raw: string | null | undefined): string | null {
  const t = raw?.trim().replace(/\s+/g, ' ') ?? ''
  if (!t) return null
  if (/^\d+$/.test(t)) {
    const n = Number(t)
    return n === 1 ? '1 month' : `${n} months`
  }
  return t
}

/** "Sep 16 · 3 months" / "Starts immediately". */
export function whenLine(v: Pick<Vacancy, 'start_date' | 'duration_text'>, now = new Date()): string {
  const parts: string[] = []
  if (v.start_date) {
    const d = new Date(v.start_date)
    if (!Number.isNaN(d.getTime())) parts.push(format(d, d.getFullYear() === now.getFullYear() ? 'MMM d' : 'MMM d, yyyy'))
  }
  const duration = formatDurationText(v.duration_text)
  if (duration) parts.push(duration)
  return parts.length ? parts.join(' · ') : 'Starts immediately'
}

/** Detail header: "Starts Sep 16, 2026 · 3 months". */
export function startsLine(v: Pick<Vacancy, 'start_date' | 'duration_text'>): string {
  const duration = formatDurationText(v.duration_text)
  if (!v.start_date) return duration ? `Starts immediately · ${duration}` : 'Starts immediately'
  const d = new Date(v.start_date)
  const when = Number.isNaN(d.getTime()) ? v.start_date : format(d, 'MMM d, yyyy')
  return duration ? `Starts ${when} · ${duration}` : `Starts ${when}`
}

/** "Posted 3 days ago · No deadline — closes when filled". */
export function postedLine(v: Pick<Vacancy, 'created_at' | 'application_deadline'>, now = new Date()): string {
  const days = differenceInCalendarDays(now, new Date(v.created_at))
  const posted = days <= 0 ? 'Posted today' : days === 1 ? 'Posted yesterday' : `Posted ${days} days ago`
  return `${posted} · ${deadlineLine(v)}`
}

export function deadlineLine(v: Pick<Vacancy, 'application_deadline'>): string {
  if (!v.application_deadline) return 'No deadline — closes when filled'
  const d = new Date(v.application_deadline)
  return Number.isNaN(d.getTime()) ? 'Apply by ' + v.application_deadline : `Apply by ${format(d, 'MMM d, yyyy')}`
}

export interface BenefitTile { key: string; label: string; icon: LucideIcon; tileClass: string; detail: string }

/** The nine package benefits (Figma Filters › Package), with the card tile tints. */
export const BENEFIT_TILES: Record<string, BenefitTile> = {
  housing: { key: 'housing', label: 'Housing', icon: Home, tileClass: 'bg-[#e5f1ff] text-[#1d4ed8]', detail: 'Provided by the club' },
  flights: { key: 'flights', label: 'Flights', icon: Plane, tileClass: 'bg-[#e0f4f9] text-[#0e7490]', detail: 'Covered' },
  job: { key: 'job', label: 'Job', icon: Briefcase, tileClass: 'bg-[#e8e7fd] text-[#4338ca]', detail: 'Work arranged alongside hockey' },
  insurance: { key: 'insurance', label: 'Insurance', icon: Shield, tileClass: 'bg-[#fee2e2] text-[#b91c1c]', detail: 'Covered by the club' },
  bonuses: { key: 'bonuses', label: 'Bonuses', icon: DollarSign, tileClass: 'bg-positive-soft text-positive', detail: 'Performance bonuses' },
  visa: { key: 'visa', label: 'Visa', icon: Globe, tileClass: 'bg-[#e0f4f9] text-[#0e7490]', detail: 'Sponsorship arranged' },
  car: { key: 'car', label: 'Car', icon: Car, tileClass: 'bg-[#fdf1e4] text-[#b45309]', detail: 'Provided by the club' },
  equipment: { key: 'equipment', label: 'Equipment', icon: Dumbbell, tileClass: 'bg-[#e6f6f4] text-[#0f766e]', detail: 'Kit and stick provided' },
  meals: { key: 'meals', label: 'Meals', icon: Utensils, tileClass: 'bg-[#fdf1e4] text-[#b45309]', detail: 'Provided by the club' },
  education: { key: 'education', label: 'Education', icon: GraduationCap, tileClass: 'bg-[#e8e7fd] text-[#4338ca]', detail: 'Study alongside hockey' },
}

export const PACKAGE_FILTER_KEYS = ['paid', 'housing', 'flights', 'job', 'insurance', 'bonuses', 'visa', 'car', 'equipment'] as const
export type PackageFilterKey = (typeof PACKAGE_FILTER_KEYS)[number]

export const PACKAGE_FILTER_LABELS: Record<PackageFilterKey, string> = {
  paid: 'Paid', housing: 'Housing', flights: 'Flights', job: 'Job', insurance: 'Insurance', bonuses: 'Bonuses', visa: 'Visa', car: 'Car', equipment: 'Equipment',
}

export const SPECIALIST_TILE = { icon: Target, tileClass: 'bg-hockia-soft text-hockia-primary' }
export const REQUIREMENT_TILE = { icon: Info, tileClass: 'bg-[#fdf1e4] text-[#b45309]' }

/** "Paid" / "Development" / "Compensation not stated". */
export function compensationText(v: Pick<Vacancy, 'compensation'>): string {
  return compensationLabel(v.compensation) ?? 'Compensation not stated'
}

export function isPaid(v: Pick<Vacancy, 'compensation'>): boolean {
  const c = (v.compensation ?? '').toLowerCase()
  return c === 'paid' || c === 'either'
}

/** Which benefits a role offers, in Figma tile order. */
export function roleBenefits(v: Pick<Vacancy, 'benefits'>): BenefitTile[] {
  const order = Object.keys(BENEFIT_TILES)
  return (v.benefits ?? [])
    .map((b) => b.toLowerCase())
    .filter((b, i, arr) => BENEFIT_TILES[b] && arr.indexOf(b) === i)
    .sort((a, b) => order.indexOf(a) - order.indexOf(b))
    .map((b) => BENEFIT_TILES[b])
}

// No amber here: amber is only for a viewer who must act (founder ruling
// 2026-09-26), and a player waiting on a club can't.
export type ApplicationTone = 'positive' | 'grey' | 'neutral'
export interface ApplicationStatusPill {
  label: string
  tone: ApplicationTone
  /** Pending for 14+ days on an open role — drives My applications'
   *  "No reply after two weeks?" hint (the pill itself stays grey). */
  waitingLong?: boolean
}

/**
 * Status words for My applications. "No reply · 16d" is a real status after
 * two weeks without an answer; it and every closed outcome are grey for the
 * player — no shame colours, no urgency the player can't act on.
 */
export function applicationStatusPill(
  status: string,
  appliedAt: string | null,
  roleOpen: boolean,
  now = new Date(),
): ApplicationStatusPill {
  const L = APPLICATION_STATUS_LABELS
  switch (status) {
    case 'shortlisted': return { label: L.shortlisted, tone: 'positive' }
    case 'maybe': return { label: L.maybe, tone: 'positive' }
    case 'rejected': return { label: L.rejected, tone: 'grey' }
    case 'withdrawn': return { label: L.withdrawn, tone: 'grey' }
    case 'no_response': return { label: L.no_response, tone: 'grey' }
    case 'filled': return { label: L.filled, tone: 'grey' }
    default: {
      if (!roleOpen) return { label: 'Role closed', tone: 'grey' }
      const days = appliedAt ? differenceInCalendarDays(now, new Date(appliedAt)) : 0
      if (days >= 14) return { label: `${L.no_response} · ${days}d`, tone: 'grey', waitingLong: true }
      return { label: L.pending, tone: 'neutral' }
    }
  }
}

/**
 * What a role page shows once the role is closed (founder 2026-09-26): the
 * role itself stays readable but greyed with a "Closed" label and no Apply.
 * An applicant sees their OWN application (status, applied date, the club's
 * note); anyone else sees "This role is closed" and a way to open roles. The
 * publisher keeps their own view. Never other applicants or counts.
 */
export type ClosedRoleView = 'open' | 'applicant' | 'visitor' | 'publisher'
export function closedRoleView(o: { isClosed: boolean; hasApplied: boolean; isPublisher: boolean }): ClosedRoleView {
  if (!o.isClosed) return 'open'
  if (o.isPublisher) return 'publisher'
  return o.hasApplied ? 'applicant' : 'visitor'
}

/**
 * The club's own decline note, as the applicant reads it. Only a note the
 * club wrote (ai_feedback.source 'club') for the CURRENT status counts —
 * never an AI explanation or a stale note from an earlier status.
 */
export function clubNoteFromFeedback(aiFeedback: unknown, status: string | null | undefined): string | null {
  if (status !== 'rejected' || !aiFeedback || typeof aiFeedback !== 'object' || Array.isArray(aiFeedback)) return null
  const fb = aiFeedback as Record<string, unknown>
  if (fb.source !== 'club' || fb.status !== 'rejected' || typeof fb.message !== 'string') return null
  return fb.message.trim() || null
}

/** "Applied Sep 3, 2026" — the full date on a closed role's application block. */
export function appliedOnLine(appliedAt: string | null | undefined): string | null {
  if (!appliedAt) return null
  const d = new Date(appliedAt)
  return Number.isNaN(d.getTime()) ? null : `Applied ${format(d, 'MMM d, yyyy')}`
}

export const APPLICATION_TONE_CLASS: Record<ApplicationTone, string> = {
  positive: 'bg-positive-soft text-positive',
  grey: 'bg-surface-grouped text-ink-2',
  neutral: 'bg-hockia-soft text-hockia-primary',
}

/** "Applied 2d" — same rule as the feed: never "ago". */
export function appliedLine(appliedAt: string | null, now = new Date()): string {
  if (!appliedAt) return ''
  const days = differenceInCalendarDays(now, new Date(appliedAt))
  if (days <= 0) return 'Applied today'
  if (days < 7) return `Applied ${days}d`
  if (days < 30) return `Applied ${Math.round(days / 7)}w`
  return `Applied ${format(new Date(appliedAt), 'MMM d')}`
}

/**
 * Application sent: the "Add a full match video" nudge only for a player who
 * has none yet (player_videos kind=full_match + player_full_game_videos
 * links). Unknown count (still loading / failed) → no nudge, so a player who
 * already has matches never sees it flash.
 */
export function showFullMatchNudge(role: string | null | undefined, fullMatchCount: number | null): boolean {
  return role === 'player' && fullMatchCount === 0
}
