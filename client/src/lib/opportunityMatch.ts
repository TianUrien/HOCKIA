import {
  playingCategoryToOpportunityGender,
  type PlayingCategory,
} from './hockeyCategories'
import { LEVEL_RANK, candidateLevelRank } from './opportunityIntent'

/**
 * Player → opportunity match % for the Pulse "Opportunities for you" module
 * (Home redesign V2, Q4: RULE-BASED — transparent position/category/level
 * score, same philosophy as Club Fit; no AI, no opaque numbers).
 *
 * Three components, each skipped (not zeroed) when either side is unknown —
 * honest absence never penalizes, the % is computed over what we actually
 * know:
 *   position  40  primary exact 1.0 / secondary 0.6 / mismatch 0
 *   category  35  exact 1.0 / Mixed-opening 0.75 / same-side (Women↔Girls,
 *                 Men↔Boys) or mixed-category player 0.5
 *   level     25  |level_sought − level_target| = 0 → 1.0 / 1 → 0.6 / ≥2 → 0.2
 *
 * HARD EXCLUSIONS (returns null — the role is not "for you", mirroring the
 * check_application_eligibility trigger + the recruiter's Out-of-scope
 * verdict):
 *   • opposite team side (Men/Boys opening vs adult_women/girls player and
 *     vice versa) — the player could not even apply;
 *   • position_required opening whose position matches neither the player's
 *     primary nor secondary.
 *
 * The EU-passport hard gate is applied by the caller via
 * checkOpportunityEligibility (it needs the countries list).
 *
 * Show the % ONLY at ≥ MATCH_THRESHOLD (empty-state rule §C): below it, the
 * module falls back to newest open roles WITHOUT a % — never a lonely "22%".
 */

export interface MatchPlayer {
  position: string | null
  secondary_position: string | null
  playing_category: string | null
  /** Legacy fallback when playing_category is unset ('Men'/'Women' etc.). */
  gender: string | null
  level_target: string | null
}

export interface MatchOpportunity {
  position: string | null
  /** opportunity_gender enum: 'Men' | 'Women' | 'Girls' | 'Boys' | 'Mixed'. */
  gender: string | null
  level_sought: string | null
  position_required: boolean | null
}

export const MATCH_THRESHOLD = 60

const WEIGHTS = { position: 40, category: 35, level: 25 } as const

type Side = 'men' | 'women' | 'mixed'

function opportunityGenderSide(gender: string | null): Side | null {
  if (gender === 'Men' || gender === 'Boys') return 'men'
  if (gender === 'Women' || gender === 'Girls') return 'women'
  if (gender === 'Mixed') return 'mixed'
  return null
}

function playerCategorySide(category: PlayingCategory): Side {
  if (category === 'adult_men' || category === 'boys') return 'men'
  if (category === 'adult_women' || category === 'girls') return 'women'
  return 'mixed'
}

/** The player's effective category: playing_category, else the legacy gender
 *  column mapped over (older rows predating the category vocabulary). */
function effectiveCategory(player: MatchPlayer): PlayingCategory | null {
  if (player.playing_category) return player.playing_category as PlayingCategory
  const g = (player.gender ?? '').trim().toLowerCase()
  if (g === 'men' || g === 'male') return 'adult_men'
  if (g === 'women' || g === 'female') return 'adult_women'
  return null
}

function normalizePosition(value: string | null): string | null {
  const v = (value ?? '').trim().toLowerCase()
  return v.length > 0 ? v : null
}

/**
 * Rule-based match score, 0–100, or null when the opportunity is hard-excluded
 * OR no component is known on both sides (we can't claim a match we can't
 * compute).
 */
export function computeOpportunityMatch(
  player: MatchPlayer,
  opportunity: MatchOpportunity,
): number | null {
  let earned = 0
  let possible = 0

  // ── Category ──
  const category = effectiveCategory(player)
  const oppSide = opportunityGenderSide(opportunity.gender)
  if (category && oppSide) {
    const playerSide = playerCategorySide(category)
    if (oppSide !== 'mixed' && playerSide !== 'mixed' && playerSide !== oppSide) {
      return null // opposite side — could not even apply
    }
    possible += WEIGHTS.category
    if (playingCategoryToOpportunityGender(category) === opportunity.gender) {
      earned += WEIGHTS.category
    } else if (oppSide === 'mixed') {
      earned += WEIGHTS.category * 0.75
    } else {
      // Same side, different age band (Women↔Girls / Men↔Boys), or a
      // mixed-category player looking at a single-side opening.
      earned += WEIGHTS.category * 0.5
    }
  }

  // ── Position ──
  const target = normalizePosition(opportunity.position)
  const primary = normalizePosition(player.position)
  const secondary = normalizePosition(player.secondary_position)
  if (target && (primary || secondary)) {
    const matches = primary === target ? 1 : secondary === target ? 0.6 : 0
    if (matches === 0 && opportunity.position_required) {
      return null // explicit must-have the player fails
    }
    possible += WEIGHTS.position
    earned += WEIGHTS.position * matches
  }

  // ── Level ──
  const soughtRank = opportunity.level_sought ? (LEVEL_RANK[opportunity.level_sought] ?? null) : null
  const playerRank = candidateLevelRank(player.level_target)
  if (soughtRank != null && playerRank != null) {
    const diff = Math.abs(soughtRank - playerRank)
    possible += WEIGHTS.level
    earned += WEIGHTS.level * (diff === 0 ? 1 : diff === 1 ? 0.6 : 0.2)
  }

  if (possible === 0) return null
  return Math.round((earned / possible) * 100)
}
