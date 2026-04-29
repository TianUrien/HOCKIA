import { describe, expect, it } from 'vitest'
import type { Country } from '@/hooks/useCountries'
import { scoreCountryMatch, searchCountries } from '@/lib/countrySearch'

const c = (over: Partial<Country>): Country => ({
  id: 0,
  code: '',
  code_alpha3: '',
  name: '',
  common_name: null,
  nationality_name: '',
  region: null,
  flag_emoji: null,
  ...over,
})

const COUNTRIES: Country[] = [
  c({ id: 1, code: 'US', code_alpha3: 'USA', name: 'United States', nationality_name: 'American' }),
  c({ id: 2, code: 'GB', code_alpha3: 'GBR', name: 'United Kingdom', nationality_name: 'British' }),
  c({ id: 3, code: 'AE', code_alpha3: 'ARE', name: 'United Arab Emirates', nationality_name: 'Emirati' }),
  c({ id: 4, code: 'AU', code_alpha3: 'AUS', name: 'Australia', nationality_name: 'Australian' }),
  c({ id: 5, code: 'AT', code_alpha3: 'AUT', name: 'Austria', nationality_name: 'Austrian' }),
  c({ id: 6, code: 'BY', code_alpha3: 'BLR', name: 'Belarus', nationality_name: 'Belarusian' }),
  c({ id: 7, code: 'CY', code_alpha3: 'CYP', name: 'Cyprus', nationality_name: 'Cypriot' }),
  c({ id: 8, code: 'RU', code_alpha3: 'RUS', name: 'Russia', nationality_name: 'Russian' }),
  c({ id: 9, code: 'CM', code_alpha3: 'CMR', name: 'Cameroon', nationality_name: 'Cameroonian' }),
]

const findUS = (results: Country[]) => results.findIndex((country) => country.code === 'US')

describe('scoreCountryMatch', () => {
  const us = COUNTRIES[0]

  it('scores exact ISO2 code match highest', () => {
    expect(scoreCountryMatch(us, 'US')).toBe(100)
    expect(scoreCountryMatch(us, 'us')).toBe(100)
  })

  it('scores exact ISO3 code match next', () => {
    expect(scoreCountryMatch(us, 'USA')).toBe(90)
  })

  it('scores exact nationality match next', () => {
    expect(scoreCountryMatch(us, 'American')).toBe(80)
  })

  it('scores exact country name match next', () => {
    expect(scoreCountryMatch(us, 'United States')).toBe(70)
  })

  it('scores nationality prefix match in mid tier', () => {
    expect(scoreCountryMatch(us, 'Amer')).toBe(60)
  })

  it('scores name prefix match below nationality prefix', () => {
    expect(scoreCountryMatch(us, 'Unite')).toBe(50)
  })

  it('scores generic substring match in lowest tier', () => {
    expect(scoreCountryMatch(COUNTRIES[3], 'us')).toBe(10) // Australia matches "us" via substring
  })

  it('returns -1 when nothing matches', () => {
    expect(scoreCountryMatch(us, 'xyz')).toBe(-1)
  })

  it('returns 0 for empty query', () => {
    expect(scoreCountryMatch(us, '')).toBe(0)
    expect(scoreCountryMatch(us, '   ')).toBe(0)
  })
})

describe('searchCountries', () => {
  it('puts United States first when typing "US" (was last alphabetically before)', () => {
    const results = searchCountries(COUNTRIES, 'US')
    expect(results[0].code).toBe('US')
  })

  it('puts United States first when typing "USA"', () => {
    const results = searchCountries(COUNTRIES, 'USA')
    expect(results[0].code).toBe('US')
  })

  it('puts United States first when typing "American"', () => {
    const results = searchCountries(COUNTRIES, 'American')
    expect(results[0].code).toBe('US')
  })

  it('puts United States first when typing "Amer" (was second to Cameroon before)', () => {
    const results = searchCountries(COUNTRIES, 'Amer')
    expect(results[0].code).toBe('US')
  })

  it('orders the three "United…" countries alphabetically when typing "United"', () => {
    const results = searchCountries(COUNTRIES, 'United')
    const names = results.slice(0, 3).map((c) => c.name)
    expect(names).toEqual(['United Arab Emirates', 'United Kingdom', 'United States'])
  })

  it('returns the input list unchanged for empty query', () => {
    const results = searchCountries(COUNTRIES, '')
    expect(results).toEqual(COUNTRIES)
  })

  it('drops countries that do not match', () => {
    const results = searchCountries(COUNTRIES, 'American')
    expect(results.find((c) => c.code === 'CM')).toBeUndefined() // Cameroon should not appear
    expect(findUS(results)).toBe(0)
  })

  it('is case-insensitive', () => {
    const lower = searchCountries(COUNTRIES, 'usa')
    const upper = searchCountries(COUNTRIES, 'USA')
    expect(lower).toEqual(upper)
  })
})
