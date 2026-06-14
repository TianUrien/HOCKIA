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

// ── Increment #4b — level + compensation alignment ──────────────────
// Band → proven rank: ≤2 elite(4), ≤4 high_performance(3), ≤7
// competitive(2), 8+ development(1). Opportunity level_sought maps
// elite4/high_performance3/competitive2/development1. Candidate
// level_target: top4/competitive2/development1/any→null.
describe('computeInterest — level alignment (#4b)', () => {
  const levelScope = (over: Record<string, unknown> = {}) => ({
    targetRole: 'player',
    targetLevel: 'competitive', // rank 2
    countryName,
    ...over,
  })

  it('a level-only scope makes the lens applicable (no location/start needed)', () => {
    const r = computeInterest(base({ proven_level_band: 6 /* competitive */ }), levelScope())
    expect(r.isApplicable).toBe(true)
  })

  it('proven level matches the opening → strong, cites "proven"', () => {
    const r = computeInterest(base({ proven_level_band: 6 /* competitive=2 */ }), levelScope())
    expect(r.level).toBe('strong')
    expect(r.reasons.join(' ')).toMatch(/proven/i)
  })

  it('proven one tier below the opening → "a step up", scores below an exact match', () => {
    const exact = computeInterest(base({ proven_level_band: 6 /* competitive=2 */ }), levelScope())
    const stepUp = computeInterest(base({ proven_level_band: 8 /* development=1 */ }), levelScope())
    expect(stepUp.score).toBeLessThan(exact.score)
    expect(stepUp.reasons.join(' ')).toMatch(/step up/i)
  })

  it('proven far above the opening → over-qualified reason', () => {
    const r = computeInterest(base({ proven_level_band: 1 /* elite=4 */ }), levelScope())
    expect(r.reasons.join(' ')).toMatch(/over-qualified/i)
  })

  it('falls back to self-declared level_target when no proven band', () => {
    const r = computeInterest(base({ level_target: 'competitive' }), levelScope())
    expect(r.isApplicable).toBe(true)
    expect(r.reasons.join(' ')).toMatch(/targeting/i)
  })

  it('PROVEN outweighs self-declared: a proven match beats a stated-only aspiration', () => {
    // Same opening (competitive). Candidate A has PROVEN competitive.
    // Candidate B only SAYS they want "top" (well above competitive).
    // Proven-anchored A must score higher — the recruiter-trust principle.
    const proven = computeInterest(base({ proven_level_band: 6 /* competitive */, level_target: 'top' }), levelScope())
    const statedOnly = computeInterest(base({ level_target: 'top' }), levelScope())
    expect(proven.score).toBeGreaterThan(statedOnly.score)
    // And the proven candidate's stated higher aspiration is surfaced, not used as the anchor.
    expect(proven.reasons.join(' ')).toMatch(/higher level/i)
  })
})

describe('computeInterest — compensation alignment (#4b)', () => {
  const compScope = (compensation: string) => ({
    targetRole: 'player',
    targetCompensation: compensation,
    countryName,
  })

  it('wants paid + paid role → strong, "paid role" reason', () => {
    const r = computeInterest(base({ opportunity_preference: 'paid' }), compScope('paid'))
    expect(r.level).toBe('strong')
    expect(r.reasons.join(' ')).toMatch(/paid role/i)
  })

  it('wants paid + unpaid/development role → low (soft), names the clash', () => {
    const r = computeInterest(base({ opportunity_preference: 'paid' }), compScope('unpaid_development'))
    expect(r.isApplicable).toBe(true) // never filtered
    expect(r.level).toBe('low')
    expect(r.reasons.join(' ')).toMatch(/wants paid/i)
  })

  it('candidate open to either → compatible regardless of the opening', () => {
    const r = computeInterest(base({ opportunity_preference: 'either' }), compScope('unpaid_development'))
    expect(r.score).toBeGreaterThanOrEqual(0.66)
  })

  it('wants development + paid role → no conflict (a plus)', () => {
    const r = computeInterest(base({ opportunity_preference: 'development' }), compScope('paid'))
    expect(r.score).toBeGreaterThanOrEqual(0.66)
  })

  // ── Phase 3 — MUST-HAVE hard caps ──────────────────────────────────
  // An EXPLICIT mismatch on a required interest criterion sets hardFail
  // (the verdict caps it to Out of scope). A blank candidate field stays
  // neutral — honest absence is never a fail.
  describe('must-have hard caps (Phase 3)', () => {
    // Local scope helper (sibling describes' levelScope/compScope aren't in
    // scope here).
    const lvlScope = (over: Record<string, unknown> = {}) => ({
      targetRole: 'player',
      targetLevel: 'competitive', // rank 2
      countryName,
      ...over,
    })

    it('required location + candidate excluded the opp country → hard fail', () => {
      const r = computeInterest(
        base({ relocation_willingness: 'relocate', relocation_countries_excluded: [30] }),
        { ...playerScopeNL, locationRequired: true },
      )
      expect(r.hardFail).toBe(true)
      expect(r.hardFailReasons?.[0]).toMatch(/Netherlands/)
    })

    it('required location + home-only candidate, opportunity elsewhere → hard fail', () => {
      const r = computeInterest(
        base({ relocation_willingness: 'home_only', home_country_id: 48 /* Argentina */ }),
        { ...playerScopeNL, locationRequired: true },
      )
      expect(r.hardFail).toBe(true)
    })

    it('excluding the opp country is SOFT (no hard fail) unless locationRequired', () => {
      const r = computeInterest(
        base({ relocation_willingness: 'relocate', relocation_countries_excluded: [30] }),
        playerScopeNL,
      )
      expect(r.hardFail).toBeFalsy()
    })

    it('required level + candidate proven below the opening → hard fail', () => {
      const r = computeInterest(base({ proven_level_band: 9 /* development = rank 1 */ }), lvlScope({ levelRequired: true }))
      expect(r.hardFail).toBe(true)
      expect(r.hardFailReasons?.[0]).toMatch(/require/i)
    })

    it('required level but the candidate has NO level on file → neutral', () => {
      const r = computeInterest(
        base({ relocation_willingness: 'relocate' }),
        lvlScope({ targetLocationCountry: 'Netherlands', levelRequired: true }),
      )
      expect(r.isApplicable).toBe(true)
      expect(r.hardFail).toBeFalsy()
    })

    it('required level + only a SELF-DECLARED level below (no proven band) → neutral, not a hard fail', () => {
      // proven outranks declared: a stated aspiration below the requirement is
      // a soft signal, not an explicit actual-level mismatch — so it must NOT
      // hard-cap to "Out of scope" (matches the AI narration + the card).
      const r = computeInterest(base({ level_target: 'development' /* rank 1, below competitive */ }), lvlScope({ levelRequired: true }))
      expect(r.isApplicable).toBe(true)
      expect(r.hardFail).toBeFalsy()
    })

    it('required compensation + wants paid for an unpaid role → hard fail', () => {
      const r = computeInterest(base({ opportunity_preference: 'paid' }), {
        targetRole: 'player',
        targetCompensation: 'unpaid_development',
        countryName,
        compensationRequired: true,
      })
      expect(r.hardFail).toBe(true)
    })

    it('required availability + available after the start → hard fail', () => {
      const r = computeInterest(base({ available_from: '2026-09-01' }), {
        ...playerScopeNL,
        targetStartDate: '2026-03-01',
        availabilityRequired: true,
      })
      expect(r.hardFail).toBe(true)
    })

    it('required availability + available before the start → no hard fail', () => {
      const r = computeInterest(base({ available_from: '2026-01-01' }), {
        ...playerScopeNL,
        targetStartDate: '2026-03-01',
        availabilityRequired: true,
      })
      expect(r.hardFail).toBeFalsy()
    })
  })
})
