/**
 * Interested lens (Matching Increment #2.2).
 *
 * Contract:
 *   - Applies only to the scoped role + an opportunity scope (location/
 *     start present); NOT_APPLICABLE when nothing is measurable.
 *   - Mobility primary, availability secondary (dormant when no start_date).
 *   - SOFT: mismatches score low, never filtered.
 *   - England/Scotland/Wales/NI fold to United Kingdom for matching.
 *   - Thresholds: strong ≥0.66, possible ≥0.40, low otherwise.
 */

import { describe, expect, it } from 'vitest'
import { computeInterest, interestLevelLabel } from '@/lib/interestFit'

// Stub country resolver: id → name.
const COUNTRIES: Record<number, string> = {
  30: 'Netherlands',
  48: 'Argentina',
  138: 'Afghanistan',
  185: 'United Kingdom',
}
const countryName = (id: number) => COUNTRIES[id]

const playerScopeNL = {
  targetRole: 'player',
  targetLocationCountry: 'Netherlands',
  targetStartDate: null as string | null,
  countryName,
}

const base = (over: Record<string, unknown> = {}) => ({ role: 'player' as const, ...over })

describe('computeInterest', () => {
  it('NOT_APPLICABLE when candidate is null', () => {
    expect(computeInterest(null, playerScopeNL).isApplicable).toBe(false)
  })

  it('NOT_APPLICABLE when candidate role != scope role', () => {
    expect(computeInterest(base({ role: 'coach', relocation_willingness: 'relocate' }), playerScopeNL).isApplicable).toBe(false)
  })

  it('NOT_APPLICABLE when not an opportunity scope (no location or start)', () => {
    const r = computeInterest(base({ relocation_willingness: 'relocate' }), { targetRole: 'player', countryName })
    expect(r.isApplicable).toBe(false)
  })

  it('NOT_APPLICABLE when no intent is measurable', () => {
    expect(computeInterest(base({}), playerScopeNL).isApplicable).toBe(false)
  })

  it('relocate with no country restriction → strong', () => {
    const r = computeInterest(base({ relocation_willingness: 'relocate' }), playerScopeNL)
    expect(r.isApplicable).toBe(true)
    expect(r.level).toBe('strong')
    expect(r.reasons.join(' ')).toMatch(/relocat/i)
  })

  it('relocate + opp country in open list → strong, names the country', () => {
    const r = computeInterest(base({ relocation_willingness: 'relocate', relocation_countries_open: [30, 48] }), playerScopeNL)
    expect(r.level).toBe('strong')
    expect(r.reasons.join(' ')).toMatch(/Netherlands/)
  })

  it('excluded the opportunity country → low (soft rank-down), not filtered', () => {
    const r = computeInterest(base({ relocation_willingness: 'relocate', relocation_countries_excluded: [30] }), playerScopeNL)
    expect(r.isApplicable).toBe(true) // still shown
    expect(r.level).toBe('low')
    expect(r.score).toBeLessThan(0.4)
    expect(r.reasons.join(' ')).toMatch(/Excluded/)
  })

  it('home_only + opportunity abroad → low', () => {
    const r = computeInterest(
      base({ relocation_willingness: 'home_only', home_country_id: 48 /* Argentina */ }),
      playerScopeNL,
    )
    expect(r.level).toBe('low')
    expect(r.reasons.join(' ')).toMatch(/stay in Argentina/i)
  })

  it('home_only + opportunity in home country → strong', () => {
    const r = computeInterest(
      base({ relocation_willingness: 'home_only', home_country_id: 30 /* Netherlands */ }),
      playerScopeNL,
    )
    expect(r.level).toBe('strong')
    expect(r.reasons.join(' ')).toMatch(/home country/i)
  })

  it('folds England → United Kingdom when matching', () => {
    const ukScope = { ...playerScopeNL, targetLocationCountry: 'England' }
    const r = computeInterest(base({ relocation_willingness: 'home_only', home_country_id: 185 /* United Kingdom */ }), ukScope)
    expect(r.level).toBe('strong') // England opp matches UK home
  })

  it('open_to_discuss scores below relocate', () => {
    const discuss = computeInterest(base({ relocation_willingness: 'open_to_discuss' }), playerScopeNL)
    const relocate = computeInterest(base({ relocation_willingness: 'relocate' }), playerScopeNL)
    expect(relocate.score).toBeGreaterThan(discuss.score)
  })

  it('availability: available before start → boosts; after start → caution', () => {
    const scope = { ...playerScopeNL, targetStartDate: '2026-09-01' }
    const inTime = computeInterest(base({ relocation_willingness: 'relocate', available_from: '2026-08-01' }), scope)
    const tooLate = computeInterest(base({ relocation_willingness: 'relocate', available_from: '2026-11-01' }), scope)
    expect(inTime.score).toBeGreaterThan(tooLate.score)
    expect(tooLate.reasons.join(' ')).toMatch(/after the/i)
  })

  it('availability is neutral (ignored) when the opportunity has no start date', () => {
    // Same candidate; with vs without an availability-only difference and no start date.
    const a = computeInterest(base({ relocation_willingness: 'relocate', available_from: '2030-01-01' }), playerScopeNL)
    const b = computeInterest(base({ relocation_willingness: 'relocate' }), playerScopeNL)
    expect(a.score).toBeCloseTo(b.score, 5) // available_from didn't matter without a start date
  })

  it('availability alone (no mobility intent) can make it applicable', () => {
    const scope = { ...playerScopeNL, targetStartDate: '2026-09-01' }
    const r = computeInterest(base({ available_from: '2026-08-01' }), scope)
    expect(r.isApplicable).toBe(true)
    expect(r.level).toBe('strong')
  })

  it('level labels are stable', () => {
    expect(interestLevelLabel('strong')).toBe('Strong interest')
    expect(interestLevelLabel('possible')).toBe('Possible interest')
    expect(interestLevelLabel('low')).toBe('Low interest')
  })
})
