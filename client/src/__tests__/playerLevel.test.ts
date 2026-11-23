import { describe, expect, it } from 'vitest'
import { buildPlayerLevel, divisionLabel, hasLevelFacts, levelLine, levelRows, pickHighestLeague, pickNationalTeam, type LeagueCandidate } from '@/lib/playerLevel'
import { levelsFromRows } from '@/hooks/usePlayerLevels'

const league = (over: Partial<LeagueCandidate>): LeagueCandidate => ({ name: 'League', tier: 1, band: 5, countryName: 'Spain', flag: '🇪🇸', clubName: 'Club', current: false, startDate: null, ...over })

describe('pickHighestLeague', () => {
  it('takes the strongest band, wherever it was played', () => {
    const best = pickHighestLeague([league({ name: 'Premier League', band: 4, current: true }), league({ name: 'Hoofdklasse Heren', band: 1 })])
    expect(best?.name).toBe('Hoofdklasse Heren')
  })
  it('breaks a tie by division, then the current club, then the newest spell', () => {
    expect(pickHighestLeague([league({ name: 'B', tier: 2 }), league({ name: 'A', tier: 1 })])?.name).toBe('A')
    expect(pickHighestLeague([league({ name: 'Past' }), league({ name: 'Now', current: true })])?.name).toBe('Now')
    expect(pickHighestLeague([league({ name: 'Old', startDate: '2019-01-01' }), league({ name: 'New', startDate: '2024-01-01' })])?.name).toBe('New')
  })
  it('puts a league without a band last and returns null for none', () => {
    expect(pickHighestLeague([league({ name: 'Unbanded', band: null }), league({ name: 'Banded', band: 8 })])?.name).toBe('Banded')
    expect(pickHighestLeague([])).toBeNull()
  })
})

describe('pickNationalTeam', () => {
  it('prefers senior, then junior, then masters, then unspecified', () => {
    const best = pickNationalTeam([
      { countryName: 'Chile', flag: null, level: null, caps: 40 },
      { countryName: 'Chile', flag: null, level: 'junior', caps: 12 },
      { countryName: 'Chile', flag: null, level: 'Senior', caps: 3 },
    ])
    expect(best?.level).toBe('Senior')
  })
  it('breaks a tie by caps', () => {
    expect(pickNationalTeam([{ countryName: 'A', flag: null, level: 'senior', caps: 2 }, { countryName: 'B', flag: null, level: 'senior', caps: 30 }])?.countryName).toBe('B')
  })
})

describe('level copy', () => {
  it('names the league, its country, division and club, and the national team with caps', () => {
    const level = buildPlayerLevel({
      leagues: [league({ name: 'Hockey One League', countryName: 'Australia', flag: '🇦🇺', clubName: 'Brisbane Blaze', current: true, band: 3 })],
      nationals: [{ countryName: 'Australia', flag: '🇦🇺', level: 'senior', caps: 12 }],
      selfReported: [{ name: 'State league', clubName: 'Old club' }],
    })
    const rows = levelRows(level)
    expect(rows.map((r) => r.key)).toEqual(['league', 'national'])
    expect(rows[0]).toMatchObject({ label: 'Highest league', value: 'Hockey One League', detail: '🇦🇺 Australia, top division, with Brisbane Blaze now' })
    expect(rows[1]).toMatchObject({ label: 'National team', value: '🇦🇺 Australia, senior', detail: '12 caps' })
    expect(levelLine(level)).toBe('Hockey One League, top division, Australia senior')
  })
  it('never shows the band or an adjective', () => {
    const text = JSON.stringify(levelRows(buildPlayerLevel({ leagues: [league({ band: 1 })], nationals: [], selfReported: [] })))
    expect(text).not.toMatch(/band|elite|strong|high level/i)
  })
  it('shows a typed league as written, labelled, only when no club is linked', () => {
    const level = buildPlayerLevel({ leagues: [], nationals: [], selfReported: [{ name: 'Liga Metropolitana B', clubName: 'Club Atlético' }] })
    expect(levelRows(level)).toEqual([{ key: 'selfReported', label: 'League', value: 'Liga Metropolitana B', detail: 'with Club Atlético, written by the player, no club linked' }])
    expect(levelLine(level)).toBe('Liga Metropolitana B')
  })
  it('has nothing to say for an empty profile', () => {
    const level = buildPlayerLevel({ leagues: [], nationals: [], selfReported: [] })
    expect(hasLevelFacts(level)).toBe(false)
    expect(levelRows(level)).toEqual([])
    expect(levelLine(level)).toBeNull()
  })
  it('labels divisions 1 to 3 and nothing else', () => {
    expect([1, 2, 3, 4, null].map((n) => divisionLabel(n))).toEqual(['top division', '2nd division', '3rd division', null, null])
  })
})

describe('levelsFromRows', () => {
  const clubs = [
    { id: 'c1', club_name: 'HC Bloemendaal', country: { name: 'Netherlands', flag_emoji: '🇳🇱' }, men_league: { name: 'Hoofdklasse Heren', tier: 1, level_band_global: 1 }, women_league: { name: 'Hoofdklasse Dames', tier: 1, level_band_global: 1 } },
    { id: 'c2', club_name: 'Local HC', country: { name: 'Spain', flag_emoji: '🇪🇸' }, men_league: { name: 'Primera', tier: 2, level_band_global: 6 }, women_league: null },
  ]
  const countries = [{ id: 7, name: 'Spain', flag_emoji: '🇪🇸' }]
  const entry = { user_id: 'p1', entry_type: 'club', club_name: null, division_league: null, start_date: null, end_date: null, represented_country_id: null, represented_level: null, caps: null, world_club_id: null }

  it('reads the current club and past linked clubs, and picks the league for the player category', () => {
    const levels = levelsFromRows({
      people: [{ id: 'p1', playing_category: 'adult_women', current_world_club_id: 'c2', current_club: 'Local HC' }],
      career: [{ ...entry, world_club_id: 'c1', start_date: '2021-08-01', end_date: '2023-06-01' }, { ...entry, entry_type: 'national_team', represented_country_id: 7, represented_level: 'junior', caps: 8 }],
      clubs,
    }, countries)
    const level = levels.get('p1')
    expect(level?.league).toMatchObject({ name: 'Hoofdklasse Dames', clubName: 'HC Bloemendaal', current: false })
    expect(level?.national).toMatchObject({ countryName: 'Spain', level: 'junior', caps: 8 })
    expect(level?.selfReported).toBeNull()
  })
  it('falls back to the newest typed league when no club is linked', () => {
    const levels = levelsFromRows({
      people: [{ id: 'p1', playing_category: 'adult_men', current_world_club_id: null, current_club: null }],
      career: [{ ...entry, club_name: 'Old', division_league: 'Liga B', start_date: '2018-01-01' }, { ...entry, club_name: 'New', division_league: 'Liga A', start_date: '2023-01-01' }],
      clubs: [],
    }, countries)
    expect(levels.get('p1')?.selfReported).toEqual({ name: 'Liga A', clubName: 'New' })
  })
})
