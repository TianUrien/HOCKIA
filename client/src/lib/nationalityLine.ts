/**
 * Nationalities are always ONE line (Figma redesign rule, 2026-09-21):
 * flags first, then the names joined with " · " — "🇦🇺 🏴 Australian ·
 * English". Callers render the result in a truncating element; it never
 * wraps or stacks, whatever the number of passports (two is the maximum:
 * nationality_country_id + nationality2_country_id).
 */
type CountryLike = { flag_emoji?: string | null; name: string; nationality_name?: string | null }

export function nationalityLine(
  countries: CountryLike[],
  options: { label?: 'country' | 'demonym'; suffix?: (c: CountryLike) => string | null } = {},
): string | null {
  if (countries.length === 0) return null
  const flags = countries.map((c) => c.flag_emoji).filter(Boolean).join(' ')
  const names = countries
    .map((c) => {
      const base = options.label === 'demonym' ? c.nationality_name?.trim() || c.name : c.name
      const extra = options.suffix?.(c)
      return extra ? `${base} ${extra}` : base
    })
    .join(' · ')
  return [flags, names].filter(Boolean).join(' ')
}
