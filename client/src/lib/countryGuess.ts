import type { Country } from '@/hooks/useCountries'

/**
 * A best guess of the country in a free-text location ("Buenos Aires",
 * "Melbourne, Victoria", "London, UK"), for members whose profile has no
 * country yet. The member always confirms it; nothing is saved from a guess
 * alone (founder ruling 2026-11-07).
 */
const fold = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()

// Places and spellings members actually write, mapped to a country code.
// Only unambiguous ones: a guess the member has to correct is worse than none.
const ALIASES: Record<string, string> = {
  uk: 'GB', 'u k': 'GB', 'great britain': 'GB', inglaterra: 'GB-ENG', london: 'GB-ENG', manchester: 'GB-ENG',
  usa: 'US', 'u s a': 'US', 'estados unidos': 'US',
  italia: 'IT', espana: 'ES', brasil: 'BR', holanda: 'NL', 'paises bajos': 'NL', belgica: 'BE', alemania: 'DE', francia: 'FR',
  'buenos aires': 'AR', 'santiago del estero': 'AR', salta: 'AR', 'mar del plata': 'AR', cordoba: 'AR', mendoza: 'AR',
  tucuman: 'AR', rosario: 'AR', 'la plata': 'AR', 'san juan': 'AR', 'bahia blanca': 'AR', caba: 'AR',
  melbourne: 'AU', sydney: 'AU', perth: 'AU', brisbane: 'AU', adelaide: 'AU', canberra: 'AU', hobart: 'AU',
  auckland: 'NZ', wellington: 'NZ', christchurch: 'NZ',
  amsterdam: 'NL', rotterdam: 'NL', utrecht: 'NL', 'the hague': 'NL', antwerp: 'BE', brussels: 'BE',
  nairobi: 'KE', kisumu: 'KE', johannesburg: 'ZA', 'cape town': 'ZA', durban: 'ZA', pretoria: 'ZA',
  lahore: 'PK', karachi: 'PK', islamabad: 'PK', delhi: 'IN', 'new delhi': 'IN', mumbai: 'IN',
  santiago: 'CL', montevideo: 'UY',
}

export function guessCountry(location: string | null | undefined, countries: Country[]): Country | null {
  const text = (location ?? '').trim()
  if (!text || countries.length === 0) return null
  const byCode = new Map(countries.map((c) => [c.code, c]))
  const byName = new Map<string, Country>()
  for (const c of countries) {
    byName.set(fold(c.name), c)
    if (c.common_name) byName.set(fold(c.common_name), c)
  }
  // Last part first: "Salta, Argentina" names the country at the end.
  const parts = text.split(',').map(fold).filter(Boolean).reverse()
  for (const part of parts) {
    const named = byName.get(part)
    if (named) return named
    const code = ALIASES[part]
    if (code && byCode.get(code)) return byCode.get(code) ?? null
  }
  return null
}
