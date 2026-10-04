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
import { differenceInCalendarDays } from 'date-fns'
import { dayFirst } from './dayFirst'
import type { Vacancy } from '@/lib/supabase'
import { compensationLabel } from '@/lib/opportunityIntent'
import { humanizeToken, positionLabel } from '@/lib/identity'
import { APPLICATION_STATUS_LABELS, ROLE_CLOSED_LABEL } from '@/lib/applicationStatus'
import { NO_REPLY_DAYS } from '@/lib/statusTone'

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

/**
 * Team / category tag. Founder ruling 2026-10-04: every category (Men's,
 * Women's, Girls, Boys, Mixed) uses the one soft-purple Tag style — no pink /
 * blue by gender.
 */
export const CATEGORY_TAG_CLASS = 'bg-brand-soft text-brand-primary'

const CATEGORY_LABELS: Record<string, string> = { Women: "Women's", Men: "Men's", Girls: 'Girls', Boys: 'Boys', Mixed: 'Mixed' }

export function genderPill(gender: string | null | undefined): GenderPill | null {
  const label = gender ? CATEGORY_LABELS[gender] : undefined
  return label ? { label, className: CATEGORY_TAG_CLASS } : null
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

/** "16 Sep · 3 months" / "Starts immediately" — dates read day first app-wide (lib/dayFirst). */
export function whenLine(v: Pick<Vacancy, 'start_date' | 'duration_text'>, now = new Date()): string {
  const parts: string[] = []
  const start = dayFirst(v.start_date, { now })
  if (start) parts.push(start)
  const duration = formatDurationText(v.duration_text)
  if (duration) parts.push(duration)
  return parts.length ? parts.join(' · ') : 'Starts immediately'
}

/** Detail header: "Starts 16 Sep 2026 · 3 months" (the header always carries the year). */
export function startsLine(v: Pick<Vacancy, 'start_date' | 'duration_text'>): string {
  const duration = formatDurationText(v.duration_text)
  if (!v.start_date) return duration ? `Starts immediately · ${duration}` : 'Starts immediately'
  const when = dayFirst(v.start_date, { year: 'always' }) ?? v.start_date
  return duration ? `Starts ${when} · ${duration}` : `Starts ${when}`
}

/**
 * When a role counts as "posted" — the SAME date on every surface (club card,
 * player detail). created_at: it never moves, and it's what Opportunities
 * "Newest" sorts by (founder ruling 2026-08-13). published_at is re-stamped on
 * every reopen, so it would make a reopened role look new to one side only.
 */
export function rolePostedAt(v: Pick<Vacancy, 'created_at'>): string {
  return v.created_at
}

/**
 * "Posted 3 days ago · No deadline — closes when filled". A CLOSED role never
 * talks about deadlines or "closes when filled": "Posted 3 days ago · Closed 26 Sep 2026".
 */
export function postedLine(v: Pick<Vacancy, 'created_at' | 'application_deadline'> & { closed_at?: string | null }, now = new Date(), closed = false): string {
  const days = differenceInCalendarDays(now, new Date(rolePostedAt(v)))
  const posted = days <= 0 ? 'Posted today' : days === 1 ? 'Posted yesterday' : `Posted ${days} days ago`
  if (closed) {
    const c = dayFirst(v.closed_at, { year: 'always' })
    return `${posted} · ${c ? `Closed ${c}` : 'Closed'}`
  }
  return `${posted} · ${deadlineLine(v)}`
}

export function deadlineLine(v: Pick<Vacancy, 'application_deadline'>): string {
  if (!v.application_deadline) return 'No deadline — closes when filled'
  return `Apply by ${dayFirst(v.application_deadline, { year: 'always' }) ?? v.application_deadline}`
}

export interface BenefitTile { key: string; label: string; icon: LucideIcon; tileClass: string; detail: string }

/** The nine package benefits (Figma Filters › Package), with the card tile tints. */
export const BENEFIT_TILES: Record<string, BenefitTile> = {
  housing: { key: 'housing', label: 'Housing', icon: Home, tileClass: 'bg-accent-blue-soft text-accent-blue-ink', detail: 'Provided by the club' },
  flights: { key: 'flights', label: 'Flights', icon: Plane, tileClass: 'bg-accent-cyan-soft text-accent-cyan-ink', detail: 'Covered' },
  job: { key: 'job', label: 'Job', icon: Briefcase, tileClass: 'bg-accent-indigo-soft text-accent-indigo-ink', detail: 'Work arranged alongside hockey' },
  insurance: { key: 'insurance', label: 'Insurance', icon: Shield, tileClass: 'bg-accent-red-soft text-status-danger-strong', detail: 'Covered by the club' },
  bonuses: { key: 'bonuses', label: 'Bonuses', icon: DollarSign, tileClass: 'bg-positive-soft text-positive', detail: 'Performance bonuses' },
  visa: { key: 'visa', label: 'Visa', icon: Globe, tileClass: 'bg-accent-cyan-soft text-accent-cyan-ink', detail: 'Sponsorship arranged' },
  car: { key: 'car', label: 'Car', icon: Car, tileClass: 'bg-hockia-soft text-hockia-primary', detail: 'Provided by the club' },
  equipment: { key: 'equipment', label: 'Equipment', icon: Dumbbell, tileClass: 'bg-accent-teal-soft-2 text-accent-teal', detail: 'Kit and stick provided' },
  meals: { key: 'meals', label: 'Meals', icon: Utensils, tileClass: 'bg-hockia-soft text-hockia-primary', detail: 'Provided by the club' },
  education: { key: 'education', label: 'Education', icon: GraduationCap, tileClass: 'bg-accent-indigo-soft text-accent-indigo-ink', detail: 'Study alongside hockey' },
}

export const PACKAGE_FILTER_KEYS = ['paid', 'housing', 'flights', 'job', 'insurance', 'bonuses', 'visa', 'car', 'equipment'] as const
export type PackageFilterKey = (typeof PACKAGE_FILTER_KEYS)[number]

export const PACKAGE_FILTER_LABELS: Record<PackageFilterKey, string> = {
  paid: 'Paid', housing: 'Housing', flights: 'Flights', job: 'Job', insurance: 'Insurance', bonuses: 'Bonuses', visa: 'Visa', car: 'Car', equipment: 'Equipment',
}

export const SPECIALIST_TILE = { icon: Target, tileClass: 'bg-hockia-soft text-hockia-primary' }
// Requirements are information, never a call to act, so the tile is neutral (amber rule).
export const REQUIREMENT_TILE = { icon: Info, tileClass: 'bg-surface-muted text-ink-2' }

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

/**
 * Package item (Figma 470:1660) as the Card / Role (541:9107) shows it:
 * Benefit (the package colours), Skill (soft brand), Requirement (neutral —
 * information, never a call to act) and Note (subtle grey, a check).
 */
export type PackageItemType = 'benefit' | 'skill' | 'requirement' | 'note'
export interface PackageItem { key: string; type: PackageItemType; label: string; icon: LucideIcon; tileClass: string }

export const PAID_TILE: BenefitTile = { key: 'paid', label: 'Paid', icon: DollarSign, tileClass: 'bg-positive-soft text-positive', detail: 'The club pays for the season' }
export const NOTE_TILE = { icon: Info, tileClass: 'bg-surface-muted text-ink-2' }
export const PACKAGE_NOT_LISTED = 'Package not listed · ask the club'
export const MAX_CARD_PACKAGE_ITEMS = 6

/**
 * Up to six package items for a role card, in reading order: pay, benefits,
 * wanted skills, then the EU passport requirement (kept even when the row is
 * full). A role with nothing listed says so instead of showing an empty row.
 */
export function rolePackageItems(
  v: Pick<Vacancy, 'compensation' | 'benefits' | 'eu_passport_required'> & { specialist_skills_wanted?: string[] | null },
  max = MAX_CARD_PACKAGE_ITEMS,
): PackageItem[] {
  const items: PackageItem[] = []
  const comp = (v.compensation ?? '').toLowerCase()
  if (comp === 'paid') items.push({ key: 'paid', type: 'benefit', label: PAID_TILE.label, icon: PAID_TILE.icon, tileClass: PAID_TILE.tileClass })
  else if (comp === 'either') items.push({ key: 'comp', type: 'note', label: 'Paid or unpaid', ...NOTE_TILE })
  else if (comp) items.push({ key: 'comp', type: 'note', label: compensationText(v), ...NOTE_TILE })
  for (const b of roleBenefits(v)) items.push({ key: b.key, type: 'benefit', label: b.label, icon: b.icon, tileClass: b.tileClass })
  for (const s of (v.specialist_skills_wanted ?? []).slice(0, 2)) {
    items.push({ key: `skill-${s}`, type: 'skill', label: humanizeToken(s) ?? s, icon: SPECIALIST_TILE.icon, tileClass: SPECIALIST_TILE.tileClass })
  }
  const requirement: PackageItem | null = v.eu_passport_required
    ? { key: 'eu-passport', type: 'requirement', label: 'EU passport', icon: REQUIREMENT_TILE.icon, tileClass: REQUIREMENT_TILE.tileClass }
    : null
  if (items.length === 0 && !requirement) return [{ key: 'not-listed', type: 'note', label: PACKAGE_NOT_LISTED, ...NOTE_TILE }]
  if (!requirement) return items.slice(0, max)
  return [...items.slice(0, max - 1), requirement]
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
    // D4 · the road after Shortlist (the player's own status only).
    case 'offered': return { label: L.offered, tone: 'positive' }
    case 'accepted': return { label: L.accepted, tone: 'positive' }
    // The player must act: purple like every next step, never amber (amber
    // is the offer's open-until in its last 5 days only).
    case 'signed_pending_confirmation': return { label: L.signed_pending_confirmation, tone: 'neutral' }
    case 'signed': return { label: L.signed, tone: 'positive' }
    case 'offer_declined': return { label: L.shortlisted, tone: 'positive' }
    default: {
      if (!roleOpen) return { label: ROLE_CLOSED_LABEL, tone: 'grey' }
      const days = appliedAt ? differenceInCalendarDays(now, new Date(appliedAt)) : 0
      // The applicant waits on the club → grey; the club sees the same
      // state in amber (lib/statusTone noReplyTone).
      if (days >= NO_REPLY_DAYS) return { label: `${L.no_response} · ${days}d`, tone: 'grey', waitingLong: true }
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

/** "Applied 3 Sep 2026" — the full date on a closed role's application block (day first, like every date). */
export function appliedOnLine(appliedAt: string | null | undefined): string | null {
  const d = dayFirst(appliedAt, { year: 'always' })
  return d ? `Applied ${d}` : null
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
  return `Applied ${dayFirst(appliedAt, { now })}`
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
