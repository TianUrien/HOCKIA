/**
 * Posting-quality checklist — contract with the SQL scoring in
 * 20260718150000_admin_market_digest.sql (open_quality CTE). Same 8 checks,
 * same thresholds, same floor(met*100/8) arithmetic, so the score a club
 * sees while posting equals the score the admin Market tab shows later.
 */

import { describe, it, expect } from 'vitest'
import { assessPostingQuality, type PostingQualityInput } from '@/lib/opportunityQuality'

const empty: PostingQualityInput = {
  compensation: null,
  benefits: [],
  custom_benefits: [],
  description: null,
  start_date: null,
  level_sought: null,
  application_deadline: null,
  club_has_logo: false,
}

const full: PostingQualityInput = {
  compensation: 'Stipend + accommodation',
  benefits: ['Housing', 'Flights'],
  custom_benefits: [],
  description: 'x'.repeat(300),
  start_date: '2026-08-01',
  level_sought: 'national',
  application_deadline: '2026-07-30',
  club_has_logo: true,
}

describe('assessPostingQuality', () => {
  it('scores 0 with everything missing and lists all 8 checks as missing', () => {
    const q = assessPostingQuality(empty)
    expect(q.score).toBe(0)
    expect(q.missing).toHaveLength(8)
  })

  it('scores 100 with everything present', () => {
    const q = assessPostingQuality(full)
    expect(q.score).toBe(100)
    expect(q.missing).toHaveLength(0)
  })

  it('uses floor(met*100/8) — matches the SQL integer arithmetic', () => {
    // 3 checks met → floor(300/8) = 37, same as SQL (int division).
    const q = assessPostingQuality({
      ...empty,
      compensation: 'paid',
      start_date: '2026-08-01',
      club_has_logo: true,
    })
    expect(q.score).toBe(37)
  })

  it('finds housing/flights in custom benefits, case-insensitively (SQL: lower LIKE)', () => {
    const q = assessPostingQuality({
      ...empty,
      custom_benefits: ['Shared HOUSING with teammates', 'Return FLIGHTS covered'],
    })
    expect(q.checks.find((c) => c.key === 'housing')!.met).toBe(true)
    expect(q.checks.find((c) => c.key === 'flights')!.met).toBe(true)
  })

  it('description under 300 chars does not count (SQL: length >= 300)', () => {
    const q = assessPostingQuality({ ...empty, description: 'x'.repeat(299) })
    expect(q.checks.find((c) => c.key === 'description')!.met).toBe(false)
  })
})