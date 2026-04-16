import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

// EU member state country codes (ISO 3166-1 alpha-2)
const EU_COUNTRY_CODES = new Set([
  'AT', // Austria
  'BE', // Belgium
  'BG', // Bulgaria
  'HR', // Croatia
  'CY', // Cyprus
  'CZ', // Czech Republic
  'DK', // Denmark
  'EE', // Estonia
  'FI', // Finland
  'FR', // France
  'DE', // Germany
  'GR', // Greece
  'HU', // Hungary
  'IE', // Ireland
  'IT', // Italy
  'LV', // Latvia
  'LT', // Lithuania
  'LU', // Luxembourg
  'MT', // Malta
  'NL', // Netherlands
  'PL', // Poland
  'PT', // Portugal
  'RO', // Romania
  'SK', // Slovakia
  'SI', // Slovenia
  'ES', // Spain
  'SE', // Sweden
])

export interface Country {
  id: number
  code: string
  code_alpha3: string
  name: string
  common_name: string | null
  nationality_name: string
  region: string | null
  flag_emoji: string | null
}

interface UseCountriesResult {
  countries: Country[]
  loading: boolean
  error: Error | null
  getCountryById: (id: number | null) => Country | undefined
  getCountryByCode: (code: string) => Country | undefined
  isEuCountry: (countryId: number | null) => boolean
}

let cachedCountries: Country[] | null = null
let inflightRequest: Promise<Country[]> | null = null

/**
 * Hook to fetch and cache the list of countries for dropdowns.
 * Countries are cached globally with request deduplication to avoid N+1 fetches
 * when many components mount simultaneously (e.g. Community page cards).
 */
export function useCountries(): UseCountriesResult {
  const [countries, setCountries] = useState<Country[]>(cachedCountries ?? [])
  const [loading, setLoading] = useState(!cachedCountries)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (cachedCountries) {
      setCountries(cachedCountries)
      setLoading(false)
      return
    }

    if (!inflightRequest) {
      inflightRequest = Promise.resolve(
        supabase
          .from('countries')
          .select('id, code, code_alpha3, name, common_name, nationality_name, region, flag_emoji')
          .order('name')
          .then(({ data, error: fetchError }) => {
            if (fetchError) throw new Error(fetchError.message)
            const countryList = (data ?? []) as Country[]
            cachedCountries = countryList
            return countryList
          })
      ).finally(() => {
        inflightRequest = null
      })
    }

    setLoading(true)
    inflightRequest!
      .then((countryList) => {
        setCountries(countryList)
      })
      .catch((err) => {
        setError(err instanceof Error ? err : new Error('Failed to fetch countries'))
      })
      .finally(() => {
        setLoading(false)
      })
  }, [])

  const getCountryById = (id: number | null): Country | undefined => {
    if (id === null) return undefined
    return countries.find((c) => c.id === id)
  }

  const getCountryByCode = (code: string): Country | undefined => {
    const upperCode = code.toUpperCase()
    return countries.find((c) => c.code === upperCode || c.code_alpha3 === upperCode)
  }

  const isEuCountry = (countryId: number | null): boolean => {
    if (countryId === null) return false
    const country = countries.find((c) => c.id === countryId)
    return country ? EU_COUNTRY_CODES.has(country.code) : false
  }

  return {
    countries,
    loading,
    error,
    getCountryById,
    getCountryByCode,
    isEuCountry,
  }
}

/**
 * Helper to format a country for display with flag emoji
 */
export function formatCountryDisplay(country: Country | undefined): string {
  if (!country) return ''
  const flag = country.flag_emoji ?? ''
  return `${flag} ${country.name}`.trim()
}

/**
 * Helper to format nationality for display
 */
export function formatNationalityDisplay(country: Country | undefined): string {
  if (!country) return ''
  const flag = country.flag_emoji ?? ''
  return `${flag} ${country.nationality_name}`.trim()
}
