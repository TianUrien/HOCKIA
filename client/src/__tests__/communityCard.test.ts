import { describe, expect, it } from 'vitest'
import {
  availableLabel, cardPlaceLine, cardRoleLine, clubCover, clubMetaLine, crestGradient,
  CLUB_BRAND_GRADIENT, displayPlace, friendsHereLabel, placeLabel, inCommonCountLabel, initialsOf, type CardMember,
} from '@/lib/communityCard'

const base: CardMember = { id: 'm1', full_name: 'Leandro Bica', role: 'player', avatar_url: null }

describe('Community photo card lines (Figma 6:100)', () => {
  it('role line per role', () => {
    expect(cardRoleLine({ ...base, position: 'midfielder', playing_category: 'adult_men' })).toBe('Midfielder · Men’s')
    expect(cardRoleLine({ ...base, position: null })).toBe('Player')
    expect(cardRoleLine({ ...base, role: 'coach', coach_specialization: 'head_coach' })).toBe('Coach · Head coach')
    expect(cardRoleLine({ ...base, role: 'umpire', umpire_level: 'FIH Level 2' })).toBe('Umpire · FIH Level 2')
    expect(cardRoleLine({ ...base, role: 'brand', brand_category: 'equipment' })).toBe('Brand · Equipment')
  })

  it('place line hides an unknown age or place', () => {
    expect(cardPlaceLine(22, '🇦🇷 Buenos Aires')).toBe('22 · 🇦🇷 Buenos Aires')
    expect(cardPlaceLine(null, '🇦🇷 Buenos Aires')).toBe('🇦🇷 Buenos Aires')
    expect(cardPlaceLine(31, null)).toBe('31')
    expect(cardPlaceLine(null, null)).toBeNull()
  })

  it('initials skip brackets and numbers', () => {
    expect(initialsOf('[QA] Safe Area')).toBe('QA')
    expect(initialsOf('QA Test Club 03')).toBe('QC')
    expect(initialsOf('Tomás Sosa')).toBe('TS')
    expect(initialsOf('')).toBe('?')
  })
})

describe('Club wide card (Figma 12:41)', () => {
  it('picks the cover variant', () => {
    expect(clubCover('cover.jpg', 'crest.png')).toBe('photo')
    expect(clubCover(null, 'crest.png')).toBe('crest')
    expect(clubCover(null, null)).toBe('none')
  })

  it('meta lists open roles without counts, else league · place', () => {
    expect(clubMetaLine({ recruiting: true, positions: ['defender', 'forward', 'defender'], league: 'D1', place: null })).toBe('Recruiting · Defender, Forward')
    expect(clubMetaLine({ recruiting: true, positions: ['coach'], league: null, place: null })).toBe('Recruiting · Coach')
    expect(clubMetaLine({ recruiting: false, positions: [], league: 'Serie A Elite', place: '🇮🇹 Rome, Italy' })).toBe('Serie A Elite · 🇮🇹 Rome, Italy')
  })

  it('crest colour gradient falls back to brand until a colour is stored', () => {
    expect(crestGradient(null)).toBe(CLUB_BRAND_GRADIENT)
    expect(crestGradient('#2f7fb5')).toContain('rgb(47, 127, 181)')
  })
})

describe('Display place (spec 26:1046)', () => {
  const countries = [
    { id: 1, code: 'IT', name: 'Italy', common_name: null, flag_emoji: '🇮🇹' },
    { id: 2, code: 'GB', name: 'United Kingdom', common_name: null, flag_emoji: '🇬🇧' },
    { id: 3, code: 'AU', name: 'Australia', common_name: null, flag_emoji: '🇦🇺' },
    { id: 4, code: 'AR', name: 'Argentina', common_name: null, flag_emoji: '🇦🇷' },
  ]
  it('keeps the city, drops regions, postcodes and state codes', () => {
    expect(placeLabel(displayPlace('Roma, Metropolitan City of Rome Capital, Italy', null, countries))).toBe('🇮🇹 Roma')
    expect(placeLabel(displayPlace('Roma, Metropolitan City of Rome Capital, Italy', null, countries), true)).toBe('🇮🇹 Roma, Italy')
    expect(placeLabel(displayPlace('BR3 3BP', 2, countries))).toBe('🇬🇧 United Kingdom')
    expect(placeLabel(displayPlace('BR3 3BP', null, countries))).toBeNull()
    expect(placeLabel(displayPlace('Melbourne VIC, Australia', null, countries))).toBe('🇦🇺 Melbourne')
    expect(placeLabel(displayPlace('London, UK', null, countries))).toBe('🇬🇧 London')
  })
  it('falls back to the country name when there is no city', () => {
    expect(placeLabel(displayPlace('Italy', null, countries))).toBe('🇮🇹 Italy')
    expect(placeLabel(displayPlace(null, 4, countries))).toBe('🇦🇷 Argentina')
    expect(placeLabel(displayPlace('Delran', null, countries))).toBe('Delran')
    expect(placeLabel(displayPlace('kisumu', null, countries))).toBe('Kisumu')
    expect(placeLabel(displayPlace('san miguel de tucuman, Argentina', null, countries))).toBe('🇦🇷 San Miguel De Tucuman')
  })
})

describe('Preview copy', () => {
  const now = new Date('2026-10-11T00:00:00Z')
  it('available: Now, From <month>, or hidden when not open', () => {
    expect(availableLabel({ ...base, open_to_play: true }, now)).toBe('Now')
    expect(availableLabel({ ...base, open_to_play: true, available_from: '2027-01-15' }, now)).toBe('From Jan')
    expect(availableLabel({ ...base, open_to_play: false }, now)).toBeNull()
    expect(availableLabel({ ...base, role: 'coach', open_to_coach: true }, now)).toBe('Now')
  })

  it('friends lines', () => {
    expect(inCommonCountLabel(1)).toBe('1 friend in common')
    expect(inCommonCountLabel(3)).toBe('3 friends in common')
    expect(inCommonCountLabel(0)).toBeNull()
    expect(friendsHereLabel(1)).toBe('1 of your friends plays here')
    expect(friendsHereLabel(2)).toBe('2 of your friends play here')
  })
})
