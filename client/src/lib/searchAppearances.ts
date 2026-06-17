/**
 * searchAppearances.ts
 *
 * Client-side helpers for the profile-search-appearance analytics loop.
 *
 * Write path: `logSearchAppearances` — batch-upserts one row per profile
 * currently visible in an active community search/filter result. The server
 * dedups by `(profile_id, viewer_id, hour_bucket)` so the same viewer+profile
 * in the same hour counts once, regardless of how many times the client
 * fires (typing, scroll, remount).
 *
 * Read path: `fetchSearchAppearancesSummary` — calls the SECURITY DEFINER RPC
 * `get_profile_search_appearances` to retrieve daily aggregate counts for
 * the signed-in owner. Viewer identity is never returned.
 */
import { supabase } from './supabase'
import { logger } from './logger'

// The generated database.types.ts is regenerated infrequently and does not
// yet include `profile_search_appearances` / `get_profile_search_appearances`.
// Rather than tie this PR to a full type regen (which would also pick up any
// other schema drift between staging and prod), we cast narrowly at the two
// call sites below. Safe: the shapes are validated at runtime by the Supabase
// server, and tests pin the expected arguments.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const client = supabase as any

export interface SearchAppearanceFilters {
  search_query_present: boolean
  role: string | null
  position: string[] | null
  gender: string | null
  location: string | null
  nationality: string | null
  availability: string | null
}

export interface SearchAppearancesDay {
  day: string
  appearances: number
}

export interface SearchAppearancesSummary {
  /** Raw daily buckets over the window, oldest → newest. */
  days: SearchAppearancesDay[]
  /** Sum over the window. */
  total: number
}

/**
 * Upsert one appearance row per visible profile. Self-appearances (viewer
 * in the result set) and unauthenticated viewers are rejected by the
 * server (CHECK constraint + RLS). No-ops if the profile list is empty.
 */
export async function logSearchAppearances(params: {
  viewerId: string
  profileIds: string[]
  filters: SearchAppearanceFilters
}): Promise<void> {
  const { viewerId, profileIds, filters } = params
  if (!viewerId || profileIds.length === 0) return

  // The table's RLS is WITH CHECK (auth.uid() = viewer_id): this insert only
  // succeeds with a LIVE authenticated session whose user IS the viewer. A
  // cached profile in the app store is not enough — a stale/expired access
  // token was landing these fire-and-forget writes at Postgres as `anon`, so
  // auth.uid() was NULL and the policy 403'd on every render. getSession()
  // reads (and refreshes an expired) token, so the upsert below carries a
  // valid JWT. No live session / id mismatch → skip silently; appearance
  // logging is best-effort and must never spam the console or throw.
  const { data: { session } } = await supabase.auth.getSession()
  if (session?.user?.id !== viewerId) return

  const rows = profileIds
    .filter((id) => id !== viewerId)
    .map((profile_id) => ({
      profile_id,
      viewer_id: viewerId,
      filters: filters as unknown as Record<string, unknown>,
    }))
  if (rows.length === 0) return

  const { error } = await client
    .from('profile_search_appearances')
    .upsert(rows, {
      onConflict: 'profile_id,viewer_id,hour_bucket',
      ignoreDuplicates: true,
    })

  if (error) {
    // Never throw — analytics failures must not break the community grid.
    logger.error('[search-appearances] log failed', error)
  }
}

/**
 * Fetches the daily appearance aggregate for the signed-in owner over the
 * last `days` (clamped server-side to 1..90). Returns null on error so the
 * caller can hide the card rather than showing a broken state.
 */
export async function fetchSearchAppearancesSummary(
  profileId: string,
  days: number = 7
): Promise<SearchAppearancesSummary | null> {
  const { data, error } = await client.rpc('get_profile_search_appearances', {
    p_profile_id: profileId,
    p_days: days,
  })

  if (error) {
    logger.error('[search-appearances] fetch failed', error)
    return null
  }

  // Defensive: tolerate anything non-array (e.g. a mocked `false`, unexpected
  // RPC payload shapes) by coercing to an empty window.
  const rows = Array.isArray(data) ? (data as SearchAppearancesDay[]) : []
  const total = rows.reduce((acc, r) => acc + (r.appearances ?? 0), 0)
  return { days: rows, total }
}
