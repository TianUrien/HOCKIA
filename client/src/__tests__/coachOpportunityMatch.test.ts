import { describe, it, expect } from 'vitest'
import {
  computeCoachOpportunityMatch,
  COACH_MATCH_THRESHOLD,
  type MatchCoach,
  type MatchCoachOpportunity,
} from '@/lib/coachOpportunityMatch'

const coach = (over: Partial<MatchCoach> = {}): MatchCoach => ({
  coach_specialization: 'head_coach',
  coaching_categories: ['adult_women'],
  level_target: 'competitive',
  ...over,
})

const opp = (over: Partial<MatchCoachOpportunity> = {}): MatchCoachOpportunity => ({
  position: 'head_coach',
  gender: 'Women',
  level_sought: 'competitive',
  position_required: false,
  ...over,
})

describe('computeCoachOpportunityMatch', () => {
  it('scores full alignment at 100', () => {
    expect(computeCoachOpportunityMatch(coach(), opp())).toBe(100)
  })

  it('normalizes the two specialization vocabularies (other ↔ other_coach)', () => {
    expect(
      computeCoachOpportunityMatch(
        coach({ coach_specialization: 'other' }),
        opp({ position: 'other_coach' }),
      ),
    ).toBe(100)
  })

  it('hard-excludes position_required openings the coach fails', () => {
    expect(
      computeCoachOpportunityMatch(coach(), opp({ position: 'goalkeeper_coach', position_required: true })),
    ).toBeNull()
  })

  it('never gender-excludes a coach — opposite side scores 0 on that component only', () => {
    // spec 45 + category 0 + level 25 = 70/100
    expect(computeCoachOpportunityMatch(coach(), opp({ gender: 'Men' }))).toBe(70)
  })

  it("scores the 'any' category sentinel at 75% and same-side at 50%", () => {
    expect(
      computeCoachOpportunityMatch(coach({ coaching_categories: ['any'] }), opp()),
    ).toBe(93) // 45 + 30×0.75 + 25 = 92.5 → 93
    expect(
      computeCoachOpportunityMatch(coach({ coaching_categories: ['girls'] }), opp({ gender: 'Women' })),
    ).toBe(85) // 45 + 30×0.5 + 25
  })

  it('gives Mixed openings 75% of the category weight (parity with the player scorer)', () => {
    // 45 + 30×0.75 + 25 = 92.5 → 93 — same tier as 'any', per the audit fix.
    expect(computeCoachOpportunityMatch(coach(), opp({ gender: 'Mixed' }))).toBe(93)
  })

  it('skips unknown components (honest absence) and normalizes over the known', () => {
    expect(
      computeCoachOpportunityMatch(coach({ level_target: null }), opp({ gender: null })),
    ).toBe(100) // spec only: 45/45
  })

  it('returns null when nothing is computable', () => {
    expect(
      computeCoachOpportunityMatch(
        coach({ coach_specialization: null, coaching_categories: null, level_target: null }),
        opp({ position: null, gender: null, level_sought: null }),
      ),
    ).toBeNull()
  })

  it('exposes the display threshold', () => {
    expect(COACH_MATCH_THRESHOLD).toBe(60)
  })
})
