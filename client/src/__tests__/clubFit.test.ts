/**
 * Club Fit math — unit coverage of the 4 components + 3 state thresholds.
 *
 * Sprint v1 contract:
 *   - Returns NOT_APPLICABLE when viewer isn't a club, has no team
 *     category, or candidate isn't player/coach.
 *   - Missing data NEVER raises score; only lowers it.
 *   - Cross-country competition_proximity = 0 until level_band_global
 *     is curated.
 *   - State thresholds: green ≥ 0.66, yellow ≥ 0.40, grey otherwise.
 */

import { describe, expect, it } from 'vitest'
import { computeClubFit, clubFitStateLabel } from '@/lib/clubFit'

const today = new Date().toISOString()
const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString()

const womensClub = {
  role: 'club' as const,
  womens_league_division: 'Torneo Metropolitano C',
  mens_league_division: null,
  current_world_club_id: 'club-uuid',
  competition_level_band: null,
}

const baseFemalePlayer = {
  id: 'player-1',
  role: 'player' as const,
  playing_category: 'adult_women',
  current_world_club_id: 'wc-1',
  competition_level_band: null,
  open_to_play: true,
  open_to_coach: null,
  open_to_opportunities: null,
  last_active_at: today,
}

describe('computeClubFit', () => {
  it('returns NOT_APPLICABLE when viewer is null', () => {
    const result = computeClubFit(null, baseFemalePlayer)
    expect(result.isApplicable).toBe(false)
  })

  it('returns NOT_APPLICABLE when viewer is a player (not a club)', () => {
    const result = computeClubFit({ ...womensClub, role: 'player' }, baseFemalePlayer)
    expect(result.isApplicable).toBe(false)
  })

  it('returns NOT_APPLICABLE when club has no league declared', () => {
    const result = computeClubFit(
      { ...womensClub, womens_league_division: null, mens_league_division: null },
      baseFemalePlayer,
    )
    expect(result.isApplicable).toBe(false)
  })

  it('returns NOT_APPLICABLE when candidate is anything other than player', () => {
    // Sprint v1 contract: Fit chip is player-only. Coach context is
    // deferred to Sprint 2.
    const brand = computeClubFit(womensClub, { ...baseFemalePlayer, role: 'brand' })
    const coach = computeClubFit(womensClub, { ...baseFemalePlayer, role: 'coach' })
    const umpire = computeClubFit(womensClub, { ...baseFemalePlayer, role: 'umpire' })
    const club = computeClubFit(womensClub, { ...baseFemalePlayer, role: 'club' })
    expect(brand.isApplicable).toBe(false)
    expect(coach.isApplicable).toBe(false)
    expect(umpire.isApplicable).toBe(false)
    expect(club.isApplicable).toBe(false)
  })

  // ── Role-compatibility gate (target_role) ──────────────────────────
  // The active recruiting context may be scoped to a non-player
  // opportunity (e.g. a club hiring a coach). Club Fit only models
  // player↔team fit, so a coach-seeking context must yield NO fit
  // label — otherwise a matching player gets mislabelled "Possible
  // fit" for a coach opportunity (the trust bug this gate fixes).
  it('returns NOT_APPLICABLE when the context targets a non-player role (coach opportunity)', () => {
    const result = computeClubFit(womensClub, baseFemalePlayer, { targetRole: 'coach' })
    expect(result.isApplicable).toBe(false)
  })

  it('still applies when the context explicitly targets players', () => {
    const result = computeClubFit(womensClub, baseFemalePlayer, { targetRole: 'player' })
    expect(result.isApplicable).toBe(true)
  })

  it('applies when targetRole is null/absent (club/custom context = player-seeking default)', () => {
    const nullRole = computeClubFit(womensClub, baseFemalePlayer, { targetRole: null })
    const absent = computeClubFit(womensClub, baseFemalePlayer)
    expect(nullRole.isApplicable).toBe(true)
    expect(absent.isApplicable).toBe(true)
  })

  it('blocks any non-player target role, not just coach', () => {
    const umpire = computeClubFit(womensClub, baseFemalePlayer, { targetRole: 'umpire' })
    const brand = computeClubFit(womensClub, baseFemalePlayer, { targetRole: 'brand' })
    expect(umpire.isApplicable).toBe(false)
    expect(brand.isApplicable).toBe(false)
  })

  it('gender_match = 1 when player plays adult_women and club is women', () => {
    const result = computeClubFit(womensClub, baseFemalePlayer)
    expect(result.components.gender_match).toBe(1)
    expect(result.target).toBe('Women')
  })

  it('gender_match = 1 for girls + mixed against a women club', () => {
    const girls = computeClubFit(womensClub, { ...baseFemalePlayer, playing_category: 'girls' })
    const mixed = computeClubFit(womensClub, { ...baseFemalePlayer, playing_category: 'mixed' })
    expect(girls.components.gender_match).toBe(1)
    expect(mixed.components.gender_match).toBe(1)
  })

  it('gender_match = 0 when adult_men plays against a women club', () => {
    const result = computeClubFit(womensClub, { ...baseFemalePlayer, playing_category: 'adult_men' })
    expect(result.components.gender_match).toBe(0)
  })

  it('gender_match = 0 when player has no playing_category', () => {
    const result = computeClubFit(womensClub, { ...baseFemalePlayer, playing_category: null })
    expect(result.components.gender_match).toBe(0)
  })

  it('competition_proximity = 0 when both sides have null level_band (default)', () => {
    const result = computeClubFit(womensClub, baseFemalePlayer)
    expect(result.components.competition_proximity).toBe(0)
  })

  it('availability is high when open + recently active', () => {
    const result = computeClubFit(womensClub, baseFemalePlayer)
    expect(result.components.availability).toBeGreaterThanOrEqual(0.99)
  })

  it('availability is partial when open but inactive', () => {
    const result = computeClubFit(womensClub, {
      ...baseFemalePlayer,
      last_active_at: fortyDaysAgo,
    })
    // open contributes 0.6, recency at 40d ≈ 0.83 contributes 0.4*0.83 ≈ 0.33
    expect(result.components.availability).toBeGreaterThan(0.5)
    expect(result.components.availability).toBeLessThan(0.95)
  })

  it('availability is 0 when closed and inactive', () => {
    const result = computeClubFit(womensClub, {
      ...baseFemalePlayer,
      open_to_play: false,
      open_to_coach: null,
      open_to_opportunities: null,
      last_active_at: null,
    })
    expect(result.components.availability).toBe(0)
  })

  it('total score under 0.40 = grey state', () => {
    // No tier data + closed + inactive + mismatched gender ≈ 0 score.
    const result = computeClubFit(womensClub, {
      ...baseFemalePlayer,
      playing_category: 'adult_men',
      open_to_play: false,
      last_active_at: null,
    })
    expect(result.state).toBe('grey')
    expect(result.score).toBeLessThan(0.4)
  })

  it('open + active + matching gender (no tier) lands in yellow band', () => {
    // gender=0.3, availability=0.2, recency=0.1, proximity=0 → 0.6 yellow
    const result = computeClubFit(womensClub, baseFemalePlayer)
    expect(result.state).toBe('yellow')
    expect(result.score).toBeGreaterThanOrEqual(0.4)
    expect(result.score).toBeLessThan(0.66)
  })

  it('matching level_band on top pushes score into green', () => {
    // P1.2: proximity now uses level_band_global (1..10 curated, global)
    // instead of tier+country. Same band = 1.0 proximity.
    const result = computeClubFit(
      { ...womensClub, competition_level_band: 3 },
      { ...baseFemalePlayer, competition_level_band: 3 },
    )
    // proximity=0.4, gender=0.3, availability=0.2, recency=0.1 → 1.0 green
    expect(result.state).toBe('green')
    expect(result.score).toBeGreaterThanOrEqual(0.66)
    expect(result.components.competition_proximity).toBe(1)
  })

  it('cross-country with comparable level_bands now scores non-zero', () => {
    // The old tier+country model hard-zeroed cross-country comparisons.
    // P1.2's level_band_global is global, so a NL Hoofdklasse player
    // (band 1) and an AR Metro A club (band 3) compute a real
    // proximity instead of 0.
    const result = computeClubFit(
      { ...womensClub, competition_level_band: 3 }, // AR Metro A
      { ...baseFemalePlayer, competition_level_band: 1 }, // NL Hoofdklasse
    )
    // |3 - 1| = 2; 1 - 2/4 = 0.5
    expect(result.components.competition_proximity).toBe(0.5)
  })

  it('competition_proximity = 0 when either band is null', () => {
    const noViewer = computeClubFit(
      { ...womensClub, competition_level_band: null },
      { ...baseFemalePlayer, competition_level_band: 3 },
    )
    expect(noViewer.components.competition_proximity).toBe(0)
    const noCandidate = computeClubFit(
      { ...womensClub, competition_level_band: 3 },
      { ...baseFemalePlayer, competition_level_band: null },
    )
    expect(noCandidate.components.competition_proximity).toBe(0)
  })

  it('competition_proximity drops to 0 at 4+ bands apart', () => {
    // |1 - 5| = 4 → 1 - 4/4 = 0
    const result = computeClubFit(
      { ...womensClub, competition_level_band: 1 },
      { ...baseFemalePlayer, competition_level_band: 5 },
    )
    expect(result.components.competition_proximity).toBe(0)
  })

  it('clubFitStateLabel returns the locked respectful copy', () => {
    expect(clubFitStateLabel('green')).toBe('Strong fit')
    expect(clubFitStateLabel('yellow')).toBe('Possible fit')
    expect(clubFitStateLabel('grey')).toBe('Lower fit')
  })

  it('mixed-team club accepts both adult_men and adult_women', () => {
    const mixedClub = {
      ...womensClub,
      mens_league_division: 'Nacional A',
    }
    const female = computeClubFit(mixedClub, baseFemalePlayer)
    const male = computeClubFit(mixedClub, { ...baseFemalePlayer, playing_category: 'adult_men' })
    expect(female.target).toBe('Mixed')
    expect(female.components.gender_match).toBe(1)
    expect(male.components.gender_match).toBe(1)
  })

  it('reasons array always has at least one entry on applicable fits', () => {
    const result = computeClubFit(womensClub, baseFemalePlayer)
    expect(result.reasons.length).toBeGreaterThan(0)
  })

  // ── Sprint 2: overrideTarget ────────────────────────────────────
  it('overrideTarget=Women makes a Mixed club score against women rules', () => {
    // Mixed club (both leagues set) would derive target='Mixed' and
    // accept adult_men. With overrideTarget='Women' the men player
    // should no longer match.
    const mixedClub = { ...womensClub, mens_league_division: 'Nacional A' }
    const malePlayer = { ...baseFemalePlayer, playing_category: 'adult_men' }

    const noOverride = computeClubFit(mixedClub, malePlayer)
    expect(noOverride.target).toBe('Mixed')
    expect(noOverride.components.gender_match).toBe(1)

    const withOverride = computeClubFit(mixedClub, malePlayer, {
      overrideTarget: 'Women',
    })
    expect(withOverride.target).toBe('Women')
    expect(withOverride.components.gender_match).toBe(0)
  })

  it('overrideTarget rescues a club with no leagues declared', () => {
    // Without an override this would be NOT_APPLICABLE (no leagues
    // → deriveTargetCategory returns null). With an override the
    // club becomes Fit-capable.
    const emptyClub = {
      ...womensClub,
      womens_league_division: null,
      mens_league_division: null,
    }
    const noOverride = computeClubFit(emptyClub, baseFemalePlayer)
    expect(noOverride.isApplicable).toBe(false)

    const withOverride = computeClubFit(emptyClub, baseFemalePlayer, {
      overrideTarget: 'Women',
    })
    expect(withOverride.isApplicable).toBe(true)
    expect(withOverride.target).toBe('Women')
    expect(withOverride.components.gender_match).toBe(1)
  })

  it('overrideTarget=null still hides the chip for a no-league club', () => {
    const emptyClub = {
      ...womensClub,
      womens_league_division: null,
      mens_league_division: null,
    }
    const result = computeClubFit(emptyClub, baseFemalePlayer, {
      overrideTarget: null,
    })
    expect(result.isApplicable).toBe(false)
  })

  // ── Sprint 3: coach viewers ─────────────────────────────────────
  // Coaches have no profile-derived target (no league columns); they
  // rely on the active recruiting_context's overrideTarget for the
  // Fit chip to mean anything.
  const baseCoach = {
    role: 'coach' as const,
    womens_league_division: null,
    mens_league_division: null,
    current_world_club_id: 'club-uuid',
    competition_level_band: null,
  }

  it('coach viewer without override → NOT_APPLICABLE', () => {
    const result = computeClubFit(baseCoach, baseFemalePlayer)
    expect(result.isApplicable).toBe(false)
  })

  it('coach viewer with overrideTarget=Women → applicable + gender match', () => {
    const result = computeClubFit(baseCoach, baseFemalePlayer, {
      overrideTarget: 'Women',
    })
    expect(result.isApplicable).toBe(true)
    expect(result.target).toBe('Women')
    expect(result.components.gender_match).toBe(1)
  })

  it('coach viewer with overrideTarget=Men → adult_women does NOT match', () => {
    const result = computeClubFit(baseCoach, baseFemalePlayer, {
      overrideTarget: 'Men',
    })
    expect(result.isApplicable).toBe(true)
    expect(result.target).toBe('Men')
    expect(result.components.gender_match).toBe(0)
  })

  it('brand / umpire / player viewers stay NOT_APPLICABLE even with overrideTarget', () => {
    const brand = computeClubFit({ ...baseCoach, role: 'brand' }, baseFemalePlayer, { overrideTarget: 'Women' })
    const umpire = computeClubFit({ ...baseCoach, role: 'umpire' }, baseFemalePlayer, { overrideTarget: 'Women' })
    const player = computeClubFit({ ...baseCoach, role: 'player' }, baseFemalePlayer, { overrideTarget: 'Women' })
    expect(brand.isApplicable).toBe(false)
    expect(umpire.isApplicable).toBe(false)
    expect(player.isApplicable).toBe(false)
  })

  // ── Phase 2: position_match component ──────────────────────────────
  describe('position_match (Phase 2)', () => {
    const gk = { ...baseFemalePlayer, position: 'goalkeeper', secondary_position: 'defender' }

    it('is 0 and weighted out when the scope has NO target position (unchanged ranking)', () => {
      // Same candidate, with and without a (null) targetPosition → identical score.
      const withoutOpt = computeClubFit(womensClub, gk)
      const withNullPos = computeClubFit(womensClub, gk, { targetPosition: null })
      expect(withoutOpt.components.position_match).toBe(0)
      expect(withNullPos.components.position_match).toBe(0)
      expect(withNullPos.score).toBeCloseTo(withoutOpt.score, 5)
    })

    it('primary position match = 1.0 and lifts the score', () => {
      const noPos = computeClubFit(womensClub, gk)
      const matched = computeClubFit(womensClub, gk, { targetPosition: 'goalkeeper' })
      expect(matched.components.position_match).toBe(1)
      // A full position match should raise (or hold) the score vs no-position.
      expect(matched.score).toBeGreaterThanOrEqual(noPos.score)
    })

    it('secondary position match = 0.5', () => {
      const matched = computeClubFit(womensClub, gk, { targetPosition: 'defender' })
      expect(matched.components.position_match).toBe(0.5)
    })

    it('no overlap = 0 (off-position player ranks below, but is NOT filtered out)', () => {
      const matched = computeClubFit(womensClub, gk, { targetPosition: 'forward' })
      expect(matched.components.position_match).toBe(0)
      // Still applicable — soft signal, never a hard filter.
      expect(matched.isApplicable).toBe(true)
    })

    it('a goalkeeper outranks an identical non-goalkeeper for a goalkeeper scope', () => {
      const keeper = { ...baseFemalePlayer, id: 'k', position: 'goalkeeper', secondary_position: null }
      const forward = { ...baseFemalePlayer, id: 'f', position: 'forward', secondary_position: null }
      const keeperFit = computeClubFit(womensClub, keeper, { targetPosition: 'goalkeeper' })
      const forwardFit = computeClubFit(womensClub, forward, { targetPosition: 'goalkeeper' })
      expect(keeperFit.score).toBeGreaterThan(forwardFit.score)
    })

    it('matching is case-insensitive', () => {
      const matched = computeClubFit(womensClub, { ...gk, position: 'Goalkeeper' }, { targetPosition: 'goalkeeper' })
      expect(matched.components.position_match).toBe(1)
    })

    it('player without a position scores 0 under a position scope (no false credit)', () => {
      const noPosPlayer = { ...baseFemalePlayer, position: null, secondary_position: null }
      const result = computeClubFit(womensClub, noPosPlayer, { targetPosition: 'goalkeeper' })
      expect(result.components.position_match).toBe(0)
    })
  })
})
