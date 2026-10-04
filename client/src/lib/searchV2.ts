/**
 * Search v2 (Figma "New-Hockia" Search v2, node 42:195; founder rulings
 * 2026-10-03). The phone /search screen shows ONE flat ranked list of
 * members — players, coaches, clubs, brands and umpires — straight from the
 * `people` branch of the `search_content` RPC, which already ranks every
 * profile role together by text rank. A row carries the name, a
 * "position/role · club · flag" line and a role pill; never fit, level,
 * score, counts or reply times (docs/engineering/standards.md §3).
 */
import { isOrganisationRole, positionLabel, type RoleLike } from '@/lib/identity'
import { profilePath } from '@/lib/profileNavigation'

export const SEARCH_SCOPE_LINE = 'Players, coaches, clubs, brands and umpires'
export const SEARCH_PLACEHOLDER = 'Search'
/** `search_content` returns nothing for shorter queries. */
export const MIN_QUERY_LENGTH = 2
/** Rows shown before the "See all" footer hands over to Community. */
export const MAX_ROWS = 10

export function askAiLabel(query: string): string {
  return `Ask Hockia AI about “${query.trim()}”`
}

export function noMembersLabel(query: string): string {
  return `No members match “${query.trim()}”`
}

/** "See all 9 members" → Community with the query. A single hit still says
 *  where it goes rather than "See all 1 members". */
export function seeAllMembersLabel(total: number): string {
  return total === 1 ? 'See 1 member in Community' : `See all ${total} members`
}

export interface MemberMetaInput {
  role: RoleLike
  position?: string | null
  currentClub?: string | null
  baseLocation?: string | null
}

/**
 * The second line of a member row, without the flag (rendered after it as a
 * component so every surface draws flags the same way). People read
 * "Forward · Lazio Hockey"; clubs and brands, which have no position or
 * club, read their location ("Roma, Italy"). Nothing is padded when unknown.
 */
export function memberMetaLine({ role, position, currentClub, baseLocation }: MemberMetaInput): string {
  const parts: string[] = []
  const pos = positionLabel(position)
  if (pos) parts.push(pos)
  if (currentClub?.trim()) parts.push(currentClub.trim())
  if (parts.length === 0 && (isOrganisationRole(role) || !pos) && baseLocation?.trim()) parts.push(baseLocation.trim())
  return parts.join(' · ')
}

/** Public profile for a search hit, by role + id; `?ref=search` keeps the
 *  existing attribution the desktop results use. */
export function memberProfilePath(role: RoleLike, id: string): string {
  const base = profilePath(role, null, id) ?? `/players/id/${id}`
  return `${base}?ref=search`
}

export function discoverPathFor(query: string): string {
  return `/discover?q=${encodeURIComponent(query.trim())}`
}

export function communityPathFor(query: string): string {
  return `/community?q=${encodeURIComponent(query.trim())}`
}
