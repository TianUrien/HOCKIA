import { normalizeSpec } from './coachFit'
import { isOpenToAny, opportunityGenderToPlayingCategory } from './hockeyCategories'
import { LEVEL_RANK, candidateLevelRank } from './opportunityIntent'

/**
 * Coach → coach-opportunity match % for the Pulse "Coaching roles for you"
 * rail (Home V2 Phase 3). Same philosophy as lib/opportunityMatch.ts (the
 * player scorer): transparent rule-based components, unknowns SKIPPED not
 * zeroed (honest absence), % shown only ≥ threshold.
 *
 * Components:
 *   specialization  45  profile.coach_specialization vs opportunity.position
 *                       (coach enum values; normalizeSpec aligns the two
 *                       vocabularies). Exact 1.0 / mismatch 0.
 *   category        30  coaching_categories vs opportunity.gender — 'any'
 *                       sentinel 0.75, exact category 1.0, some-category-
 *                       same-side 0.5. NO hard gender exclusion: coach
 *                       opportunities are never gender-gated (a coach's own
 *                       identity doesn't restrict which team they coach —
 *                       mirrors checkOpportunityEligibility Rule B).
 *   level           25  |level_sought − level_target|: 0→1.0 / 1→0.6 / ≥2→0.2
 *
 * HARD EXCLUSION (null): position_required opening whose coach position
 * doesn't match the coach's specialization — mirrors the recruiter's
 * out-of-scope verdict.
 */

export interface MatchCoach {
  coach_specialization: string | null
  coaching_categories: string[] | null
  level_target: string | null
}

export interface MatchCoachOpportunity {
  /** opportunity_position coach values (head_coach, assistant_coach, …). */
  position: string | null
  gender: string | null
  level_sought: string | null
  position_required: boolean | null
}

export const COACH_MATCH_THRESHOLD = 60

const WEIGHTS = { specialization: 45, category: 30, level: 25 } as const

type Side = 'men' | 'women' | 'mixed'

function genderSide(gender: string | null): Side | null {
  if (gender === 'Men' || gender === 'Boys') return 'men'
  if (gender === 'Women' || gender === 'Girls') return 'women'
  if (gender === 'Mixed') return 'mixed'
  return null
}

function categorySide(category: string): Side {
  if (category === 'adult_men' || category === 'boys') return 'men'
  if (category === 'adult_women' || category === 'girls') return 'women'
  return 'mixed'
}

export function computeCoachOpportunityMatch(
  coach: MatchCoach,
  opportunity: MatchCoachOpportunity,
): number | null {
  let earned = 0
  let possible = 0

  // ── Specialization ──
  const sought = normalizeSpec(opportunity.position)
  const held = normalizeSpec(coach.coach_specialization)
  if (sought && held) {
    const matches = sought === held ? 1 : 0
    if (matches === 0 && opportunity.position_required) return null
    possible += WEIGHTS.specialization
    earned += WEIGHTS.specialization * matches
  }

  // ── Category ──
  const oppSide = genderSide(opportunity.gender)
  const categories = coach.coaching_categories
  if (oppSide && Array.isArray(categories) && categories.length > 0) {
    possible += WEIGHTS.category
    const exactCategory = opportunityGenderToPlayingCategory(opportunity.gender)
    if (isOpenToAny(categories)) {
      earned += WEIGHTS.category * 0.75
    } else if (exactCategory && categories.includes(exactCategory)) {
      earned += WEIGHTS.category
    } else if (oppSide === 'mixed') {
      // Mixed opening without an exact 'mixed' listing: 0.75 — parity with
      // the player scorer's Mixed tier (audit finding).
      earned += WEIGHTS.category * 0.75
    } else if (categories.some((c) => categorySide(c) === oppSide || categorySide(c) === 'mixed')) {
      earned += WEIGHTS.category * 0.5
    }
    // No side match at all → 0 for the component, never an exclusion.
  }

  // ── Level ──
  const soughtRank = opportunity.level_sought ? (LEVEL_RANK[opportunity.level_sought] ?? null) : null
  const coachRank = candidateLevelRank(coach.level_target)
  if (soughtRank != null && coachRank != null) {
    const diff = Math.abs(soughtRank - coachRank)
    possible += WEIGHTS.level
    earned += WEIGHTS.level * (diff === 0 ? 1 : diff === 1 ? 0.6 : 0.2)
  }

  if (possible === 0) return null
  return Math.round((earned / possible) * 100)
}
