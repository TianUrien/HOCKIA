/**
 * WorldPage - Global clubs directory landing page
 * 
 * Shows countries with clubs directory support
 * Uses world_countries_with_directory view as source of truth
 * Navigation: /world → /world/:countrySlug → /world/:countrySlug/:regionSlug (or direct to leagues)
 */

import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Globe, Building2, MapPin, Trophy, RefreshCw } from 'lucide-react'
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
    document.title = 'World | HOCKIA'
    fetchCountries()
  }, [fetchCountries])

  const filteredCountries = countries.filter(country =>
    country.country_name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const getRegionColor = (region: string) => {
    const colors: Record<string, string> = {
      'South America': 'bg-blue-100 text-blue-700',
      'Europe': 'bg-purple-100 text-purple-700',
      'Oceania': 'bg-cyan-100 text-cyan-700',
      'North America': 'bg-green-100 text-green-700',
      'Asia': 'bg-amber-100 text-amber-700',
      'Africa': 'bg-orange-100 text-orange-700',
    }
    return colors[region] || 'bg-gray-100 text-gray-700'
  }

  // Get the correct flag URL based on country code
  const getFlagUrl = (countryCode: string) => {
    // England uses XE code but needs gb-eng for flagcdn
    if (countryCode === 'XE') {
      return 'https://flagcdn.com/w160/gb-eng.png'
    }
    return `https://flagcdn.com/w160/${countryCode.toLowerCase()}.png`
  }

  // Handle country card click - open to public for discovery
  const handleCountryClick = (countryCode: string) => {
    navigate(`/world/${countryCode.toLowerCase()}`)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />

      <main className="mx-auto max-w-7xl px-4 pt-24 pb-12 md:px-6">
        {/* Page Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl mb-4">
            <Globe className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">World Hockey Directory</h1>
          <p className="text-gray-600 max-w-2xl mx-auto">
            Explore clubs and leagues from hockey communities around the world
          </p>
        </div>

        {/* Search */}
        <div className="max-w-xl mx-auto mb-8">
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
            <Globe className="w-12 h-12 text-gray-300 mx-auto mb-4" />
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
            <Globe className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">
              {searchQuery ? 'No countries found matching your search' : 'No countries available yet'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredCountries.map((country) => (
              <button
                type="button"
                key={country.country_id}
                className="bg-white rounded-2xl border border-gray-200 p-6 hover:shadow-lg hover:border-blue-200 transition-all cursor-pointer group text-left w-full"
                onClick={() => handleCountryClick(country.country_code)}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-full overflow-hidden shadow-sm border border-gray-200">
                      <img
                        src={getFlagUrl(country.country_code)}
                        alt={`${country.country_name} flag`}
                        loading="lazy"
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          // Fallback to emoji if image fails
                          const target = e.currentTarget;
                          target.style.display = 'none';
                          const span = document.createElement('span');
                          span.className = 'text-3xl';
                          span.textContent = country.flag_emoji || '🏳️';
                          const parent = target.parentElement!;
                          parent.replaceChildren(span);
                          parent.className = 'w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center';
                        }}
                      />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900 text-lg">{country.country_name}</h3>
                      <p className="text-sm text-gray-500">Explore clubs & leagues</p>
                    </div>
                  </div>
                  <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center group-hover:bg-blue-100 transition-colors">
                    <MapPin className="w-4 h-4 text-blue-500" />
                  </div>
                </div>

                {/* Region Badge */}
                <div className="mb-4 flex items-center gap-2">
                  <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${getRegionColor(country.region)}`}>
                    {country.region}
                  </span>
                  {!country.has_regions && (
                    <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                      National
                    </span>
                  )}
                </div>

                {/* Stats */}
                <div className="flex items-center gap-4 text-sm text-gray-600 mb-4">
                  <div className="flex items-center gap-1">
                    <Building2 className="w-4 h-4" />
                    <span className="text-gray-900 font-semibold">{country.total_clubs}</span>
                    <span>clubs</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Trophy className="w-4 h-4" />
                    <span className="text-gray-900 font-semibold">{country.league_count}</span>
                    <span>leagues</span>
                  </div>
                </div>

                {/* CTA */}
                <div
                  className="w-full py-2.5 bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-lg font-medium flex items-center justify-center gap-2 group-hover:from-blue-600 group-hover:to-cyan-600 transition-all"
                >
                  View Country
                  <span className="text-lg">→</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
