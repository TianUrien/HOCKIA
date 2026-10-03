import { supabase } from '@/lib/supabase'
import { positionLabel } from '@/lib/identity'

/**
 * "Open roles" teaser on the web landing (Figma "Web A v2"): the NEWEST
 * three open roles from the anon-readable `public_opportunities` view.
 *
 * Ordering is strictly `created_at desc` (founder ruling 2026-08-13): never
 * `published_at`, which the re-open trigger re-stamps so renewals would jump
 * the queue.
 */

export interface OpenRoleCard {
  id: string
  title: string
  /** "club · country" */
  meta: string
}

export type PublicOpportunityRow = {
  id: string | null
  title: string | null
  position: string | null
  organization_name: string | null
  world_club_name: string | null
  publisher_current_club: string | null
  club_name: string | null
  location_country: string | null
}

/**
 * Card title = the role's own title when the club typed one, else
 * "<Position> wanted". A title that is just the bare position label (the
 * post-role default when nothing was typed) counts as not typed.
 */
export function openRoleTitle(row: Pick<PublicOpportunityRow, 'title' | 'position'>): string {
  const typed = row.title?.trim() ?? ''
  const pos = positionLabel(row.position)
  if (typed && typed.toLowerCase() !== pos?.toLowerCase()) return typed
  if (pos) return `${pos} wanted`
  return typed || 'Open role'
}

/** Same club-name precedence as the opportunity pages: the typed
 *  organisation, then the linked world club, then the publisher's club. */
export function toOpenRoleCard(row: PublicOpportunityRow): OpenRoleCard | null {
  if (!row.id) return null
  const org =
    row.organization_name?.trim() ||
    row.world_club_name?.trim() ||
    row.publisher_current_club?.trim() ||
    row.club_name?.trim() ||
    ''
  const country = row.location_country?.trim() ?? ''
  return {
    id: row.id,
    title: openRoleTitle(row),
    meta: [org, country].filter(Boolean).join(' · '),
  }
}

export const OPEN_ROLES_LIMIT = 3

export async function fetchNewestOpenRoles(): Promise<OpenRoleCard[]> {
  const { data, error } = await supabase
    .from('public_opportunities')
    .select('id,title,position,organization_name,world_club_name,publisher_current_club,club_name,location_country')
    .order('created_at', { ascending: false })
    .limit(OPEN_ROLES_LIMIT)
  if (error) throw error
  return (data ?? []).flatMap((row) => {
    const card = toOpenRoleCard(row)
    return card ? [card] : []
  })
}
