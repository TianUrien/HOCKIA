import { useCountries, type Country } from '@/hooks/useCountries'
import Flag from '@/components/Flag'

interface DualNationalityDisplayProps {
  /** Primary nationality country ID */
  primaryCountryId: number | null | undefined
  /** Secondary nationality country ID (optional) */
  secondaryCountryId?: number | null
  /** Fallback text for primary nationality if no country ID */
  fallbackText?: string | null
  /**
   * Display mode:
   *   - 'full' — profile pages (vertical, with EU pill)
   *   - 'compact' — inline rendering with full nationality names
   *   - 'card' — vertical with bullets
   *   - 'tile' — narrow community/member tiles. Single nationality shows
   *     flag + name; dual nationality drops the names entirely and shows
   *     just two flags + EU pill, since two long nationality names on a
   *     ~150px tile width truncate to "Aus, Engli EU" which reads worse
   *     than "🇦🇺🇬🇧 EU".
   *   - 'code' — ultra-compact flag + ISO3 code for the premium recruiter
   *     card ("🇳🇱 NLD · 🇦🇷 ARG · EU"). One trailing EU chip means the
   *     PERSON has EU eligibility (recruiter-relevant), not a per-country
   *     label.
   */
  mode?: 'full' | 'compact' | 'card' | 'tile' | 'code'
  /** Additional CSS classes */
  className?: string
}

/**
 * Displays nationality (and optional second nationality), with an EU indicator
 * derived from the nationality country IDs.
 */
export default function DualNationalityDisplay({
  primaryCountryId,
  secondaryCountryId,
  fallbackText,
  mode = 'full',
  className = '',
}: DualNationalityDisplayProps) {
  const { getCountryById, isEuCountry, loading } = useCountries()

  if (loading) {
    // While the country list loads, fall back to the legacy nationality
    // text rather than a bare "..." — the flag version replaces it once
    // the list resolves. Without this, a fresh page load of a profile
    // flashes (or, if the list is slow, sticks on) a meaningless "...".
    return fallbackText ? <span className={className}>{fallbackText}</span> : null
  }

  const primaryCountry = getCountryById(primaryCountryId ?? null)
  const secondaryCountry = getCountryById(secondaryCountryId ?? null)

  // Fallback to legacy text if no structured data
  if (!primaryCountry && !secondaryCountry) {
    if (fallbackText) {
      return <span className={className}>{fallbackText}</span>
    }
    return null
  }

  if (mode === 'compact') {
    return (
      <CompactDisplay
        primaryCountry={primaryCountry}
        secondaryCountry={secondaryCountry}
        isEuCountry={isEuCountry}
        className={className}
      />
    )
  }

  if (mode === 'tile') {
    return (
      <TileDisplay
        primaryCountry={primaryCountry}
        secondaryCountry={secondaryCountry}
        isEuCountry={isEuCountry}
        className={className}
      />
    )
  }

  if (mode === 'code') {
    return (
      <CodeDisplay
        primaryCountry={primaryCountry}
        secondaryCountry={secondaryCountry}
        isEuCountry={isEuCountry}
        className={className}
      />
    )
  }

  if (mode === 'card') {
    return (
      <CardDisplay
        primaryCountry={primaryCountry}
        secondaryCountry={secondaryCountry}
        isEuCountry={isEuCountry}
        className={className}
      />
    )
  }

  return (
    <FullDisplay
      primaryCountry={primaryCountry}
      secondaryCountry={secondaryCountry}
      isEuCountry={isEuCountry}
      className={className}
    />
  )
}

interface CompactDisplayProps {
  primaryCountry: Country | undefined
  secondaryCountry: Country | undefined
  isEuCountry: (id: number | null) => boolean
  className: string
}

/**
 * Inline display with full nationality names. The EU indicator is
 * attached to its OWN nationality (e.g. Dutch + Argentine renders as
 * "🇳🇱 Dutch EU · 🇦🇷 Argentine") — not appended at the end of the row,
 * which previously implied Argentina was EU.
 *
 * Layout uses flex-wrap so a long second nationality drops cleanly to a
 * new line in a narrow grid cell instead of overlapping siblings (the
 * "EU on top of Argentine" bug). Each flag+name+EU unit is
 * whitespace-nowrap so it never breaks mid-flag.
 */
function CompactDisplay({ primaryCountry, secondaryCountry, isEuCountry, className }: CompactDisplayProps) {
  const nationalities: Country[] = []
  if (primaryCountry) nationalities.push(primaryCountry)
  if (secondaryCountry) nationalities.push(secondaryCountry)
  if (nationalities.length === 0) return null

  return (
    <span className={`inline-flex flex-wrap items-center gap-x-2 gap-y-1 ${className}`}>
      {nationalities.map((country, i) => {
        const isEu = isEuCountry(country.id)
        return (
          <span key={country.id} className="inline-flex items-center gap-1 whitespace-nowrap min-w-0">
            <Flag code={country.code} countryName={country.name} fallbackEmoji={country.flag_emoji} />
            <span>{country.nationality_name}</span>
            {isEu && (
              <span className="ml-0.5 text-[10px] font-semibold text-blue-600 uppercase tracking-wide">
                EU
              </span>
            )}
            {i < nationalities.length - 1 && <span className="text-gray-300 ml-1">·</span>}
          </span>
        )
      })}
    </span>
  )
}

/**
 * Tile-friendly display for community member cards. Same per-country EU
 * attachment logic as CompactDisplay — the EU chip lives inside its own
 * nationality unit so it never visually attaches to a non-EU country.
 */
function TileDisplay({ primaryCountry, secondaryCountry, isEuCountry, className }: CompactDisplayProps) {
  const nationalities: Country[] = []
  if (primaryCountry) nationalities.push(primaryCountry)
  if (secondaryCountry) nationalities.push(secondaryCountry)
  if (nationalities.length === 0) return null

  return (
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${className}`}>
      {nationalities.map((country) => {
        const isEu = isEuCountry(country.id)
        return (
          <span key={country.id} className="inline-flex items-center gap-1 whitespace-nowrap min-w-0">
            <Flag
              code={country.code}
              countryName={country.name}
              fallbackEmoji={country.flag_emoji}
              size="sm"
            />
            <span className="truncate">{country.nationality_name}</span>
            {isEu && (
              <span className="inline-flex items-center rounded bg-blue-50 px-1.5 py-px text-[10px] font-semibold text-blue-700">
                EU
              </span>
            )}
          </span>
        )
      })}
    </div>
  )
}

/**
 * Ultra-compact flag + ISO3 code, for the premium recruiter card.
 * "🇳🇱 NLD · 🇦🇷 ARG · EU" — a single trailing EU chip indicates the
 * person holds EU eligibility (the recruiter-relevant fact), so it's
 * intentionally NOT attached per-country here.
 */
function CodeDisplay({ primaryCountry, secondaryCountry, isEuCountry, className }: CompactDisplayProps) {
  const nationalities: Country[] = []
  if (primaryCountry) nationalities.push(primaryCountry)
  if (secondaryCountry) nationalities.push(secondaryCountry)
  if (nationalities.length === 0) return null
  const anyEu = nationalities.some((c) => isEuCountry(c.id))

  return (
    <span className={`inline-flex flex-wrap items-center gap-x-1 gap-y-0.5 text-xs text-gray-700 ${className}`}>
      {nationalities.map((country, i) => (
        <span key={country.id} className="inline-flex items-center gap-1 whitespace-nowrap">
          <Flag code={country.code} countryName={country.name} fallbackEmoji={country.flag_emoji} size="sm" />
          <span className="font-medium">{country.code_alpha3}</span>
          {(i < nationalities.length - 1 || anyEu) && <span className="mx-0.5 text-gray-300">·</span>}
        </span>
      ))}
      {anyEu && (
        <span className="inline-flex items-center rounded bg-blue-50 px-1 py-px text-[10px] font-semibold text-blue-700">
          EU
        </span>
      )}
    </span>
  )
}

interface CardDisplayProps {
  primaryCountry: Country | undefined
  secondaryCountry: Country | undefined
  isEuCountry: (id: number | null) => boolean
  className: string
}

/**
 * Card display with vertical bullet-point layout:
 * • 🇦🇷 Argentina
 * • 🇮🇹 Italy (EU)
 */
function CardDisplay({
  primaryCountry,
  secondaryCountry,
  isEuCountry,
  className,
}: CardDisplayProps) {
  // Determine which nationalities are EU
  const primaryIsEu = primaryCountry ? isEuCountry(primaryCountry.id) : false
  const secondaryIsEu = secondaryCountry ? isEuCountry(secondaryCountry.id) : false

  // For single nationality, show without bullet
  const hasDualNationality = primaryCountry && secondaryCountry

  if (!hasDualNationality && primaryCountry) {
    return (
      <span className={`inline-flex items-center gap-1.5 ${className}`}>
        <Flag code={primaryCountry.code} countryName={primaryCountry.name} fallbackEmoji={primaryCountry.flag_emoji} />
        <span>{primaryCountry.name}</span>
        {primaryIsEu && (
          <span className="text-xs text-blue-600 font-medium">(EU)</span>
        )}
      </span>
    )
  }

  return (
    <div className={`flex flex-col gap-0.5 ${className}`}>
      {primaryCountry && (
        <div className="flex items-center gap-1.5">
          <span className="text-gray-400">•</span>
          <Flag code={primaryCountry.code} countryName={primaryCountry.name} fallbackEmoji={primaryCountry.flag_emoji} />
          <span>{primaryCountry.name}</span>
          {primaryIsEu && (
            <span className="text-xs text-blue-600 font-medium">(EU)</span>
          )}
        </div>
      )}
      {secondaryCountry && (
        <div className="flex items-center gap-1.5">
          <span className="text-gray-400">•</span>
          <Flag code={secondaryCountry.code} countryName={secondaryCountry.name} fallbackEmoji={secondaryCountry.flag_emoji} />
          <span>{secondaryCountry.name}</span>
          {secondaryIsEu && (
            <span className="text-xs text-blue-600 font-medium">(EU)</span>
          )}
        </div>
      )}
    </div>
  )
}

interface FullDisplayProps {
  primaryCountry: Country | undefined
  secondaryCountry: Country | undefined
  isEuCountry: (id: number | null) => boolean
  className: string
}

function FullDisplay({
  primaryCountry,
  secondaryCountry,
  isEuCountry,
  className,
}: FullDisplayProps) {
  // Determine which nationalities are EU
  const primaryIsEu = primaryCountry ? isEuCountry(primaryCountry.id) : false
  const secondaryIsEu = secondaryCountry ? isEuCountry(secondaryCountry.id) : false

  return (
    <div className={`flex flex-col gap-0.5 ${className}`}>
      {/* Primary nationality */}
      {primaryCountry && (
        <div className="flex items-center gap-1.5">
          <Flag code={primaryCountry.code} countryName={primaryCountry.name} fallbackEmoji={primaryCountry.flag_emoji} />
          <span className="font-medium">{primaryCountry.nationality_name}</span>
          {primaryIsEu && (
            <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">
              EU
            </span>
          )}
        </div>
      )}

      {/* Secondary nationality */}
      {secondaryCountry && (
        <div className="flex items-center gap-1.5">
          <Flag code={secondaryCountry.code} countryName={secondaryCountry.name} fallbackEmoji={secondaryCountry.flag_emoji} />
          <span className="font-medium">{secondaryCountry.nationality_name}</span>
          {secondaryIsEu && (
            <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">
              EU
            </span>
          )}
        </div>
      )}

    </div>
  )
}

/**
 * Compact inline display for cards - shows flags only with tooltip
 */
export function NationalityFlagsInline({
  primaryCountryId,
  secondaryCountryId,
  fallbackText,
  className = '',
}: Omit<DualNationalityDisplayProps, 'mode'>) {
  return (
    <DualNationalityDisplay
      primaryCountryId={primaryCountryId}
      secondaryCountryId={secondaryCountryId}
      fallbackText={fallbackText}
      mode="compact"
      className={className}
    />
  )
}

/**
 * Vertical card display with bullets for dual nationality
 */
export function NationalityCardDisplay({
  primaryCountryId,
  secondaryCountryId,
  fallbackText,
  className = '',
}: Omit<DualNationalityDisplayProps, 'mode'>) {
  return (
    <DualNationalityDisplay
      primaryCountryId={primaryCountryId}
      secondaryCountryId={secondaryCountryId}
      fallbackText={fallbackText}
      mode="card"
      className={className}
    />
  )
}
