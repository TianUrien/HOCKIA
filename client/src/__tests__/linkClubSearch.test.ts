/**
 * Link your club (Club v2 D1.11): the country filter must run on the SERVER.
 * Before, a global top 40 was trimmed by country on the client, so a real club
 * outside that 40 read as "No club called X" and the club created a duplicate.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const rpc = vi.fn()
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }))

import { LINK_CLUB_SEARCH_LIMIT, searchClubsInCountry, toLinkClubMatches, type WorldClubSearchRow } from '@/lib/linkClubSearch'

const row = (over: Partial<WorldClubSearchRow> = {}): WorldClubSearchRow => ({
  id: 'c1', club_name: 'Club Atlético San Isidro', avatar_url: null, country_id: 11, province_name: 'Buenos Aires',
  is_claimed: false, men_league_id: 5, women_league_id: 6, men_league_name: null, women_league_name: 'Metropolitano A',
  ...over,
})

describe('searchClubsInCountry', () => {
  beforeEach(() => rpc.mockReset())

  it('passes the country to search_world_clubs and asks only for what the list shows', async () => {
    rpc.mockResolvedValue({ data: [row()], error: null })
    await searchClubsInCountry('san isidro', 11)
    expect(rpc).toHaveBeenCalledWith('search_world_clubs', { p_query: 'san isidro', p_limit: LINK_CLUB_SEARCH_LIMIT, p_country_id: 11 })
  })

  it('keeps every row the server returns (no client-side country trimming)', async () => {
    const rows = Array.from({ length: 8 }, (_, i) => row({ id: `c${i}`, club_name: `Club ${i}` }))
    rpc.mockResolvedValue({ data: rows, error: null })
    const { matches } = await searchClubsInCountry('club', 11)
    expect(matches).toHaveLength(8)
  })

  it('returns no matches and the error when the RPC fails', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    const { matches, error } = await searchClubsInCountry('club', 11)
    expect(matches).toEqual([])
    expect(error).toEqual({ message: 'boom' })
  })
})

describe('toLinkClubMatches', () => {
  it('maps directory rows, preferring the men’s league name then the women’s', () => {
    expect(toLinkClubMatches([row()])).toEqual([{
      id: 'c1', name: 'Club Atlético San Isidro', crest: null, countryId: 11, province: 'Buenos Aires',
      isClaimed: false, menLeagueId: 5, womenLeagueId: 6, leagueName: 'Metropolitano A',
    }])
    expect(toLinkClubMatches([row({ men_league_name: 'Primera', women_league_name: 'Metropolitano A' })])[0].leagueName).toBe('Primera')
    expect(toLinkClubMatches([row({ men_league_name: null, women_league_name: null })])[0].leagueName).toBeNull()
  })

  it('handles a null payload', () => {
    expect(toLinkClubMatches(null)).toEqual([])
  })
})
