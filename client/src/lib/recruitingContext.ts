/**
 * Recruiting Context — pragmatic v1
 *
 * The club's own profile IS their recruiting context. No new table, no
 * setup, no chip. Derive everything we need to compute Club Fit
 * directly from existing profile fields (mens_league_division,
 * womens_league_division, current_world_club_id, etc).
 *
 * When a club has multiple teams (both men's and women's), target =
 * 'Mixed' — we don't ask them to pick which team they're recruiting
 * for. They see all matching candidates and triage themselves.
 *
 * The richer "switch contexts" experience (recruiting for a SPECIFIC
 * opportunity, custom contexts, etc.) is deferred to Sprint 2 / 3.
 */

import type { PlayingCategory } from './hockeyCategories'

export type TargetCategory = 'Men' | 'Women' | 'Mixed'

/**
 * Minimal profile shape the recruiting helpers read. Intentionally
 * narrow so any profile-shaped object (PROFILES_SELECT result, auth
 * profile, etc) satisfies it.
 */
export interface RecruitingContextProfileFields {
  role: string | null
  womens_league_division: string | null
  mens_league_division: string | null
  // current_world_club_id is the FK we'll later join through to get
  // tier_within_country. Sprint v1 doesn't compute cross-country
  // proximity, so we just need the FK to be present (or not) to know
  // whether we have a club anchor.
  current_world_club_id: string | null
}

/**
 * Derive the target team category from a club's existing profile.
 * Returns null when the viewer isn't a club, or the club has no team
 * gender declared yet (no league fields set).
 *
 * The string value matches the opportunity_gender enum casing
 * ('Men' | 'Women' | 'Mixed') for symmetry with future
 * opportunity-bound contexts.
 */
export function deriveTargetCategory(
  profile: RecruitingContextProfileFields | null | undefined,
): TargetCategory | null {
  if (!profile || profile.role !== 'club') return null

  const hasWomens = Boolean(profile.womens_league_division?.trim())
  const hasMens = Boolean(profile.mens_league_division?.trim())

  if (hasWomens && hasMens) return 'Mixed'
  if (hasWomens) return 'Women'
  if (hasMens) return 'Men'
  return null
}

/**
 * Player playing_category values that count as a match for a given
 * target category. Used by both the Fit math (gender_match component)
 * and the carousel filter (only show matching players).
 *
 * Mapping (Phase 3d/3e):
 *   Men   → adult_men + boys + mixed
 *   Women → adult_women + girls + mixed
 *   Mixed → all 5 categories
 */
export function playingCategoriesForTarget(
  target: TargetCategory,
): readonly PlayingCategory[] {
  switch (target) {
    case 'Men':
      return ['adult_men', 'boys', 'mixed']
    case 'Women':
      return ['adult_women', 'girls', 'mixed']
    case 'Mixed':
      return ['adult_men', 'adult_women', 'boys', 'girls', 'mixed']
  }
}

/**
 * Convenience predicate — true when the player's playing_category
 * matches the recruiting target. Handles null player categories
 * (treat as non-match — honest, no guessing).
 */
export function playingCategoryMatchesTarget(
  playerCategory: string | null | undefined,
  target: TargetCategory,
): boolean {
  if (!playerCategory) return false
  const allowed = playingCategoriesForTarget(target) as readonly string[]
  return allowed.includes(playerCategory)
}

/**
 * Is the viewer set up to use Club Fit at all? Sprint v1 = clubs only.
 * (Coaches deferred until Sprint 2 when they get explicit context
 * support; players / brands / anon never see Fit chips.)
 */
export function isViewerFitCapable(
  profile: RecruitingContextProfileFields | null | undefined,
): boolean {
  if (!profile || profile.role !== 'club') return false
  return deriveTargetCategory(profile) !== null
}
