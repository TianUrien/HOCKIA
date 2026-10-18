import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { ageOn, normalizeClub, seasonDate, validateProfileDraft, yearsLabel } from './profile-draft.ts'

const today = new Date('2026-10-18T10:00:00Z')

Deno.test('reads the Figma example: two clubs, passports, a date of birth', () => {
  const d = validateProfileDraft({
    career: [
      { club_name: 'Club de Campo', city: 'Madrid', country: 'Spain', start_year: 2022, end_year: 2024, current: false },
      { club_name: 'Banco Provincia', city: 'Buenos Aires', country: 'Argentina', league: 'Metro A', start_year: 2019, end_year: 2022 },
    ],
    passports: ['Argentina', 'Spain'],
    date_of_birth: '2001-05-12',
  }, today)
  assertEquals(d.career.length, 2)
  assertEquals(d.career[1].league, 'Metro A')
  assertEquals(d.passports, ['Argentina', 'Spain'])
  assertEquals(d.date_of_birth, '2001-05-12')
})

Deno.test('drops what is invalid, never guesses', () => {
  const d = validateProfileDraft({
    career: [{ club_name: 'X' }, { club_name: 'Old Club', start_year: 2030, end_year: 1800 }, { club_name: 'Now Club', start_year: 2023, end_year: 2025, current: true }],
    passports: ['Spain', 'AB123456', 'Spain', 'France', 'Italy'],
    date_of_birth: '2001-02-30',
    position: 'striker',
  }, today)
  assertEquals(d.career.map((c) => c.club_name), ['Old Club', 'Now Club'])
  assertEquals(d.career[0].start_year, null) // 2030 out of range, 1800 out of range
  assertEquals(d.career[1].end_year, null) // current wins
  assertEquals(d.passports, ['Spain', 'France']) // numbers dropped, deduped, max 2
  assertEquals(d.date_of_birth, null)
  assertEquals(d.position, null)
})

Deno.test('seasons in the wrong order are swapped; labels and dates read well', () => {
  const [c] = validateProfileDraft({ career: [{ club_name: 'Club A', start_year: 2022, end_year: 2019 }] }, today).career
  assertEquals([c.start_year, c.end_year], [2019, 2022])
  assertEquals(yearsLabel(c), '2019 – 2022')
  assertEquals(yearsLabel({ ...c, start_month: 5, current: true, end_year: null }), 'May 2019 – Present')
  assertEquals(seasonDate(2019, null), '2019-01-01')
  assertEquals(seasonDate(2019, 9), '2019-09-01')
})

Deno.test('club names match without case, accents or filler words', () => {
  assertEquals(normalizeClub('Club de Campo'), normalizeClub('CLUB DE CAMPO'))
  assertEquals(normalizeClub('Real Club de Polo'), 'real polo')
  assertEquals(normalizeClub('Atlético San Isidro'), 'atletico san isidro')
})

Deno.test('age is whole years on the day', () => {
  assertEquals(ageOn('2008-10-19', today), 17)
  assertEquals(ageOn('2008-10-18', today), 18)
  assertEquals(ageOn('2001-05-12', today), 25)
})
