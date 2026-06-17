import { describe, it, expect } from 'vitest'
import { expandCountryEquivalents } from '@/lib/countryEquivalents'

// Mirror the prod data: GB (United Kingdom) id 46, GB-ENG (England) id 202.
const COUNTRIES = [
  { id: 46, code: 'GB' },
  { id: 202, code: 'GB-ENG' },
  { id: 10, code: 'IT' },
  { id: 11, code: 'AR' },
]

describe('expandCountryEquivalents (GB <-> GB-ENG, mirrors the SQL)', () => {
  it('expands United Kingdom (GB) to include England (GB-ENG)', () => {
    expect(expandCountryEquivalents([46], COUNTRIES).sort((a, b) => a - b)).toEqual([46, 202])
  })

  it('expands England (GB-ENG) to include United Kingdom (GB) — symmetric', () => {
    expect(expandCountryEquivalents([202], COUNTRIES).sort((a, b) => a - b)).toEqual([46, 202])
  })

  it('leaves a non-UK selection untouched', () => {
    expect(expandCountryEquivalents([10], COUNTRIES)).toEqual([10])
  })

  it('preserves other ids while expanding the UK pair', () => {
    expect(expandCountryEquivalents([10, 46], COUNTRIES).sort((a, b) => a - b)).toEqual([10, 46, 202])
  })

  it('does not double-add when both GB and GB-ENG are already selected', () => {
    expect(expandCountryEquivalents([46, 202], COUNTRIES).sort((a, b) => a - b)).toEqual([46, 202])
  })

  it('no-ops on an empty selection', () => {
    expect(expandCountryEquivalents([], COUNTRIES)).toEqual([])
  })

  it('no-ops gracefully when the GB/GB-ENG codes are absent from the country list', () => {
    expect(expandCountryEquivalents([46], [{ id: 10, code: 'IT' }])).toEqual([46])
  })
})
