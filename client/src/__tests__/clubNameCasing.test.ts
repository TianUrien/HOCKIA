import { describe, expect, it } from 'vitest'
import { normalizeClubNameCasing } from '@/lib/clubNameCasing'

/** Same cases as supabase/tests/security/club_name_casing.probe.sql (the SQL rule owns them). */
const CLUB_NAME_CASING_CASES: Array<[string, string]> = [
  ['university of the western cape', 'University of the Western Cape'],
  ['club deportivo aleman', 'Club Deportivo Aleman'],
  ['jockey club de rosario', 'Jockey Club de Rosario'],
  ['te awamutu Hockey Club', 'Te Awamutu Hockey Club'],
  ['GCC Field hockey club', 'GCC Field Hockey Club'],
  ['seria A1', 'Seria A1'],
  ['La trobe', 'La Trobe'],
  ['de Terriers', 'De Terriers'],
  ['  servette  ', 'Servette'],
  ['ryde-hunters', 'Ryde-Hunters'],
  ['mcDonald park', 'mcDonald Park'],
  ['TSV  münchen   ost', 'TSV München Ost'],
  ['club atlético san isidro', 'Club Atlético San Isidro'],
  ['hc 1926', 'HC 1926'],
  ['the hague hc', 'The Hague HC'],
  ['Already Fine HC', 'Already Fine HC'],
]

describe('normalizeClubNameCasing (mirror of public.normalize_club_name_casing)', () => {
  it.each(CLUB_NAME_CASING_CASES)('%j → %j', (input, expected) => {
    expect(normalizeClubNameCasing(input)).toBe(expected)
  })

  it('is idempotent', () => {
    for (const [input] of CLUB_NAME_CASING_CASES) {
      const once = normalizeClubNameCasing(input)
      expect(normalizeClubNameCasing(once)).toBe(once)
    }
  })

  it('never changes letters other than the first of a lowercase word', () => {
    expect(normalizeClubNameCasing('hockey club')!.toLowerCase()).toBe('hockey club')
  })

  it('upper-cases club abbreviations typed in lowercase, never "Hc"', () => {
    expect(normalizeClubNameCasing('the hague hc')).toBe('The Hague HC')
    expect(normalizeClubNameCasing('dublin fc')).toBe('Dublin FC')
    expect(normalizeClubNameCasing('tsv mannheim')).toBe('TSV Mannheim')
    expect(normalizeClubNameCasing('Hc Rotterdam')).toBe('Hc Rotterdam') // mixed case stays as typed
  })

  it('keeps null and empty input', () => {
    expect(normalizeClubNameCasing(null)).toBeNull()
    expect(normalizeClubNameCasing('   ')).toBe('')
  })
})
