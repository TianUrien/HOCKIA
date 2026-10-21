/**
 * The role page's data read, shared by the page (pages/OpportunityDetailPage)
 * and the card prefetch (lib/prefetchRole). Quick wins 2026-10-21: a tap on a
 * role card on Home or Opportunities should open a page that is already
 * filled in.
 *
 * Same query, same RLS: the prefetch runs exactly the read the page runs, as
 * the same viewer, so hidden profiles and test-account fences behave the same
 * (the page still applies its own test-account check on the result).
 *
 * Cache rules: one entry per role id, kept 30 s. The page takes the entry
 * (and removes it), so a later visit reads fresh data unless a card warmed
 * it again just before. A failed read is never kept.
 */
import { supabase } from './supabase'

export const ROLE_DETAIL_SELECT = `
  *,
  club:profiles!opportunities_club_id_fkey(
    id,
    full_name,
    avatar_url,
    is_test_account,
    role,
    current_club,
    coach_current_role,
    womens_league_division,
    mens_league_division
  ),
  world_club:world_clubs!opportunities_world_club_id_fkey(
    id,
    club_name,
    avatar_url,
    country:countries(name, flag_emoji),
    men_league:world_leagues!world_clubs_men_league_id_fkey(name, tier),
    women_league:world_leagues!world_clubs_women_league_id_fkey(name, tier)
  )
`

export type RoleDetailResult = { data: unknown | null; error: unknown | null }

export const ROLE_DETAIL_TTL_MS = 30_000

const cache = new Map<string, { at: number; result: Promise<RoleDetailResult> }>()

function runQuery(id: string): Promise<RoleDetailResult> {
  return Promise.resolve(
    supabase.from('opportunities').select(ROLE_DETAIL_SELECT).eq('id', id).single(),
  ).then(
    ({ data, error }) => ({ data: data ?? null, error: error ?? null }),
    (error: unknown) => ({ data: null, error }),
  )
}

function fresh(id: string): Promise<RoleDetailResult> | null {
  const hit = cache.get(id)
  if (!hit) return null
  if (Date.now() - hit.at > ROLE_DETAIL_TTL_MS) { cache.delete(id); return null }
  return hit.result
}

/** Warm the cache for a role (deduped: an entry younger than the TTL is reused). */
export function warmRoleDetail(id: string): Promise<RoleDetailResult> {
  const hit = fresh(id)
  if (hit) return hit
  const result = runQuery(id)
  cache.set(id, { at: Date.now(), result })
  // Never keep a failure: the page's own read (or Retry) must go to the network.
  void result.then((r) => { if (r.error && cache.get(id)?.result === result) cache.delete(id) })
  return result
}

/** True while a warmed read for this role is in the cache. */
export function hasWarmRoleDetail(id: string): boolean {
  return fresh(id) !== null
}

/** The page's read: takes a warmed entry when there is one, else reads now. */
export function loadRoleDetail(id: string): Promise<RoleDetailResult> {
  const hit = fresh(id)
  cache.delete(id)
  return hit ?? runQuery(id)
}

/** Tests only. */
export function __resetRoleDetailCache(): void {
  cache.clear()
}
