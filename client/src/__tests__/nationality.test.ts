import { describe, expect, it, vi } from 'vitest'

// CI's unit job has no Supabase env: useCountries (isEuCountryCode) imports the client transitively.
vi.mock('@/lib/supabase', () => ({ supabase: {} }))
import { ageCityLine, basedInLine, hasEuPassport, nationalityCountries, nationalityFlags, nationalityNames } from '@/lib/nationality'

const countries = [
  { id: 1, name: 'Argentina', common_name: 'Argentina', code: 'AR', flag_emoji: '🇦🇷' },
  { id: 2, name: 'Italy', common_name: 'Italy', code: 'IT', flag_emoji: '🇮🇹' },
  { id: 3, name: 'Spain', common_name: 'Spain', code: 'ES', flag_emoji: '🇪🇸' },
]

/** Founder-approved 16 Oct 2026 (Figma "07 · Nationality visibility"): a person's flag means nationality, never where they live. */
describe('nationality', () => {
  it('keeps the two nationalities in the order they were set, deduplicated, never the base country', () => {
    const list = nationalityCountries([1, 2, 1], countries)
    expect(list.map((c) => c.name)).toEqual(['Argentina', 'Italy'])
    expect(hasEuPassport(list)).toBe(true)
    expect(nationalityFlags(list)).toBe('🇦🇷 🇮🇹')
    expect(nationalityNames(list)).toBe('🇦🇷 Argentina · 🇮🇹 Italy')
    expect(hasEuPassport(nationalityCountries([1], countries))).toBe(false)
    expect(nationalityCountries([null, undefined, 99], countries)).toEqual([])
  })
  it('the place is text with no flag', () => {
    expect(basedInLine({ city: 'Santander', country: 'Spain', flag: '🇪🇸' })).toBe('Based in Santander, Spain')
    expect(basedInLine({ city: null, country: 'Spain', flag: '🇪🇸' })).toBe('Based in Spain')
    expect(basedInLine({ city: null, country: null, flag: null })).toBeNull()
    expect(ageCityLine(29, { city: 'Santander', country: 'Spain', flag: '🇪🇸' })).toBe('29 · Santander')
    expect(ageCityLine(null, { city: 'Santander', country: 'Spain', flag: '🇪🇸' })).toBe('Santander')
    expect(ageCityLine(36, null)).toBe('36')
  })
})
