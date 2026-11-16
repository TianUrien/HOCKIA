/**
 * Posting-quality checklist (Market Intelligence Phase 3).
 *
 * The SAME 8-point best-practice checklist the admin Market tab scores open
 * vacancies with — surfaced live in the club's posting flow so gaps get
 * fixed at creation time instead of diagnosed post-hoc.
 *
 * ⚠ KEEP IN SYNC with the SQL scoring in
 * supabase/migrations/20260718150000_admin_market_digest.sql
 * (open_quality CTE) — same checks, same thresholds. Checklist is
 * best-practice-based, not correlation-derived (deliberate at current
 * marketplace volume).
 *
 * Deliberately a NUDGE, not a gate: posting stays zero-friction (founder
 * growth ruling); this panel only shows what a stronger posting would add.
 */

import { tOpportunities } from '@/i18n/ns/opportunities'

export interface PostingQualityInput {
  compensation: string | null
  benefits: string[]
  custom_benefits: string[]
  description: string | null
  start_date: string | null
  level_sought: string | null
  application_deadline: string | null
  /** Whether the posting club's profile has a logo/avatar. */
  club_has_logo: boolean
}

export interface PostingQualityCheck {
  key: string
  label: string
  /** Shown when the check is unmet — why filling it helps. */
  hint: string
  met: boolean
}

export interface PostingQuality {
  /** 0–100, eight equally-weighted checks. */
  score: number
  checks: PostingQualityCheck[]
  missing: PostingQualityCheck[]
}

const hasBenefit = (input: PostingQualityInput, needle: string): boolean =>
  [...(input.benefits ?? []), ...(input.custom_benefits ?? [])]
    .some((b) => b.toLowerCase().includes(needle))

export function assessPostingQuality(input: PostingQualityInput): PostingQuality {
  const checks: PostingQualityCheck[] = [
    {
      key: 'compensation',
      label: tOpportunities('quality.compensation.label'),
      hint: tOpportunities('quality.compensation.hint'),
      met: !!input.compensation && input.compensation.trim() !== '',
    },
    {
      key: 'housing',
      label: tOpportunities('quality.housing.label'),
      hint: tOpportunities('quality.housing.hint'),
      met: hasBenefit(input, 'hous'),
    },
    {
      key: 'flights',
      label: tOpportunities('quality.flights.label'),
      hint: tOpportunities('quality.flights.hint'),
      met: hasBenefit(input, 'flight'),
    },
    {
      key: 'description',
      label: tOpportunities('quality.description.label'),
      hint: tOpportunities('quality.description.hint'),
      met: (input.description ?? '').length >= 300,
    },
    {
      key: 'start_date',
      label: tOpportunities('quality.startDate.label'),
      hint: tOpportunities('quality.startDate.hint'),
      met: !!input.start_date,
    },
    {
      key: 'level',
      label: tOpportunities('quality.level.label'),
      hint: tOpportunities('quality.level.hint'),
      met: !!input.level_sought && input.level_sought.trim() !== '',
    },
    {
      key: 'club_logo',
      label: tOpportunities('quality.clubLogo.label'),
      hint: tOpportunities('quality.clubLogo.hint'),
      met: input.club_has_logo,
    },
    {
      key: 'deadline',
      label: tOpportunities('quality.deadline.label'),
      hint: tOpportunities('quality.deadline.hint'),
      met: !!input.application_deadline,
    },
  ]

  const metCount = checks.filter((c) => c.met).length
  return {
    score: Math.floor((metCount * 100) / 8),
    checks,
    missing: checks.filter((c) => !c.met),
  }
}