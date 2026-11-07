import { describe, expect, it } from 'vitest'
import { guessCountry } from '@/lib/countryGuess'
import type { Country } from '@/hooks/useCountries'

const c = (id: number, code: string, name: string, common_name: string | null = null) =>
  ({ id, code, code_alpha3: '', name, common_name, nationality_name: '', region: null, flag_emoji: null }) as Country
const COUNTRIES = [c(48, 'AR', 'Argentina'), c(185, 'AU', 'Australia'), c(46, 'GB', 'United Kingdom'), c(202, 'GB-ENG', 'England'), c(9, 'IT', 'Italy'), c(10, 'KE', 'Kenya')]

// Members with no country on their profile get a guess they confirm (2026-11-07).
describe('guessCountry', () => {
  it('reads a country named in the text, last part first', () => {
    expect(guessCountry('Salta, Argentina', COUNTRIES)?.id).toBe(48)
    expect(guessCountry('London, United Kingdom', COUNTRIES)?.id).toBe(46)
  })
  it('knows the places members write without a country', () => {
    expect(guessCountry('Buenos Aires', COUNTRIES)?.id).toBe(48)
    expect(guessCountry('Santiago del estero', COUNTRIES)?.id).toBe(48)
    expect(guessCountry('Melbourne', COUNTRIES)?.id).toBe(185)
    expect(guessCountry('London', COUNTRIES)?.id).toBe(202)
    expect(guessCountry('Italia', COUNTRIES)?.id).toBe(9)
    expect(guessCountry('Nairobi', COUNTRIES)?.id).toBe(10)
  })
  it('makes no guess when unsure', () => {
    expect(guessCountry('Springfield', COUNTRIES)).toBeNull()
    expect(guessCountry('', COUNTRIES)).toBeNull()
    expect(guessCountry(null, COUNTRIES)).toBeNull()
  })
})
