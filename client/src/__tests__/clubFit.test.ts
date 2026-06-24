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

  it('confirmed category mismatch is forced grey even when other components are strong', () => {
    // A man under a women's-team scope, fully open + active + same band:
    // soft components alone would reach yellow/green, but the category
    // mismatch is disqualifying — a man can't fill a women's-team opening.
    const result = computeClubFit(
      { ...womensClub, competition_level_band: 3 },
      { ...baseFemalePlayer, playing_category: 'adult_men', competition_level_band: 3 },
    )
    expect(result.components.gender_match).toBe(0)
    expect(result.state).toBe('grey')
    // The mismatch is tagged as a caveat (drives the #5 verdict icon).
    expect(result.caveats.some((c) => /different from your team's category/i.test(c))).toBe(true)
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

  // ── Confirmed position mismatch forces grey (recruiter-trust fix) ──
  // The Arquera/Goalkeeper bug: a midfielder/defender read "Excellent" for a
  // goalkeeper scope because position was only a soft 25% signal. A CONFIRMED
  // mismatch (primary position on file, neither it nor the secondary plays the
  // sought position) is now a disqualifier — state grey — so the recruiter
  // verdict can never read Excellent/Good. Honest-absence + secondary matches
  // are deliberately NOT grey-forced. Mirrors the category-mismatch rule.
  describe('confirmed position mismatch → grey (trust fix)', () => {
    // A strong-profile candidate (open, active, right category) that WITHOUT
    // the fix lands yellow (0.45) under a position scope — proving the fix flips
    // it to grey rather than the candidate being grey for other reasons.
    const mid = { ...baseFemalePlayer, position: 'midfielder', secondary_position: 'defender' }

    // Outfield example: a confirmed mismatch is a SOFT grey ("Possible"), not a
    // hard fail. (Goalkeeper is intentionally stricter — see the specialist-rule
    // block below — so an OUTFIELD scope is used here.)
    it('forward scope + midfielder/defender (NOT required) → state grey, named caveat, no hardFail', () => {
      const r = computeClubFit(womensClub, mid, { overrideTarget: 'Women', targetPosition: 'forward' })
      expect(r.components.position_match).toBe(0)
      expect(r.state).toBe('grey') // confirmed mismatch → "Possible", was 'yellow'/Excellent before
      expect(r.hardFail).toBeFalsy() // outfield soft disqualifier (grey), not "Out of scope"
      expect(r.caveats.some((c) => /not Forward/i.test(c))).toBe(true)
    })

    it('goalkeeper scope + actual goalkeeper → NOT grey-forced (full match holds)', () => {
      const keeper = { ...baseFemalePlayer, position: 'goalkeeper', secondary_position: null }
      const r = computeClubFit(womensClub, keeper, { overrideTarget: 'Women', targetPosition: 'goalkeeper' })
      expect(r.components.position_match).toBe(1)
      expect(r.state).not.toBe('grey')
    })

    it('midfielder scope + midfielder/defender → NOT grey (primary matches)', () => {
      const r = computeClubFit(womensClub, mid, { overrideTarget: 'Women', targetPosition: 'midfielder' })
      expect(r.components.position_match).toBe(1)
      expect(r.state).not.toBe('grey')
    })

    it('defender scope + midfielder/defender → NOT grey (secondary is a partial fit)', () => {
      const r = computeClubFit(womensClub, mid, { overrideTarget: 'Women', targetPosition: 'defender' })
      expect(r.components.position_match).toBe(0.5)
      expect(r.state).not.toBe('grey')
    })

    it('honest absence (no position on file) → neutral, NOT grey-forced', () => {
      const noPos = { ...baseFemalePlayer, position: null, secondary_position: null }
      const r = computeClubFit(womensClub, noPos, { overrideTarget: 'Women', targetPosition: 'goalkeeper' })
      expect(r.state).not.toBe('grey') // missing info never buries a profile
    })

    it('no target position on the scope → mismatch logic inert (unchanged)', () => {
      const r = computeClubFit(womensClub, mid, { overrideTarget: 'Women' })
      expect(r.state).not.toBe('grey')
    })
  })

  // ── Goalkeeper specialist rule — implicit position-required ────────
  // Goalkeeper is a specialist position: a confirmed non-goalkeeper is "Out of
  // scope" (hardFail → verdict "Out of scope") for a goalkeeper scope even when
  // position is NOT a marked must-have. Outfield scopes stay flexible (soft
  // "Possible"). A secondary-keeper + honest-absence are never failed.
  describe('goalkeeper specialist rule (implicit position-required)', () => {
    const gkSoft = { overrideTarget: 'Women' as const, targetPosition: 'goalkeeper' } // positionRequired NOT set
    const midDef = { ...baseFemalePlayer, position: 'midfielder', secondary_position: 'defender' }

    it('Case 1: goalkeeper scope + midfielder/defender → Out of scope (hardFail), not just Possible', () => {
      const r = computeClubFit(womensClub, midDef, gkSoft)
      expect(r.hardFail).toBe(true)
      expect(r.state).toBe('grey')
      expect(r.hardFailReasons?.[0]).toMatch(/specialist position/i)
    })

    it('Case 2: goalkeeper scope + goalkeeper PRIMARY → valid (no hardFail, full match)', () => {
      const keeper = { ...baseFemalePlayer, position: 'goalkeeper', secondary_position: null }
      const r = computeClubFit(womensClub, keeper, gkSoft)
      expect(r.hardFail).toBeFalsy()
      expect(r.components.position_match).toBe(1)
      expect(r.state).not.toBe('grey')
    })

    it('Case 3: goalkeeper scope + goalkeeper SECONDARY → valid/partial (no hardFail)', () => {
      const secondaryKeeper = { ...baseFemalePlayer, position: 'defender', secondary_position: 'goalkeeper' }
      const r = computeClubFit(womensClub, secondaryKeeper, gkSoft)
      expect(r.hardFail).toBeFalsy()
      expect(r.components.position_match).toBe(0.5)
      expect(r.state).not.toBe('grey')
    })

    it('honest absence (no position) under a goalkeeper scope → neutral, NOT out of scope', () => {
      const noPos = { ...baseFemalePlayer, position: null, secondary_position: null }
      const r = computeClubFit(womensClub, noPos, gkSoft)
      expect(r.hardFail).toBeFalsy()
    })

    it('Case 4: DEFENDER scope + midfielder/defender → flexible match (secondary), not out of scope', () => {
      const r = computeClubFit(womensClub, midDef, { overrideTarget: 'Women', targetPosition: 'defender' })
      expect(r.hardFail).toBeFalsy()
      expect(r.components.position_match).toBe(0.5)
    })

    it('Case 5: MIDFIELDER scope + midfielder/defender → valid (primary match)', () => {
      const r = computeClubFit(womensClub, midDef, { overrideTarget: 'Women', targetPosition: 'midfielder' })
      expect(r.hardFail).toBeFalsy()
      expect(r.components.position_match).toBe(1)
    })

    it('outfield stays flexible: FORWARD scope + midfielder/defender → soft "Possible" (grey), NOT out of scope', () => {
      const r = computeClubFit(womensClub, midDef, { overrideTarget: 'Women', targetPosition: 'forward' })
      expect(r.hardFail).toBeFalsy() // outfield → never implicitly required
      expect(r.state).toBe('grey') // still a confirmed mismatch → "Possible"
    })

    it('an explicit positionRequired on an OUTFIELD scope still hard-fails (unchanged)', () => {
      const r = computeClubFit(womensClub, midDef, { overrideTarget: 'Women', targetPosition: 'forward', positionRequired: true })
      expect(r.hardFail).toBe(true)
    })
  })

  describe('specialist match (Phase 3.2) — folded into position_match', () => {
    const holder = { ...baseFemalePlayer, id: 'h', specialist_skills: ['drag_flicker', 'playmaker'] }
    const nonHolder = { ...baseFemalePlayer, id: 'n', specialist_skills: ['indoor'] }

    it('a sought specialist boosts a holder over a non-holder', () => {
      const opts = { overrideTarget: 'Women' as const, targetSpecialists: ['drag_flicker'] }
      expect(computeClubFit(womensClub, holder, opts).score)
        .toBeGreaterThan(computeClubFit(womensClub, nonHolder, opts).score)
    })

    it('specialist-only scope: holder gets full role match, non-holder zero', () => {
      const opts = { overrideTarget: 'Women' as const, targetSpecialists: ['drag_flicker'] }
      expect(computeClubFit(womensClub, holder, opts).components.position_match).toBe(1)
      expect(computeClubFit(womensClub, nonHolder, opts).components.position_match).toBe(0)
    })

    it('partial overlap scores a fraction (1 of 2 sought)', () => {
      const opts = { overrideTarget: 'Women' as const, targetSpecialists: ['drag_flicker', 'target_forward'] }
      expect(computeClubFit(womensClub, holder, opts).components.position_match).toBeCloseTo(0.5, 5)
    })

    it('position + specialist average into the role component', () => {
      const mid = { ...baseFemalePlayer, position: 'midfielder', secondary_position: null }
      const flicker = computeClubFit(womensClub, { ...mid, specialist_skills: ['drag_flicker'] }, { targetPosition: 'midfielder', targetSpecialists: ['drag_flicker'] })
      const plain = computeClubFit(womensClub, { ...mid, specialist_skills: [] }, { targetPosition: 'midfielder', targetSpecialists: ['drag_flicker'] })
      expect(flicker.components.position_match).toBe(1) // (1 position + 1 specialist)/2
      expect(plain.components.position_match).toBeCloseTo(0.5, 5) // (1 position + 0 specialist)/2
      expect(flicker.score).toBeGreaterThan(plain.score)
    })

    it('case-insensitive specialist matching', () => {
      const opts = { overrideTarget: 'Women' as const, targetSpecialists: ['DRAG_FLICKER'] }
      expect(computeClubFit(womensClub, holder, opts).components.position_match).toBe(1)
    })

    it('no specialists sought → score identical to the pre-3.2 model (no regression)', () => {
      const withField = computeClubFit(womensClub, holder, { overrideTarget: 'Women' })
      const without = computeClubFit(womensClub, { ...holder, specialist_skills: undefined }, { overrideTarget: 'Women' })
      expect(withField.score).toBeCloseTo(without.score, 5)
    })
  })

  // ── Phase 3 — MUST-HAVE hard caps ──────────────────────────────────
  // A required criterion the candidate EXPLICITLY fails forces a hard fail
  // (state grey + a reason for the verdict's Out-of-scope cap). A blank
  // candidate field stays neutral — honest absence is never a fail.
  describe('must-have hard caps (Phase 3)', () => {
    const gkScope = { overrideTarget: 'Women' as const, targetPosition: 'goalkeeper', positionRequired: true }

    it('required position + explicit mismatch → hardFail, state grey, named reason', () => {
      const r = computeClubFit(womensClub, { ...baseFemalePlayer, position: 'midfielder', secondary_position: null }, gkScope)
      expect(r.hardFail).toBe(true)
      expect(r.state).toBe('grey')
      expect(r.hardFailReasons?.[0]).toMatch(/Goalkeeper/)
    })

    it('required position but NO position on file → neutral (no hard fail)', () => {
      const r = computeClubFit(womensClub, { ...baseFemalePlayer, position: null, secondary_position: null }, gkScope)
      expect(r.hardFail).toBeFalsy()
    })

    it('required position the candidate plays → no hard fail', () => {
      const r = computeClubFit(womensClub, { ...baseFemalePlayer, position: 'goalkeeper' }, gkScope)
      expect(r.hardFail).toBeFalsy()
    })

    it('an OUTFIELD position mismatch is SOFT (no hard fail) unless positionRequired is set', () => {
      // Goalkeeper is the exception (implicit must-have); use an outfield scope here.
      const r = computeClubFit(
        womensClub,
        { ...baseFemalePlayer, position: 'midfielder', secondary_position: null },
        { overrideTarget: 'Women', targetPosition: 'forward' },
      )
      expect(r.hardFail).toBeFalsy()
    })

    const specScope = { overrideTarget: 'Women' as const, targetSpecialists: ['drag_flick'], specialistsRequired: true }

    it('required specialist + lists skills but holds none → hard fail', () => {
      const r = computeClubFit(womensClub, { ...baseFemalePlayer, specialist_skills: ['penalty_corner_defence'] }, specScope)
      expect(r.hardFail).toBe(true)
      expect(r.state).toBe('grey')
    })

    it('required specialist but NO specialist skills on file → neutral', () => {
      const r = computeClubFit(womensClub, { ...baseFemalePlayer, specialist_skills: null }, specScope)
      expect(r.hardFail).toBeFalsy()
    })

    it('required specialist the candidate holds → no hard fail', () => {
      const r = computeClubFit(womensClub, { ...baseFemalePlayer, specialist_skills: ['drag_flick'] }, specScope)
      expect(r.hardFail).toBeFalsy()
    })
  })
})
