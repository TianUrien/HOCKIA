import { isEuCountryCode } from '@/hooks/useCountries'
import type { DisplayPlace } from '@/lib/communityCard'

/**
 * Nationality is identity; location is where someone lives. A person's FLAG
 * always means nationality (up to two, in the order they set them); the
 * place is text with no flag ("Based in Santander, Spain"). Clubs keep their
 * country flag — for a club that flag IS the location. (Figma "07 ·
 * Nationality visibility", founder-approved 16 Oct 2026.)
 */
export interface NationalityCountry {
  id: number
  name: string
  flag: string | null
  isEu: boolean
}

type CountryLike = { id: number; name: string; common_name?: string | null; code?: string | null; flag_emoji?: string | null }

export function nationalityCountries(ids: (number | null | undefined)[], countries: CountryLike[]): NationalityCountry[] {
  return ids
    .filter((id): id is number => typeof id === 'number')
    .filter((id, i, all) => all.indexOf(id) === i)
    .slice(0, 2)
    .map((id) => countries.find((c) => c.id === id))
    .filter((c): c is CountryLike => Boolean(c))
    .map((c) => ({ id: c.id, name: c.common_name || c.name, flag: c.flag_emoji ?? null, isEu: isEuCountryCode(c.code) }))
}

/** Either passport is EU → the member can play in the EU without a permit. */
export function hasEuPassport(list: NationalityCountry[]): boolean {
  return list.some((c) => c.isEu)
}

/** "🇦🇷 🇮🇹" for a card line; null without flags. */
export function nationalityFlags(list: NationalityCountry[]): string | null {
  const flags = list.map((c) => c.flag).filter((f): f is string => Boolean(f))
  return flags.length > 0 ? flags.join(' ') : null
}

/** "🇦🇷 Argentina · 🇮🇹 Italy" — every nationality, never truncated to the first. */
export function nationalityNames(list: NationalityCountry[]): string | null {
  if (list.length === 0) return null
  return list.map((c) => [c.flag, c.name].filter(Boolean).join(' ')).join(' · ')
}

/** "Based in Santander, Spain": the place as text, no flag. Null when unknown. */
export function basedInLine(place: DisplayPlace | null | undefined): string | null {
  if (!place) return null
  const where = [place.city, place.country].filter(Boolean).join(', ')
  return where ? `Based in ${where}` : null
}

/** Card line 3 tail: "29 · Santander" (age, city only, no flag). */
export function ageCityLine(age: number | null | undefined, place: DisplayPlace | null | undefined): string | null {
  const city = place?.city ?? place?.country ?? null
  const parts = [typeof age === 'number' ? String(age) : null, city].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : null
}
