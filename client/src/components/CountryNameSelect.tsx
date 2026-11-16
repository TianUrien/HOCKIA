import { useEffect, useState } from 'react'
import CountrySelect from './CountrySelect'
import { useCountries } from '@/hooks/useCountries'
import { useProfileEditT } from '@/i18n/ns/profileEdit'

interface CountryNameSelectProps {
  label?: string
  /** The country name (string value) */
  value: string | null | undefined
  /** Called with the country name (string) when selection changes */
  onChange: (countryName: string | null) => void
  placeholder?: string
  required?: boolean
  error?: string
  disabled?: boolean
  className?: string
}

/**
 * A wrapper around CountrySelect that works with country names (strings) 
 * instead of country IDs (numbers). This is useful for forms that store
 * country as a text field rather than a foreign key.
 */
export default function CountryNameSelect({
  label,
  value,
  onChange,
  placeholder,
  required = false,
  error,
  disabled = false,
  className,
}: CountryNameSelectProps) {
  const t = useProfileEditT()
  const { countries, loading } = useCountries()
  const [countryId, setCountryId] = useState<number | null>(null)

  // Convert country name to ID when value changes
  useEffect(() => {
    if (!value || loading) {
      setCountryId(null)
      return
    }

    // Try to find the country by name (case-insensitive)
    const normalizedValue = value.toLowerCase().trim()
    const country = countries.find(
      (c) =>
        c.name.toLowerCase() === normalizedValue ||
        c.common_name?.toLowerCase() === normalizedValue
    )

    setCountryId(country?.id ?? null)
  }, [value, countries, loading])

  // When user selects a country, convert ID to name
  const handleChange = (newCountryId: number | null) => {
    if (newCountryId === null) {
      onChange(null)
      setCountryId(null)
      return
    }

    const country = countries.find((c) => c.id === newCountryId)
    if (country) {
      onChange(country.name)
      setCountryId(newCountryId)
    }
  }

  return (
    <CountrySelect
      label={label}
      value={countryId}
      onChange={handleChange}
      placeholder={placeholder ?? t('countryNameSelect.placeholder')}
      required={required}
      error={error}
      disabled={disabled || loading}
      className={className}
    />
  )
}
