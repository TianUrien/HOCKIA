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
      label: 'Compensation',
      hint: 'Players filter hard on this — even a range beats silence.',
      met: !!input.compensation && input.compensation.trim() !== '',
    },
    {
      key: 'housing',
      label: 'Housing',
      hint: 'The #1 question for relocating players.',
      met: hasBenefit(input, 'hous'),
    },
    {
      key: 'flights',
      label: 'Flights',
      hint: 'Signals you support international recruits.',
      met: hasBenefit(input, 'flight'),
    },
    {
      key: 'description',
      label: 'Rich description (300+ chars)',
      hint: 'Tell players about the team, the season, the ambition.',
      met: (input.description ?? '').length >= 300,
    },
    {
      key: 'start_date',
      label: 'Start date',
      hint: 'Lets players judge whether the timing works.',
      met: !!input.start_date,
    },
    {
      key: 'level',
      label: 'Level sought',
      hint: 'Saves everyone mismatched applications.',
      met: !!input.level_sought && input.level_sought.trim() !== '',
    },
    {
      key: 'club_logo',
      label: 'Club logo',
      hint: 'Postings with branding look real and get more clicks.',
      met: input.club_has_logo,
    },
    {
      key: 'deadline',
      label: 'Application deadline',
      hint: 'Creates urgency and sets expectations.',
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