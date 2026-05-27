import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { requestCache } from '@/lib/requestCache'

/**
 * Module-level cache: world_club_id → avatar_url.
 * Persists across component mounts/unmounts within the same session,
 * eliminating race conditions from React StrictMode double-effects
 * and auth store re-renders.
 */
const logoCache = new Map<string, string | null>()
const pendingFetches = new Map<string, Promise<string | null>>()

/**
 * P1.2 + P1.4 — parallel cache of per-club league metadata
 * (gender-split level bands AND display names). Populated whenever
 * prefetchWorldClubLogos runs so:
 *   - Club Fit's viewer-side proximity derivation (P1.2) reads the
 *     band without an extra round-trip
 *   - HockeyContextLine (P1.4) renders the league display name on
 *     player cards in PeopleListView (which doesn't go through the
 *     RPC) without a per-card join
 *
 * Spec: level_band_global is the curated 1..10 cross-country scale
 * (see world_leagues + supabase/migrations/20260528060000_*).
 */
interface ClubLeagueMetadata {
  men_band: number | null
  women_band: number | null
  men_name: string | null
  women_name: string | null
}
const clubLeagueCache = new Map<string, ClubLeagueMetadata>()

/**
 * Read a club's level band for a given target. 'Men' / 'Women' map
 * directly; 'Mixed' or null falls back to whichever band exists.
 * Returns null when the club isn't cached or has no league linked.
 */
export function getClubLevelBand(
  worldClubId: string | null | undefined,
  target: 'Men' | 'Women' | 'Mixed' | null | undefined,
): number | null {
  if (!worldClubId) return null
  const entry = clubLeagueCache.get(worldClubId)
  if (!entry) return null
  if (target === 'Men') return entry.men_band ?? entry.women_band
  if (target === 'Women') return entry.women_band ?? entry.men_band
  return entry.women_band ?? entry.men_band
}

/**
 * Read a player's current league display name, picking the
 * gender-appropriate league based on the player's playing_category.
 * Mirrors the SQL CASE in get_top_community_members so server- and
 * client-rendered cards display the same name.
 */
export function getPlayerLeagueName(
  worldClubId: string | null | undefined,
  playingCategory: string | null | undefined,
): string | null {
  if (!worldClubId) return null
  const entry = clubLeagueCache.get(worldClubId)
  if (!entry) return null
  if (playingCategory === 'adult_men' || playingCategory === 'boys') {
    return entry.men_name ?? entry.women_name
  }
  if (playingCategory === 'adult_women' || playingCategory === 'girls') {
    return entry.women_name ?? entry.men_name
  }
  return entry.women_name ?? entry.men_name
}

async function fetchLogo(worldClubId: string): Promise<string | null> {
  // Return cached result
  if (logoCache.has(worldClubId)) {
    return logoCache.get(worldClubId)!
  }

  // De-duplicate in-flight requests
  if (pendingFetches.has(worldClubId)) {
    return pendingFetches.get(worldClubId)!
  }

  const promise = (async () => {
    try {
      const { data, error } = await supabase
        .from('world_clubs')
        .select('avatar_url, claimed_profile:profiles!world_clubs_claimed_profile_id_fkey(avatar_url)')
        .eq('id', worldClubId)
        .single()

      if (error) {
        logger.error('[useWorldClubLogo] Failed to fetch:', error)
        return null
      }
      // COALESCE: prefer world club logo, fall back to claimed profile avatar
      const claimedAvatar = (data?.claimed_profile as { avatar_url: string | null } | null)?.avatar_url
      const url = data?.avatar_url || claimedAvatar || null
      logoCache.set(worldClubId, url)
      return url
    } finally {
      pendingFetches.delete(worldClubId)
    }
  })()

  pendingFetches.set(worldClubId, promise)
  return promise
}

/**
 * Batch-prefetch logos for multiple world clubs in a single query.
 * Populates the module-level cache so subsequent useWorldClubLogo calls
 * return instantly without individual network requests (avoids N+1).
 *
 * Concurrent-caller dedupe: the featured carousel and the All Members
 * grid both call this on every Community visit with the same set of
 * IDs. Without the requestCache.dedupe wrap below, both sent identical
 * SELECTs (visible as two `world_clubs?...in.(…)` round-trips). The
 * cache key is derived from the SORTED list of uncached IDs so two
 * concurrent callers with the same input collapse to one fetch.
 */
export async function prefetchWorldClubLogos(worldClubIds: string[]): Promise<void> {
  // Filter to only IDs not already cached
  const uncachedIds = worldClubIds.filter(id => !logoCache.has(id))
  if (uncachedIds.length === 0) return

  const cacheKey = `world-club-logos:${[...uncachedIds].sort().join(',')}`

  try {
    await requestCache.dedupe(
      cacheKey,
      async () => {
        // Joins to world_leagues twice so we can fill the league
        // metadata cache (bands + names) in the same round-trip. The
        // men/women split mirrors the schema — clubs may field one
        // or both gender teams.
        const { data, error } = await supabase
          .from('world_clubs')
          .select(`
            id,
            avatar_url,
            claimed_profile:profiles!world_clubs_claimed_profile_id_fkey(avatar_url),
            men_league:world_leagues!world_clubs_men_league_id_fkey(name, level_band_global),
            women_league:world_leagues!world_clubs_women_league_id_fkey(name, level_band_global)
          `)
          .in('id', uncachedIds)

        if (error) {
          logger.error('[prefetchWorldClubLogos] Failed to batch fetch:', error)
          return null
        }

        for (const club of data || []) {
          const claimedAvatar = (club.claimed_profile as { avatar_url: string | null } | null)?.avatar_url
          const url = club.avatar_url || claimedAvatar || null
          logoCache.set(club.id, url)
          const menLeague = club.men_league as { name: string | null; level_band_global: number | null } | null
          const womenLeague = club.women_league as { name: string | null; level_band_global: number | null } | null
          clubLeagueCache.set(club.id, {
            men_band: menLeague?.level_band_global ?? null,
            women_band: womenLeague?.level_band_global ?? null,
            men_name: menLeague?.name ?? null,
            women_name: womenLeague?.name ?? null,
          })
        }

        // Mark clubs with no row as null so we don't re-fetch them
        for (const id of uncachedIds) {
          if (!logoCache.has(id)) {
            logoCache.set(id, null)
          }
          if (!clubLeagueCache.has(id)) {
            clubLeagueCache.set(id, {
              men_band: null,
              women_band: null,
              men_name: null,
              women_name: null,
            })
          }
        }
        return null
      },
      30000,
    )
  } catch (err) {
    logger.error('[prefetchWorldClubLogos] Unexpected error:', err)
  }
}

/**
 * Hook to fetch and cache a world club's avatar URL.
 * Uses a module-level cache to avoid refetching on re-renders.
 */
export function useWorldClubLogo(worldClubId: string | null): string | null {
  const [logo, setLogo] = useState<string | null>(() =>
    worldClubId ? logoCache.get(worldClubId) ?? null : null
  )

  const fetch = useCallback(async () => {
    if (!worldClubId) {
      setLogo(null)
      return
    }

    // Immediately return cached value if available
    const cached = logoCache.get(worldClubId)
    if (cached !== undefined) {
      setLogo(cached)
      return
    }

    const url = await fetchLogo(worldClubId)
    setLogo(url)
  }, [worldClubId])

  useEffect(() => {
    fetch()
  }, [fetch])

  return logo
}
