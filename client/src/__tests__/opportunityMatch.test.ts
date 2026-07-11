import { describe, it, expect } from 'vitest'
import {
  computeOpportunityMatch,
  MATCH_THRESHOLD,
  type MatchPlayer,
  type MatchOpportunity,
} from '@/lib/opportunityMatch'

/**
 * The Q4 rule-based match % — transparent position/category/level weights,
 * honest-absence (unknown components are skipped, not zeroed), and the two
 * hard exclusions that mirror the apply-eligibility trigger.
 */

const player = (overrides: Partial<MatchPlayer> = {}): MatchPlayer => ({
  position: 'midfielder',
  secondary_position: 'forward',
  playing_category: 'adult_women',
  gender: null,
  level_target: 'competitive',
  ...overrides,
})

const opp = (overrides: Partial<MatchOpportunity> = {}): MatchOpportunity => ({
  position: 'midfielder',
  gender: 'Women',
  level_sought: 'competitive',
  position_required: false,
  ...overrides,
})

describe('computeOpportunityMatch', () => {
  it('scores a perfect position + category + level alignment at 100', () => {
    expect(computeOpportunityMatch(player(), opp())).toBe(100)
  })

  it('gives secondary-position matches partial position credit', () => {
    // 40×0.6 + 35 + 25 = 84
    expect(computeOpportunityMatch(player(), opp({ position: 'forward' }))).toBe(84)
  })

  it('scores a position mismatch as 0 on that component (not excluded) when not required', () => {
    // 0 + 35 + 25 = 60
    expect(computeOpportunityMatch(player(), opp({ position: 'goalkeeper' }))).toBe(60)
  })

  it('hard-excludes a position_required opening the player fails', () => {
    expect(
      computeOpportunityMatch(player(), opp({ position: 'goalkeeper', position_required: true })),
    ).toBeNull()
  })

  it('hard-excludes opposite-side openings (could not even apply)', () => {
    expect(computeOpportunityMatch(player(), opp({ gender: 'Men' }))).toBeNull()
    expect(computeOpportunityMatch(player(), opp({ gender: 'Boys' }))).toBeNull()
    expect(
      computeOpportunityMatch(player({ playing_category: 'adult_men' }), opp({ gender: 'Girls' })),
    ).toBeNull()
  })

  it('gives Mixed openings 75% of the category weight', () => {
    // 40 + 35×0.75 + 25 = 91.25 → 91
    expect(computeOpportunityMatch(player(), opp({ gender: 'Mixed' }))).toBe(91)
  })

  it('gives same-side different-age-band 50% of the category weight', () => {
    // girls player, Women opening: 40 + 35×0.5 + 25 = 82.5 → 83
    expect(
      computeOpportunityMatch(player({ playing_category: 'girls' }), opp({ gender: 'Women' })),
    ).toBe(83)
  })

  it('falls back to the legacy gender column when playing_category is unset', () => {
    expect(
      computeOpportunityMatch(player({ playing_category: null, gender: 'Women' }), opp()),
    ).toBe(100)
    expect(
      computeOpportunityMatch(player({ playing_category: null, gender: 'male' }), opp({ gender: 'Women' })),
    ).toBeNull()
  })

  it('scores level distance 1 at 60% and distance ≥2 at 20% of the level weight', () => {
    // competitive(2) vs high_performance(3): 40 + 35 + 25×0.6 = 90
    expect(computeOpportunityMatch(player(), opp({ level_sought: 'high_performance' }))).toBe(90)
    // development(1) vs elite(4): 40 + 35 + 25×0.2 = 80
    expect(
      computeOpportunityMatch(player({ level_target: 'development' }), opp({ level_sought: 'elite' })),
    ).toBe(80)
    // top(4) aligns with elite(4)
    expect(
      computeOpportunityMatch(player({ level_target: 'top' }), opp({ level_sought: 'elite' })),
    ).toBe(100)
  })

  it('skips unknown components and normalizes over what is known (honest absence)', () => {
    // Only position known on the opening: 40/40 → 100
    expect(
      computeOpportunityMatch(player(), opp({ gender: null, level_sought: null })),
    ).toBe(100)
    // "any"/unset level target → level skipped, not penalized
    expect(
      computeOpportunityMatch(player({ level_target: null }), opp()),
    ).toBe(100)
    expect(
      computeOpportunityMatch(player({ level_target: 'any' }), opp()),
    ).toBe(100)
  })

  it('returns null when NO component is computable — never a fabricated %', () => {
    expect(
      computeOpportunityMatch(
        player({ position: null, secondary_position: null, playing_category: null, gender: null, level_target: null }),
        opp({ position: null, gender: null, level_sought: null }),
      ),
    ).toBeNull()
  })

  it('exposes the §C display threshold', () => {
    expect(MATCH_THRESHOLD).toBe(60)
  })
})
