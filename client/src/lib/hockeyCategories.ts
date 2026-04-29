// Hockey category vocabulary — Phase 3 replacement for the universal "gender"
// field. Categories describe the hockey context (Adult Women, Adult Men,
// Girls, Boys, Mixed), not personal identity. Players have a single category;
// coaches and umpires can have multiple, plus an "Any category" sentinel.

/** Player playing categories. Single-select. */
export const PLAYING_CATEGORIES = [
  'adult_women',
  'adult_men',
  'girls',
  'boys',
  'mixed',
] as const

export type PlayingCategory = typeof PLAYING_CATEGORIES[number]

/** "Any category" sentinel for coaches and umpires who are open to all. */
export const ANY_CATEGORY = 'any' as const

/** Coach + umpire category set. Includes 'any' for the open-to-all case. */
export type CoachUmpireCategory = PlayingCategory | typeof ANY_CATEGORY

export const COACH_UMPIRE_CATEGORIES: readonly CoachUmpireCategory[] = [
  ...PLAYING_CATEGORIES,
  ANY_CATEGORY,
]

export const CATEGORY_LABELS: Record<CoachUmpireCategory, string> = {
  adult_women: 'Adult Women',
  adult_men: 'Adult Men',
  girls: 'Girls',
  boys: 'Boys',
  mixed: 'Mixed',
  any: 'Any category',
}

/** Translate a stored category value to a user-facing label. Empty string for
 * unknown / null — caller decides on a fallback like "Not specified". */
export function categoryToDisplay(value: string | null | undefined): string {
  if (!value) return ''
  return CATEGORY_LABELS[value as CoachUmpireCategory] ?? ''
}

/** Render an array of categories as a comma-separated label string. Returns
 * "Any category" when the array is the [any] sentinel. */
export function categoriesToDisplay(values: string[] | null | undefined): string {
  if (!values || values.length === 0) return ''
  if (isOpenToAny(values)) return CATEGORY_LABELS.any
  return values
    .map((v) => CATEGORY_LABELS[v as CoachUmpireCategory] ?? v)
    .join(', ')
}

/** True when the array represents the "any category" sentinel. The DB
 * constraint enforces that 'any' is exclusive, so we never see ['any', 'girls']. */
export function isOpenToAny(values: string[] | null | undefined): boolean {
  return Array.isArray(values) && values.includes(ANY_CATEGORY)
}

/** Best-effort mapping from the legacy gender column to a single playing
 * category. Used during the Phase 3 dual-write era for a player's primary
 * category and as a fallback for coach/umpire backfills. */
export function legacyGenderToPlayingCategory(
  gender: string | null | undefined,
): PlayingCategory | null {
  if (!gender) return null
  const normalized = gender.trim().toLowerCase()
  if (normalized === 'men' || normalized === 'male') return 'adult_men'
  if (normalized === 'women' || normalized === 'female') return 'adult_women'
  return null
}

/** Reverse mapping for dual-write. Player picks a category; we also write
 * a legacy gender value so any read path that hasn't migrated yet keeps
 * working. Girls/Boys/Mixed have no legacy equivalent — return null. */
export function playingCategoryToLegacyGender(
  category: PlayingCategory | null | undefined,
): 'Men' | 'Women' | null {
  if (category === 'adult_men') return 'Men'
  if (category === 'adult_women') return 'Women'
  return null
}

// ────────────────────────────────────────────────────────────────────────
// Opportunity-gender enum mapping (Phase 3d)
// ────────────────────────────────────────────────────────────────────────
// The DB `opportunity_gender` enum is the value clubs select when posting a
// vacancy: 'Men' | 'Women' | 'Girls' | 'Boys' | 'Mixed'. The first two are
// historical and continue to map to "Adult Men" / "Adult Women" in the UI;
// the last three were added in Phase 3d. We never rename the enum (would
// break public API consumers), so the helpers here translate to/from the
// player's playing_category vocabulary.

/** Type-safe alias for the DB enum. Mirrors database.types.ts exactly. */
export type OpportunityGender = 'Men' | 'Women' | 'Girls' | 'Boys' | 'Mixed'

export const OPPORTUNITY_GENDERS: readonly OpportunityGender[] = [
  'Men',
  'Women',
  'Girls',
  'Boys',
  'Mixed',
]

/** UI label for an opportunity_gender value. 'Men' → "Adult Men" so a club
 * vacancy posted before Phase 3d still reads naturally in the new vocabulary. */
export function opportunityGenderToDisplay(value: string | null | undefined): string {
  if (!value) return ''
  if (value === 'Men') return 'Adult Men'
  if (value === 'Women') return 'Adult Women'
  if (value === 'Girls') return 'Girls'
  if (value === 'Boys') return 'Boys'
  if (value === 'Mixed') return 'Mixed'
  return ''
}

/** Possessive team-style label for an opportunity_gender value. Used by the
 * home-feed card and the vacancy card chips: "Men's Team", "Girls' Team", etc.
 * Matches hockey vernacular for vacancy categories. */
export function opportunityGenderToTeamLabel(value: string | null | undefined): string {
  if (!value) return ''
  if (value === 'Men') return "Men's Team"
  if (value === 'Women') return "Women's Team"
  if (value === 'Girls') return "Girls' Team"
  if (value === 'Boys') return "Boys' Team"
  if (value === 'Mixed') return 'Mixed Team'
  return ''
}

/** Map a player's playing_category to the matching opportunity_gender enum
 * value. Used by the opportunity filter logic and any auto-matching surface
 * so a player with playing_category='girls' sees vacancies posted as 'Girls'. */
export function playingCategoryToOpportunityGender(
  category: PlayingCategory | null | undefined,
): OpportunityGender | null {
  if (category === 'adult_men') return 'Men'
  if (category === 'adult_women') return 'Women'
  if (category === 'girls') return 'Girls'
  if (category === 'boys') return 'Boys'
  if (category === 'mixed') return 'Mixed'
  return null
}

/** Reverse of the above — used by the OpportunityFilters chip ordering and
 * the searchAppearances analytics row so a "Men" filter still maps cleanly
 * to "Adult Men" in any UI that's already category-aware. */
export function opportunityGenderToPlayingCategory(
  value: string | null | undefined,
): PlayingCategory | null {
  if (value === 'Men') return 'adult_men'
  if (value === 'Women') return 'adult_women'
  if (value === 'Girls') return 'girls'
  if (value === 'Boys') return 'boys'
  if (value === 'Mixed') return 'mixed'
  return null
}

/** Validate that a value is in the player category set. */
export function isValidPlayingCategory(
  value: string | null | undefined,
): value is PlayingCategory {
  if (!value) return false
  return (PLAYING_CATEGORIES as readonly string[]).includes(value)
}

/** Validate an array for coach/umpire storage. Allows empty (null caller) or
 * a non-empty array of valid values. Enforces the 'any' exclusivity rule. */
export function isValidCategoryArray(values: string[] | null | undefined): boolean {
  if (values == null) return true
  if (!Array.isArray(values) || values.length === 0) return false
  const allowed = COACH_UMPIRE_CATEGORIES as readonly string[]
  if (!values.every((v) => allowed.includes(v))) return false
  // 'any' must be exclusive
  if (values.includes(ANY_CATEGORY) && values.length !== 1) return false
  return true
}
