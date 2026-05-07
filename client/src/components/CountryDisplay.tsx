import Flag from '@/components/Flag'
import { useCountries } from '@/hooks/useCountries'

interface CountryDisplayProps {
  /** The country ID from a normalized *_country_id column (e.g., nationality_country_id). */
  countryId: number | null | undefined
  /** Fallback text to show if countryId is null but we have legacy text */
  fallbackText?: string | null
  /** If true, shows nationality name (e.g., "Argentine") instead of country name */
  showNationality?: boolean
  /** Additional CSS classes */
  className?: string
  /** If true, shows flag only without text */
  flagOnly?: boolean
}

/**
 * Displays a country with its flag.
 * Prioritizes the structured country_id over legacy text fields.
 * Renders flagcdn PNGs (consistent across OS) with emoji fallback when
 * the ISO code is missing — see <Flag /> for the rendering policy.
 *
 * Usage:
 * <CountryDisplay countryId={profile.nationality_country_id} fallbackText={profile.nationality} showNationality />
 */
export default function CountryDisplay({
  countryId,
  fallbackText,
  showNationality = false,
  className = '',
  flagOnly = false,
}: CountryDisplayProps) {
  const { getCountryById, loading } = useCountries()

  // If we have a country ID, use the structured data
  if (countryId) {
    const country = getCountryById(countryId)

    if (loading) {
      return <span className={className}>...</span>
    }

    if (country) {
      const displayText = showNationality ? country.nationality_name : country.name

      if (flagOnly) {
        return (
          <span className={className} title={displayText}>
            <Flag code={country.code} countryName={country.name} fallbackEmoji={country.flag_emoji} />
          </span>
        )
      }

      return (
        <span className={`inline-flex items-center gap-1.5 ${className}`}>
          <Flag code={country.code} countryName={country.name} fallbackEmoji={country.flag_emoji} />
          <span>{displayText}</span>
        </span>
      )
    }
  }

  // Fallback to legacy text if no country ID
  if (fallbackText) {
    return <span className={className}>{fallbackText}</span>
  }

  // Nothing to display
  return null
}
