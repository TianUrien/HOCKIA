import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { isMissingBackendError } from '@/lib/missingBackend'
import { logger } from '@/lib/logger'
import type { LeagueInput } from '@/lib/keyFacts'

/**
 * The league on a player's "Plays at" key fact (D2).
 *
 * public.player_league() answers it: the linked world club's league (verified,
 * source 'club') or, when the club has none, the league the player typed
 * (source 'self_reported' — shown with a label, never counted for level).
 *
 * Fallback — anon viewers (no EXECUTE) and environments where the RPC isn't
 * deployed yet: the world club's own league only, which is exactly the
 * verified half of player_league().
 */
export interface PlayerLeagueArgs {
  playerId: string | null | undefined
  worldClubId: string | null | undefined
  playingCategory: string | null | undefined
  /** Anonymous viewers can't call the RPC; skip straight to the club league. */
  signedIn: boolean
}

type WorldClubLeagues = {
  men_league: { id: number; name: string; level_band_global: number | null } | null
  women_league: { id: number; name: string; level_band_global: number | null } | null
}

const wantsWomen = (category: string | null | undefined) => category === 'adult_women' || category === 'girls'

async function clubLeague(worldClubId: string | null | undefined, playingCategory: string | null | undefined): Promise<LeagueInput | null> {
  if (!worldClubId) return null
  const { data, error } = await supabase
    .from('world_clubs')
    .select(`
      men_league:world_leagues!world_clubs_men_league_id_fkey(id, name, level_band_global),
      women_league:world_leagues!world_clubs_women_league_id_fkey(id, name, level_band_global)
    `)
    .eq('id', worldClubId)
    .maybeSingle()
  if (error || !data) return null
  const row = data as unknown as WorldClubLeagues
  const pick = wantsWomen(playingCategory) ? row.women_league ?? row.men_league : row.men_league ?? row.women_league
  return pick ? { name: pick.name, source: 'club', levelBand: pick.level_band_global } : null
}

export function usePlayerLeague({ playerId, worldClubId, playingCategory, signedIn }: PlayerLeagueArgs) {
  const { data, isLoading } = useQuery({
    queryKey: ['player-league', playerId ?? null, worldClubId ?? null, playingCategory ?? null, signedIn],
    enabled: !!playerId,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async (): Promise<LeagueInput | null> => {
      if (signedIn) {
        const { data: rows, error } = await supabase.rpc('player_league', { p_uid: playerId as string })
        if (!error) {
          const row = (rows ?? [])[0]
          if (!row) return null
          return row.source === 'self_reported'
            ? { name: row.league_name, source: 'self_reported', levelBand: null }
            : { name: row.league_name, source: 'club', levelBand: row.level_band }
        }
        // Not deployed here yet (or any other failure): the verified half only.
        if (!isMissingBackendError(error)) logger.debug('[usePlayerLeague] player_league failed', error)
      }
      return clubLeague(worldClubId, playingCategory)
    },
  })
  return { league: data ?? null, loading: isLoading }
}
