/**
 * WorldPage - Global clubs directory landing page
 * 
 * Shows countries with clubs directory support
 * Uses world_countries_with_directory view as source of truth
 * Navigation: /world → /world/:countrySlug → /world/:countrySlug/:regionSlug (or direct to leagues)
 */

import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, Globe, RefreshCw } from 'lucide-react'
import { Header } from '@/components'
import WorldSearchDropdown from '@/components/WorldSearchDropdown'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'

interface CountryWithStats {
  country_id: number
  country_code: string
  country_name: string
  flag_emoji: string
  region: string
  has_regions: boolean
  total_clubs: number
  league_count: number
}

// Daily shuffle: deterministic seed from today's date so order is
// stable within a day but rotates across days.
function dailyShuffle<T>(arr: T[]): T[] {
  const today = new Date().toISOString().slice(0, 10) // "2026-02-13"
  let seed = 0
  for (let i = 0; i < today.length; i++) seed = (seed * 31 + today.charCodeAt(i)) | 0

  const shuffled = [...arr]
  for (let i = shuffled.length - 1; i > 0; i--) {
    seed = (seed * 16807 + 0) % 2147483647 // LCG
    const j = ((seed < 0 ? -seed : seed) % (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}

export default function WorldPage() {
  const navigate = useNavigate()
  const [countries, setCountries] = useState<CountryWithStats[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const fetchCountries = useCallback(async () => {
    try {
      setError(false)
      setLoading(true)

      // The view already provides total_clubs and total_leagues — no extra queries needed
      const { data, error: fetchErr } = await supabase
        .from('world_countries_with_directory')
        .select('*')

      if (fetchErr) throw fetchErr

      const mapped: CountryWithStats[] = (data || [])
        .filter(row => row.country_id)
        .map(row => ({
          country_id: row.country_id ?? 0,
          country_code: row.country_code ?? '',
          country_name: row.country_name ?? '',
          flag_emoji: row.flag_emoji ?? '🏳️',
          region: row.region ?? '',
          has_regions: row.has_regions ?? false,
          total_clubs: row.total_clubs ?? 0,
          league_count: row.total_leagues ?? 0,
        }))

      setCountries(dailyShuffle(mapped))
    } catch (err) {
      logger.error('[WorldPage] Failed to fetch countries:', err)
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    document.title = 'World | Hockia'
    fetchCountries()
  }, [fetchCountries])

  const filteredCountries = countries.filter(country =>
    country.country_name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  // Get the correct flag URL based on country code (e.g. "GB-ENG" → "gb-eng")
  const getFlagUrl = (countryCode: string) => {
    return `https://flagcdn.com/w160/${countryCode.toLowerCase()}.png`
  }

  // Handle country card click - open to public for discovery
  const handleCountryClick = (countryCode: string) => {
    navigate(`/world/${countryCode.toLowerCase()}`)
  }

  return (
    <div className="min-h-screen bg-surface-subtle">
      <Header />

      <main className="mx-auto max-w-3xl px-4 pt-under-header-lg pb-12 md:px-6">
        {/* Page Header */}
        <div className="mb-5">
          <h1 className="text-title text-ink-1">Explore clubs &amp; leagues</h1>
          <p className="mt-2 text-[17px] leading-[22px] text-ink-2">Every club and league we know, by country.</p>
        </div>

        {/* Search */}
        <div className="mb-5">
          <WorldSearchDropdown
            query={searchQuery}
            onQueryChange={setSearchQuery}
            countries={countries}
            getFlagUrl={getFlagUrl}
          />
        </div>

        {/* Countries Grid */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white rounded-2xl border border-gray-200 p-6 animate-pulse">
                <div className="flex items-start gap-4 mb-4">
                  <div className="w-14 h-14 bg-gray-200 rounded-full" />
                  <div className="flex-1">
                    <div className="h-5 bg-gray-200 rounded w-24 mb-2" />
                    <div className="h-4 bg-gray-100 rounded w-32" />
                  </div>
                </div>
                <div className="h-10 bg-gray-100 rounded-lg" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <Globe className="w-12 h-12 text-gray-500 mx-auto mb-4" />
            <p className="text-gray-700 font-medium mb-1">Unable to load countries</p>
            <p className="text-sm text-gray-500 mb-4">Check your connection and try again</p>
            <button
              type="button"
              onClick={() => fetchCountries()}
              className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Retry
            </button>
          </div>
        ) : filteredCountries.length === 0 ? (
          <div className="text-center py-12">
            <Globe className="w-12 h-12 text-gray-500 mx-auto mb-4" />
            <p className="text-gray-500">
              {searchQuery ? 'No countries found matching your search' : 'No countries available yet'}
            </p>
          </div>
        ) : (
          // Rebrand page 28 · Explore clubs & leagues: one compact row per
          // country (flag, name, counts, chevron), two columns on wide screens.
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {filteredCountries.map((country) => (
              <li key={country.country_id}>
                <button
                  type="button"
                  className="flex min-h-[60px] w-full items-center gap-3 rounded-[16px] bg-white px-4 py-3 text-left ring-1 ring-inset ring-line transition-colors hover:bg-surface-subtle active:bg-surface-muted"
                  onClick={() => handleCountryClick(country.country_code)}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-surface-muted ring-1 ring-inset ring-line">
                    <img
                      src={getFlagUrl(country.country_code)}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                      onError={(e) => {
                        // Fallback to the emoji flag if the image fails
                        const target = e.currentTarget
                        const span = document.createElement('span')
                        span.className = 'text-xl'
                        span.textContent = country.flag_emoji || '🏳️'
                        target.parentElement?.replaceChildren(span)
                      }}
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[16px] font-semibold leading-[21px] text-ink-1">{country.country_name}</span>
                    <span className="block truncate text-secondary text-ink-2">
                      {country.total_clubs} {country.total_clubs === 1 ? 'club' : 'clubs'} · {country.league_count} {country.league_count === 1 ? 'league' : 'leagues'}
                    </span>
                  </span>
                  <ChevronRight className="h-[18px] w-[18px] shrink-0 text-ink-4" strokeWidth={1.75} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}
