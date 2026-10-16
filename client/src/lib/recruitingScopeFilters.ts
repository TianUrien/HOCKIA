import type { PlayingCategory } from './hockeyCategories'
import { playingCategoriesForTarget, type TargetCategory } from './recruitingContext'

/** The slice of a recruiting_context row the Community filters read. */
export interface ScopeFilterSource {
  type?: string | null
  target_category?: string | null
  region?: string | null
  target_role?: string | null
}

export interface ScopeFilters {
  /** Player categories the scope narrows to; empty = no narrowing (Mixed, or no target). */
  categories: PlayingCategory[]
  /** Structured country match when the region names a country. */
  countryIds: number[]
  /** Free-text base_location narrower when the region is not a country (a city, "Europe"…). */
  location: string | null
  team: TargetCategory | null
  region: string | null
}

const NO_SCOPE: ScopeFilters = { categories: [], countryIds: [], location: null, team: null, region: null }

const isTarget = (v: string | null | undefined): v is TargetCategory => v === 'Men' || v === 'Women' || v === 'Mixed'

/**
 * The hard filters a PLAYER scope applies to the Community grid while it
 * reshapes the page (founder report 16 Oct 2026: "I was recruiting women in
 * Spain and nothing happened"). Before this, only the role of a role-linked
 * context reshaped the list; a saved search's team and region only re-ranked.
 *
 * - Team → the player categories that team recruits from (Women = adult
 *   women + girls + mixed; the 18+ club-facing gate keeps juniors out anyway).
 *   Mixed narrows nothing.
 * - Region → candidates' location, for SAVED SEARCHES only: a role's region is
 *   where the club plays, not where its candidates must live. A region that
 *   names a country becomes the structured country filter; anything else is a
 *   free-text match on the member's base location.
 * A coach scope never narrows players.
 */
export function scopeFilters(
  row: ScopeFilterSource | null | undefined,
  countries: readonly { id: number; name: string; common_name: string | null }[],
): ScopeFilters {
  if (!row || (row.target_role && row.target_role !== 'player')) return NO_SCOPE
  const team = isTarget(row.target_category) ? row.target_category : null
  const categories = team && team !== 'Mixed' ? [...playingCategoriesForTarget(team)] : []
  const region = row.type === 'custom' ? row.region?.trim() || null : null
  let countryIds: number[] = []
  let location: string | null = null
  if (region) {
    const key = region.toLowerCase()
    const hit = countries.find((c) => c.name.toLowerCase() === key || c.common_name?.toLowerCase() === key)
    if (hit) countryIds = [hit.id]
    else location = region
  }
  return { categories, countryIds, location, team, region }
}

/** "women's players in Spain" — what the scoped grid is showing, for the banner. */
export function scopeBannerLine(f: ScopeFilters, role: 'player' | 'coach'): string {
  if (role === 'coach') return 'coaches'
  const team = f.team === 'Women' ? 'women’s players' : f.team === 'Men' ? 'men’s players' : 'players'
  return f.region ? `${team} in ${f.region}` : team
}
