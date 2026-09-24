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
import { humanizeToken } from '@/lib/identity'

/** "Forward" — the position is the headline; free-text title is the fallback. */
export function roleTitle(v: { position: string | null; title: string; opportunity_type: string | null }): string {
  if (v.opportunity_type === 'player' && v.position) return humanizeToken(v.position) ?? v.title
  return v.title
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
  bonuses: { key: 'bonuses', label: 'Bonuses', icon: DollarSign, tileClass: 'bg-[#e8f7ee] text-[#15803d]', detail: 'Performance bonuses' },
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

export type ApplicationTone = 'positive' | 'amber' | 'grey' | 'neutral'
export interface ApplicationStatusPill { label: string; tone: ApplicationTone }

/**
 * Status words for My applications. "No reply · 16d" is a real status after
 * two weeks without an answer; closed outcomes keep their words in grey —
 * no shame colours.
 */
export function applicationStatusPill(
  status: string,
  appliedAt: string | null,
  roleOpen: boolean,
  now = new Date(),
): ApplicationStatusPill {
  switch (status) {
    case 'shortlisted': return { label: 'Shortlisted', tone: 'positive' }
    case 'maybe': return { label: 'Replied', tone: 'positive' }
    case 'rejected': return { label: 'Not selected', tone: 'grey' }
    case 'withdrawn': return { label: 'Withdrawn', tone: 'grey' }
    case 'no_response': return { label: 'No reply', tone: 'grey' }
    default: {
      if (!roleOpen) return { label: 'Role closed', tone: 'grey' }
      const days = appliedAt ? differenceInCalendarDays(now, new Date(appliedAt)) : 0
      if (days >= 14) return { label: `No reply · ${days}d`, tone: 'amber' }
      return { label: 'In review', tone: 'neutral' }
    }
  }
}

export const APPLICATION_TONE_CLASS: Record<ApplicationTone, string> = {
  positive: 'bg-positive-soft text-positive',
  amber: 'bg-[#fdf1e4] text-[#b45309]',
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
