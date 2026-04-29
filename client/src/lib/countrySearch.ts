// Relevance ranking for the country / nationality picker.
//
// Why this exists: the previous filter used substring-includes on every field
// and rendered alphabetically. For 2-letter queries that is hostile — typing
// "US" returns Australia, Austria, Belarus, Cyprus, Mauritius, Russia, then
// United States (alphabetical), so the obvious match is buried below six
// false friends. Tester reported this as "search doesn't work" for US, Amer,
// American.
//
// Scoring is deliberately simple — exact field matches first (where the user
// almost certainly meant that country), then prefix matches, then anything
// containing the query. Stable alphabetical ordering inside each tier.

import type { Country } from '@/hooks/useCountries'

const lower = (value: string | null | undefined): string =>
  (value ?? '').trim().toLowerCase()

/** Returns a relevance score for `country` against `query`. Higher = better.
 * Returns -1 when the country does not match at all (caller filters it out). */
export function scoreCountryMatch(country: Country, query: string): number {
  const q = query.trim().toLowerCase()
  if (!q) return 0

  const name = lower(country.name)
  const common = lower(country.common_name)
  const nationality = lower(country.nationality_name)
  const code = lower(country.code)
  const alpha3 = lower(country.code_alpha3)

  // Tier 1 — exact match on a short identifier the user likely typed.
  if (q === code) return 100
  if (q === alpha3) return 90
  if (q === nationality) return 80
  if (q === name || (common && q === common)) return 70

  // Tier 2 — prefix match. Nationality first because tester examples ("Amer")
  // most often hit demonyms.
  if (nationality.startsWith(q)) return 60
  if (name.startsWith(q) || (common && common.startsWith(q))) return 50
  if (alpha3.startsWith(q)) return 40

  // Tier 3 — substring match anywhere. Better than nothing, but ranked last.
  if (
    name.includes(q) ||
    nationality.includes(q) ||
    code.includes(q) ||
    alpha3.includes(q) ||
    (common && common.includes(q))
  ) {
    return 10
  }

  return -1
}

/** Filters and ranks `countries` by `query`, returning matches sorted by
 * relevance (best first), then alphabetically by name. Empty query returns
 * the input list as-is so the dropdown keeps its default ordering. */
export function searchCountries(countries: Country[], query: string): Country[] {
  if (!query.trim()) return countries

  const scored: Array<{ country: Country; score: number }> = []
  for (const country of countries) {
    const score = scoreCountryMatch(country, query)
    if (score >= 0) scored.push({ country, score })
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.country.name.localeCompare(b.country.name)
  })

  return scored.map((entry) => entry.country)
}
