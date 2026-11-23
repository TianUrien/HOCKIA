import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { useCountries } from '@/hooks/useCountries'
import { buildPlayerLevel, type LeagueCandidate, type NationalCandidate, type PlayerLevel, type SelfReportedLeague } from '@/lib/playerLevel'

/**
 * The "Level played" facts of one or more players (lib/playerLevel.ts), read
 * for a recruiter: the leagues of the clubs linked on the profile and in the
 * career, the league a player typed when no club is linked, and national
 * team entries. Hidden career entries are left out. RECRUITER surfaces only.
 */

type LeagueRow = { name: string; tier: number | null; level_band_global: number | null } | null
type ClubRow = {
  id: string
  club_name: string
  country: { name: string | null; flag_emoji: string | null } | null
  men_league: LeagueRow
  women_league: LeagueRow
}
type CareerRow = {
  user_id: string
  entry_type: string | null
  club_name: string | null
  division_league: string | null
  start_date: string | null
  end_date: string | null
  represented_country_id: number | null
  represented_level: string | null
  caps: number | null
  world_club_id: string | null
}
type PersonRow = { id: string; playing_category: string | null; current_world_club_id: string | null; current_club: string | null }

interface Raw { people: PersonRow[]; career: CareerRow[]; clubs: ClubRow[] }

const CLUB_SELECT = `id, club_name, country:countries(name, flag_emoji),
  men_league:world_leagues!world_clubs_men_league_id_fkey(name, tier, level_band_global),
  women_league:world_leagues!world_clubs_women_league_id_fkey(name, tier, level_band_global)`

const wantsWomen = (category: string | null | undefined) => category === 'adult_women' || category === 'girls'

async function load(ids: string[]): Promise<Raw> {
  const [people, career] = await Promise.all([
    supabase.from('profiles').select('id, playing_category, current_world_club_id, current_club').in('id', ids),
    supabase
      .from('career_history')
      .select('user_id, entry_type, club_name, division_league, start_date, end_date, represented_country_id, represented_level, caps, world_club_id')
      .in('user_id', ids)
      .or('is_hidden.is.null,is_hidden.eq.false')
      .in('entry_type', ['club', 'national_team']),
  ])
  if (people.error) throw people.error
  if (career.error) throw career.error
  const peopleRows = (people.data ?? []) as PersonRow[]
  const careerRows = (career.data ?? []) as CareerRow[]
  const clubIds = [...new Set([...peopleRows.map((p) => p.current_world_club_id), ...careerRows.map((c) => c.world_club_id)].filter((x): x is string => Boolean(x)))]
  let clubs: ClubRow[] = []
  if (clubIds.length) {
    const { data, error } = await supabase.from('world_clubs').select(CLUB_SELECT).in('id', clubIds)
    if (error) throw error
    clubs = (data ?? []) as unknown as ClubRow[]
  }
  return { people: peopleRows, career: careerRows, clubs }
}

/** Exported for tests: turn the raw rows into one PlayerLevel per player. */
export function levelsFromRows(raw: Raw, countries: { id: number; name: string; flag_emoji: string | null }[]): Map<string, PlayerLevel> {
  const clubById = new Map(raw.clubs.map((c) => [c.id, c]))
  const out = new Map<string, PlayerLevel>()
  for (const person of raw.people) {
    const women = wantsWomen(person.playing_category)
    const leagueOf = (club: ClubRow | undefined): LeagueRow => (club ? (women ? club.women_league ?? club.men_league : club.men_league ?? club.women_league) : null)
    const candidate = (club: ClubRow | undefined, current: boolean, startDate: string | null): LeagueCandidate | null => {
      const league = leagueOf(club)
      if (!club || !league) return null
      return { name: league.name, tier: league.tier, band: league.level_band_global, countryName: club.country?.name ?? null, flag: club.country?.flag_emoji ?? null, clubName: club.club_name, current, startDate }
    }
    const mine = raw.career.filter((c) => c.user_id === person.id)
    const leagues: LeagueCandidate[] = []
    const now = candidate(person.current_world_club_id ? clubById.get(person.current_world_club_id) : undefined, true, null)
    if (now) leagues.push(now)
    const selfReported: (SelfReportedLeague & { startDate: string | null })[] = []
    const nationals: NationalCandidate[] = []
    for (const c of mine) {
      if (c.entry_type === 'national_team') {
        const country = c.represented_country_id ? countries.find((x) => x.id === c.represented_country_id) : undefined
        nationals.push({ countryName: country?.name ?? null, flag: country?.flag_emoji ?? null, level: c.represented_level, caps: c.caps })
        continue
      }
      const linked = candidate(c.world_club_id ? clubById.get(c.world_club_id) : undefined, !c.end_date && c.world_club_id === person.current_world_club_id, c.start_date)
      if (linked) leagues.push(linked)
      else if (c.division_league?.trim()) selfReported.push({ name: c.division_league.trim(), clubName: c.club_name?.trim() || null, startDate: c.start_date })
    }
    selfReported.sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? ''))
    out.set(person.id, buildPlayerLevel({ leagues, nationals, selfReported: selfReported.map(({ name, clubName }) => ({ name, clubName })) }))
  }
  return out
}

export function usePlayerLevels(playerIds: string[], enabled = true): { levels: Map<string, PlayerLevel>; loading: boolean } {
  const { countries } = useCountries()
  // A stable key, so a new array with the same ids does not refetch.
  const key = useMemo(() => [...new Set(playerIds)].sort().join(','), [playerIds])
  const [state, setState] = useState<{ key: string; raw: Raw | null }>({ key: '', raw: null })
  useEffect(() => {
    if (!enabled || !key) return
    let cancelled = false
    // Plain fetch (no query cache): the recruiter screens that mount this are
    // also rendered without a QueryClient in tests and in the review flow.
    load(key.split(','))
      .then((raw) => { if (!cancelled) setState({ key, raw }) })
      .catch((err) => { logger.debug('[usePlayerLevels] failed', err); if (!cancelled) setState({ key, raw: null }) })
    return () => { cancelled = true }
  }, [key, enabled])
  const raw = state.key === key ? state.raw : null
  const levels = useMemo(() => (raw ? levelsFromRows(raw, countries) : new Map<string, PlayerLevel>()), [raw, countries])
  return { levels, loading: enabled && Boolean(key) && state.key !== key }
}

export function usePlayerLevel(playerId: string | null | undefined, enabled = true): { level: PlayerLevel | null; loading: boolean } {
  const ids = useMemo(() => (playerId ? [playerId] : []), [playerId])
  const { levels, loading } = usePlayerLevels(ids, enabled)
  return { level: playerId ? levels.get(playerId) ?? null : null, loading }
}
