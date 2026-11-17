import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { SPANISH_COUNTRY_NAMES, plainText, spanishCountryName } from './country-names-es.ts'

Deno.test('matches the table the app shows', async () => {
  const src = await Deno.readTextFile(new URL('../../../client/src/i18n/countryNamesEs.ts', import.meta.url))
  const body = src.split('COUNTRY_ROWS = `')[1].split('`')[0]
  const expected: Record<string, string> = {}
  for (const line of body.trim().split('\n')) {
    const parts = line.split('|')
    if (parts.length === 4 && parts[1] !== parts[3]) expected[parts[1].toLowerCase()] = parts[3]
  }
  assertEquals(SPANISH_COUNTRY_NAMES, expected)
})

Deno.test('names a country in Spanish and compares without accents', () => {
  assertEquals(spanishCountryName('England'), 'Inglaterra')
  assertEquals(spanishCountryName('Argentina'), 'Argentina')
  assertEquals(plainText('Países Bajos'), 'paises bajos')
})
