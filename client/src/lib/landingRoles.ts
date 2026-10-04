import { supabase } from '@/lib/supabase'
import { positionLabel } from '@/lib/identity'

/**
 * "Open roles" teaser on the web landing (Figma "Web A v2"): the NEWEST
 * three open roles from the `public_opportunities` view.
 *
 * The view is read through the `public-opportunities` edge function (the
 * public API, service role), not with a browser select: the view is
 * `security_invoker` and joins `profiles` columns that anon cannot read, so
 * a direct anon select fails with "permission denied for table profiles".
 * The function already applies the view's test-account and hidden-publisher
 * fences and orders `created_at desc, id desc` — strictly creation order
 * (founder ruling 2026-08-13: never `published_at`, which the re-open
 * trigger re-stamps so renewals would jump the queue).
 */

export interface OpenRoleCard {
  id: string
  title: string
  /** "club · country" */
  meta: string
}

/** The slice of the public API's opportunity object that the card uses. */
export type PublicOpportunity = {
  id?: string | null
  title?: string | null
  position?: string | null
  location?: { country?: string | null } | null
  club?: { name?: string | null } | null
}

/** The API substitutes this when the publisher has no name. Not a club. */
const UNKNOWN_CLUB = 'Unknown Club'

/**
 * Card title = the role's own title when the club typed one, else
 * "<Position> wanted". A title that is just the bare position label (the
 * post-role default when nothing was typed) counts as not typed.
 */
export function openRoleTitle(row: Pick<PublicOpportunity, 'title' | 'position'>): string {
  const typed = row.title?.trim() ?? ''
  const pos = positionLabel(row.position)
  if (typed && typed.toLowerCase() !== pos?.toLowerCase()) return typed
  if (pos) return `${pos} wanted`
  return typed || 'Open role'
}

export function toOpenRoleCard(row: PublicOpportunity): OpenRoleCard | null {
  if (!row.id) return null
  const club = row.club?.name?.trim() ?? ''
  const org = club === UNKNOWN_CLUB ? '' : club
  const country = row.location?.country?.trim() ?? ''
  return {
    id: row.id,
    title: openRoleTitle(row),
    meta: [org, country].filter(Boolean).join(' · '),
  }
}

export const OPEN_ROLES_LIMIT = 3

export async function fetchNewestOpenRoles(): Promise<OpenRoleCard[]> {
  const { data, error } = await supabase.functions.invoke<{ data?: PublicOpportunity[] }>(
    `public-opportunities?limit=${OPEN_ROLES_LIMIT}`,
    { method: 'GET' },
  )
  if (error) throw error
  return (data?.data ?? []).slice(0, OPEN_ROLES_LIMIT).flatMap((row) => {
    const card = toOpenRoleCard(row)
    return card ? [card] : []
  })
}
