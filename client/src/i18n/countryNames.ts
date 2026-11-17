/**
 * Country and nationality names in the interface language.
 *
 * The database keeps countries in English (`countries.name`,
 * `countries.nationality_name`, `profiles.location_country`, an opportunity's
 * country) and filters, matches and saves by those English values. So the
 * English value is never replaced: these helpers translate it at the moment
 * it is shown, and return it unchanged in English, for a name they do not
 * know (a city, free text) and before the Spanish table has loaded.
 *
 * Nationality in Spanish is shown as the country name ("Argentina", not
 * "argentino/a"): it reads naturally after a flag or the word
 * "Nacionalidad" and needs no gendered form (glossary: no generic
 * masculine). Lead decision 2026-11-17.
 *
 * The Spanish table is a separate chunk (countryNamesEs.ts) loaded by
 * setLanguage, so English members never download it.
 */
type Tables = { byName: Map<string, string>; byDemonym: Map<string, string> }

let active: Tables | null = null

const key = (value: string) => value.trim().toLowerCase()

function build(rows: string, aliases: string): Tables {
  const byName = new Map<string, string>()
  const demonyms = new Map<string, string | null>()
  for (const line of rows.trim().split('\n')) {
    const [, english, demonym, spanish] = line.split('|')
    byName.set(key(english), spanish)
    // A demonym two countries share ("Congolese", "Dominican") cannot be
    // told apart from the word alone: leave it as written.
    demonyms.set(key(demonym), demonyms.has(key(demonym)) ? null : spanish)
  }
  for (const line of aliases.trim().split('\n')) {
    const [alias, english] = line.split('|')
    const spanish = byName.get(key(english))
    if (spanish) byName.set(key(alias), spanish)
  }
  const byDemonym = new Map<string, string>()
  demonyms.forEach((spanish, demonym) => { if (spanish) byDemonym.set(demonym, spanish) })
  return { byName, byDemonym }
}

/** Called by setLanguage: loads the table for Spanish, drops it for English. */
export async function setCountryNamesLanguage(language: string): Promise<void> {
  if (language !== 'es') { active = null; return }
  const { COUNTRY_ROWS, COUNTRY_ALIASES } = await import('./countryNamesEs')
  active = build(COUNTRY_ROWS, COUNTRY_ALIASES)
}

/** "Spain" → "España" in Spanish. Unknown names and English: unchanged. */
export function countryLabel<T extends string | null | undefined>(name: T): T | string {
  if (!active || !name) return name
  return active.byName.get(key(name)) ?? name
}

/** "Argentine" → "Argentina" in Spanish (the country name). A country name works too. */
export function nationalityLabel<T extends string | null | undefined>(demonym: T): T | string {
  if (!active || !demonym) return demonym
  return active.byDemonym.get(key(demonym)) ?? active.byName.get(key(demonym)) ?? demonym
}

/**
 * A "City, Country" or "Country" line as stored: only the last part is
 * translated when it is a country ("Rosario, Argentina" stays, "Madrid,
 * Spain" → "Madrid, España").
 */
export function placeText<T extends string | null | undefined>(place: T): T | string {
  if (!active || !place) return place
  const parts = place.split(',')
  const last = parts[parts.length - 1]
  const spanish = active.byName.get(key(last))
  if (!spanish) return place
  parts[parts.length - 1] = last.replace(last.trim(), spanish)
  return parts.join(',')
}
