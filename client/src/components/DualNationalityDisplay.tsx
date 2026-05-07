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
   */
  mode?: 'full' | 'compact' | 'card' | 'tile'
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
    return <span className={className}>...</span>
  }

  const primaryCountry = getCountryById(primaryCountryId ?? null)
  const secondaryCountry = getCountryById(secondaryCountryId ?? null)

  const hasEuNationality =
    (primaryCountry?.id ? isEuCountry(primaryCountry.id) : false) ||
    (secondaryCountry?.id ? isEuCountry(secondaryCountry.id) : false)

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
        hasEuNationality={hasEuNationality}
        className={className}
      />
    )
  }

  if (mode === 'tile') {
    return (
      <TileDisplay
        primaryCountry={primaryCountry}
        secondaryCountry={secondaryCountry}
        hasEuNationality={hasEuNationality}
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
  hasEuNationality: boolean
  className: string
}

function CompactDisplay({ primaryCountry, secondaryCountry, hasEuNationality, className }: CompactDisplayProps) {
  const nationalities: { country: Country; name: string }[] = []

  if (primaryCountry) {
    nationalities.push({ country: primaryCountry, name: primaryCountry.nationality_name })
  }
  if (secondaryCountry) {
    nationalities.push({ country: secondaryCountry, name: secondaryCountry.nationality_name })
  }

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      {nationalities.map((nat, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          <Flag code={nat.country.code} countryName={nat.country.name} fallbackEmoji={nat.country.flag_emoji} />
          <span>{nat.name}</span>
          {i < nationalities.length - 1 && <span className="mx-1">,</span>}
        </span>
      ))}
      {hasEuNationality && (
        <span className="ml-0.5 text-xs text-blue-600 font-medium">EU</span>
      )}
    </span>
  )
}

/**
 * Tile-friendly display for community member cards. Each nationality is
 * a tight flag-name unit (`<flag> <name>`) and the row uses flex-wrap so
 * a long second nationality drops to a new line cleanly instead of
 * truncating mid-word. EU indicator renders as a small chip aligned to
 * the row, consistent with the role / tier pills above.
 */
function TileDisplay({ primaryCountry, secondaryCountry, hasEuNationality, className }: CompactDisplayProps) {
  const nationalities: Country[] = []
  if (primaryCountry) nationalities.push(primaryCountry)
  if (secondaryCountry) nationalities.push(secondaryCountry)
  if (nationalities.length === 0) return null

  return (
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${className}`}>
      {nationalities.map((country) => (
        <span key={country.id} className="inline-flex items-center gap-1 min-w-0">
          <Flag
            code={country.code}
            countryName={country.name}
            fallbackEmoji={country.flag_emoji}
            size="sm"
          />
          <span className="truncate">{country.nationality_name}</span>
        </span>
      ))}
      {hasEuNationality && (
        <span className="inline-flex items-center rounded bg-blue-50 px-1.5 py-px text-[10px] font-semibold text-blue-700">
          EU
        </span>
      )}
    </div>
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
