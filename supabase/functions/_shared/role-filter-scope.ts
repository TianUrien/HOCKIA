/**
 * Drop search filters that the targeted role(s) can never satisfy.
 *
 * THE BUG THIS EXISTS TO FIX (found via the admin Discovery screen,
 * 2026-08-08): "Show all clubs" returned 0 results while the *narrower*
 * "clubs looking for forwards or midfielders" returned 14 — a logical
 * impossibility that pointed straight at filter handling.
 *
 * Cause: the parse for "Show all clubs" carried `positions: [forward,
 * midfielder]` (bled from the previous turn's query — its summary was even
 * still "Clubs in Argentina seeking forwards or midfielders"). A *position*
 * is a player attribute: measured on prod, 0 of 27 club profiles have one.
 * So the moment a position filter is applied to a club search the result set
 * is mathematically guaranteed to be empty, no matter how the filter got
 * there — LLM bleed, hallucination, or the perfectly reasonable phrasing
 * "clubs looking for forwards" (which means clubs whose OPPORTUNITIES seek
 * forwards, not clubs that are forwards).
 *
 * nl-search's COMPOUND branch already scoped filters per role and even
 * documented this hazard ("a player-only filter … zeroes out every coach").
 * The single-role branch — the one a plain "Show all clubs" takes — spread
 * the shared params verbatim. Same class of miss as the notify-* fix that
 * lived in one function and never reached its siblings: so the logic now
 * lives here, in one place both branches call.
 *
 * Verified against production data (n=27 clubs): position 0, date_of_birth
 * 0, playing_category 0, coach_specialization 0, relocation_willingness 0,
 * level_target 0, opportunity_preference 0 — while nationality_country_id
 * 25, base_location 26 and base_country_id 10 ARE populated. Geography and
 * free text therefore stay; person-only attributes are dropped.
 */

/** Params only a PLAYER profile can ever satisfy. */
const PLAYER_ONLY_PARAMS = [
  'p_positions',
  'p_min_age',
  'p_max_age',
  'p_eu_passport',
  'p_specialist_skills',
  'p_relocation_willingness',
  'p_relocation_to_country_ids',
  'p_level_target',
  'p_opportunity_preference',
  'p_available_by',
  'p_required_positions',
  'p_exclude_paid_seekers',
] as const

/** Params only a COACH profile can satisfy. */
const COACH_ONLY_PARAMS = ['p_coach_specializations'] as const

/**
 * Params satisfiable by a PERSON (player or coach) but never by an
 * organisation. Category maps to playing_category for players and
 * coaching_categories for coaches; clubs and brands have neither.
 */
const PERSON_ONLY_PARAMS = ['p_target_category', 'p_gender'] as const

export interface RoleScopeResult<T> {
  params: T
  /** Names of the params that were nulled — surfaced in _meta for the admin
   *  Discovery screen so a zero-result search is explainable, not mysterious. */
  dropped: string[]
}

/**
 * Null out every filter that none of `roles` can satisfy.
 *
 * A filter is kept when AT LEAST ONE targeted role can satisfy it — so a
 * mixed player+club search keeps positions (the player half can match) while
 * a pure club search drops them.
 */
export function scopeFiltersToRoles<T extends Record<string, unknown>>(
  params: T,
  roles: readonly string[],
): RoleScopeResult<T> {
  const targeted = roles.length > 0 ? roles : ['player']
  const hasPlayer = targeted.includes('player')
  const hasCoach = targeted.includes('coach')
  const hasPerson = hasPlayer || hasCoach

  const out = { ...params } as Record<string, unknown>
  const dropped: string[] = []

  const drop = (keys: readonly string[]) => {
    for (const k of keys) {
      if (k in out && out[k] !== null && out[k] !== undefined) {
        out[k] = null
        dropped.push(k)
      }
    }
  }

  if (!hasPlayer) drop(PLAYER_ONLY_PARAMS)
  if (!hasCoach) drop(COACH_ONLY_PARAMS)
  if (!hasPerson) drop(PERSON_ONLY_PARAMS)

  return { params: out as T, dropped }
}
