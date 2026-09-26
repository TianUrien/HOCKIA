import { supabase } from '@/lib/supabase'

/**
 * Link your club (Figma D1.11) directory search. The country filter runs in
 * SQL (search_world_clubs p_country_id, migration 20260926130000): trimming a
 * global top 40 on the client hid real clubs in the chosen country, so the
 * club saw "No club called X" and created a duplicate.
 */
export const LINK_CLUB_SEARCH_LIMIT = 8

export type LinkClubMatch = {
  id: string
  name: string
  crest: string | null
  countryId: number
  province: string | null
  isClaimed: boolean
  menLeagueId: number | null
  womenLeagueId: number | null
  leagueName: string | null
}

export type WorldClubSearchRow = {
  id: string
  club_name: string
  avatar_url: string | null
  country_id: number
  province_name: string | null
  is_claimed: boolean
  men_league_id: number | null
  women_league_id: number | null
  men_league_name: string | null
  women_league_name: string | null
}

export function toLinkClubMatches(rows: WorldClubSearchRow[] | null | undefined): LinkClubMatch[] {
  return (rows ?? []).map((r) => ({
    id: r.id, name: r.club_name, crest: r.avatar_url, countryId: r.country_id, province: r.province_name,
    isClaimed: r.is_claimed, menLeagueId: r.men_league_id, womenLeagueId: r.women_league_id,
    leagueName: r.men_league_name ?? r.women_league_name ?? null,
  }))
}

export async function searchClubsInCountry(query: string, countryId: number): Promise<{ matches: LinkClubMatch[]; error: unknown }> {
  const { data, error } = await supabase.rpc('search_world_clubs', {
    p_query: query,
    p_limit: LINK_CLUB_SEARCH_LIMIT,
    p_country_id: countryId,
  })
  return { matches: toLinkClubMatches(data as WorldClubSearchRow[] | null), error }
}
