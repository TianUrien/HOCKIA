import { describe, expect, it } from 'vitest'
import { scopeBannerLine, scopeFilters } from '@/lib/recruitingScopeFilters'
import { recruitingScopedRole } from '@/lib/recruiterAccess'

const countries = [
  { id: 1, name: 'Spain', common_name: null },
  { id: 2, name: 'United Kingdom', common_name: 'England' },
]
const club = { role: 'club', coach_recruits_for_team: null }

// Founder report 16 Oct 2026: "I was recruiting women in Spain and nothing
// happened in Community" — a saved search must narrow the grid, not only re-rank.
describe('recruiting scope → Community filters', () => {
  it('a saved search narrows to the team’s categories and its country', () => {
    const f = scopeFilters({ type: 'custom', target_category: 'Women', region: 'Spain', target_role: null }, countries)
    expect(f.categories).toEqual(['adult_women', 'girls', 'mixed'])
    expect(f.countryIds).toEqual([1])
    expect(f.location).toBeNull()
    expect(scopeBannerLine(f, 'player')).toBe('women’s players in Spain')
  })

  it('a region that is not a country becomes a free-text location match; country names match case-insensitively and by common name', () => {
    expect(scopeFilters({ type: 'custom', target_category: 'Men', region: 'Madrid' }, countries)).toMatchObject({ categories: ['adult_men', 'boys', 'mixed'], countryIds: [], location: 'Madrid' })
    expect(scopeFilters({ type: 'custom', target_category: 'Men', region: ' england ' }, countries).countryIds).toEqual([2])
  })

  it('Mixed narrows no category; a role context narrows by team but never by its own region', () => {
    expect(scopeFilters({ type: 'custom', target_category: 'Mixed', region: null }, countries).categories).toEqual([])
    const role = scopeFilters({ type: 'opportunity', target_category: 'Women', region: 'San Isidro', target_role: 'player' }, countries)
    expect(role.categories).toEqual(['adult_women', 'girls', 'mixed'])
    expect(role.countryIds).toEqual([])
    expect(role.location).toBeNull()
    expect(scopeBannerLine(role, 'player')).toBe('women’s players')
  })

  it('a coach scope and no scope narrow nothing', () => {
    expect(scopeFilters({ type: 'opportunity', target_category: null, region: 'Rome', target_role: 'coach' }, countries)).toMatchObject({ categories: [], countryIds: [], location: null })
    expect(scopeFilters(null, countries).categories).toEqual([])
    expect(scopeBannerLine(scopeFilters(null, countries), 'coach')).toBe('coaches')
  })

  it('a saved search counts as a player scope for the page (role-linked contexts keep their role)', () => {
    expect(recruitingScopedRole(club, null, true)).toBe('player')
    expect(recruitingScopedRole(club, null, false)).toBeNull()
    expect(recruitingScopedRole(club, 'coach', true)).toBe('coach')
    expect(recruitingScopedRole({ role: 'player', coach_recruits_for_team: null }, null, true)).toBeNull()
  })
})
