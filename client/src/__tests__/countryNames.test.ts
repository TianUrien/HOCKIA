import { afterEach, describe, expect, it } from 'vitest'
import { countryLabel, nationalityLabel, placeText, setCountryNamesLanguage } from '@/i18n/countryNames'
import { COUNTRY_ALIASES, COUNTRY_ROWS } from '@/i18n/countryNamesEs'
import { searchCountries } from '@/lib/countrySearch'
import { nationalityLine } from '@/lib/nationalityLine'
import type { Country } from '@/hooks/useCountries'

const rows = COUNTRY_ROWS.trim().split('\n').map((line) => line.split('|'))

const country = (code: string): Country => {
  const [, name, nationality_name] = rows.find((r) => r[0] === code)!
  return { id: rows.findIndex((r) => r[0] === code) + 1, code, code_alpha3: code, name, common_name: null, nationality_name, region: null, flag_emoji: null }
}

afterEach(async () => { await setCountryNamesLanguage('en') })

describe('Spanish country table', () => {
  it('has one complete row for each of the 202 countries in the table', () => {
    expect(rows).toHaveLength(202)
    for (const row of rows) {
      expect(row).toHaveLength(4)
      for (const cell of row) expect(cell.trim()).not.toBe('')
    }
    expect(new Set(rows.map((r) => r[0])).size).toBe(202)
    expect(new Set(rows.map((r) => r[1])).size).toBe(202)
  })

  it('points every alias at a country in the table', () => {
    const names = new Set(rows.map((r) => r[1]))
    for (const line of COUNTRY_ALIASES.trim().split('\n')) expect(names.has(line.split('|')[1])).toBe(true)
  })
})

describe('country names follow the language', () => {
  it('leaves everything as stored in English', () => {
    expect(countryLabel('Spain')).toBe('Spain')
    expect(nationalityLabel('Argentine')).toBe('Argentine')
    expect(placeText('Madrid, Spain')).toBe('Madrid, Spain')
    expect(countryLabel(null)).toBeNull()
  })

  it('shows Spanish names in Spanish, whatever the case or spacing', async () => {
    await setCountryNamesLanguage('es')
    expect(countryLabel('Spain')).toBe('España')
    expect(countryLabel(' netherlands ')).toBe('Países Bajos')
    expect(countryLabel('England')).toBe('Inglaterra')
    expect(countryLabel('United States')).toBe('Estados Unidos')
    expect(countryLabel('USA')).toBe('Estados Unidos')
    expect(countryLabel('Türkiye')).toBe('Turquía')
  })

  it('keeps what it does not know, and empty values', async () => {
    await setCountryNamesLanguage('es')
    expect(countryLabel('Rosario')).toBe('Rosario')
    expect(countryLabel('')).toBe('')
    expect(countryLabel(undefined)).toBeUndefined()
  })

  it('shows a nationality as the country name, without a gendered form', async () => {
    await setCountryNamesLanguage('es')
    expect(nationalityLabel('Argentine')).toBe('Argentina')
    expect(nationalityLabel('Dutch')).toBe('Países Bajos')
    expect(nationalityLabel('Spain')).toBe('España')
    // Shared by two countries: cannot be told apart from the word alone.
    expect(nationalityLabel('Dominican')).toBe('Dominican')
    expect(nationalityLabel('Congolese')).toBe('Congolese')
  })

  it('translates only the country at the end of a stored place', async () => {
    await setCountryNamesLanguage('es')
    expect(placeText('Madrid, Spain')).toBe('Madrid, España')
    expect(placeText('Germany')).toBe('Alemania')
    expect(placeText('Rosario, Santa Fe')).toBe('Rosario, Santa Fe')
    expect(placeText('Georgia Tech, Atlanta')).toBe('Georgia Tech, Atlanta')
  })

  it('goes back to English when the language does', async () => {
    await setCountryNamesLanguage('es')
    await setCountryNamesLanguage('en')
    expect(countryLabel('Spain')).toBe('Spain')
  })
})

describe('screens built on the helpers', () => {
  const list = ['DE', 'ES', 'PE', 'AR', 'NL'].map(country)

  it('writes the nationality line with Spanish names', async () => {
    expect(nationalityLine([country('AR'), country('NL')], { label: 'demonym' })).toBe('Argentine, Dutch')
    await setCountryNamesLanguage('es')
    expect(nationalityLine([country('AR'), country('NL')], { label: 'demonym' })).toBe('Argentina, Países Bajos')
    expect(nationalityLine([country('ES')])).toBe('España')
  })

  it('finds a country by its Spanish name, with or without accents', async () => {
    await setCountryNamesLanguage('es')
    expect(searchCountries(list, 'Alemania').map((c) => c.code)).toEqual(['DE'])
    expect(searchCountries(list, 'peru').map((c) => c.code)).toEqual(['PE'])
    expect(searchCountries(list, 'países').map((c) => c.code)).toEqual(['NL'])
    // The English name and the code still work.
    expect(searchCountries(list, 'Germany').map((c) => c.code)).toEqual(['DE'])
    expect(searchCountries(list, 'ES')[0].code).toBe('ES')
  })

  it('searches exactly as before in English', () => {
    expect(searchCountries(list, 'Alemania')).toEqual([])
    expect(searchCountries(list, 'Germ').map((c) => c.code)).toEqual(['DE'])
  })
})
