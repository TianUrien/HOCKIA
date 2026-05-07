import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, Building2, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import Flag from './Flag'
import type { WorldClubSearchResult } from './WorldClubSearch'

interface CountryItem {
  country_id: number
  country_code: string
  country_name: string
  flag_emoji: string
  total_clubs: number
}

interface WorldSearchDropdownProps {
  query: string
  onQueryChange: (value: string) => void
  countries: CountryItem[]
  getFlagUrl: (code: string) => string
}

export default function WorldSearchDropdown({
  query,
  onQueryChange,
  countries,
  getFlagUrl,
}: WorldSearchDropdownProps) {
  const navigate = useNavigate()
  const [clubResults, setClubResults] = useState<WorldClubSearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)

  const containerRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Client-side country filtering (instant)
  const matchedCountries = query.trim().length > 0
    ? countries.filter(c => c.country_name.toLowerCase().includes(query.toLowerCase())).slice(0, 5)
    : []

  // Combined items for keyboard nav
  const allItems = [
    ...matchedCountries.map(c => ({ type: 'country' as const, data: c })),
    ...clubResults.map(c => ({ type: 'club' as const, data: c })),
  ]

  // Debounced club search via RPC
  const searchClubs = useCallback(async (input: string) => {
    if (input.trim().length < 2) {
      setClubResults([])
      return
    }

    setIsSearching(true)
    try {
       
      const { data, error } = await supabase.rpc('search_world_clubs', {
        p_query: input.trim(),
        p_limit: 8,
      })
      if (error) throw error
      setClubResults((data || []) as WorldClubSearchResult[])
    } catch (err) {
      logger.error('[WorldSearchDropdown] Club search failed:', err)
      setClubResults([])
    } finally {
      setIsSearching(false)
    }
  }, [])

  const handleInputChange = (value: string) => {
    onQueryChange(value)
    setHighlightedIndex(-1)

    if (value.trim().length > 0) {
      setShowDropdown(true)
    } else {
      setShowDropdown(false)
      setClubResults([])
    }

    // Debounce club search
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => searchClubs(value), 300)
  }

  const handleCountrySelect = (country: CountryItem) => {
    setShowDropdown(false)
    onQueryChange('')
    navigate(`/world/${country.country_code.toLowerCase()}`)
  }

  const handleClubSelect = (club: WorldClubSearchResult) => {
    setShowDropdown(false)
    onQueryChange('')

    const countrySlug = club.country_code.toLowerCase()

    // Determine league + gender for navigation
    const leagueId = club.women_league_id || club.men_league_id
    const gender = club.women_league_id ? 'women' : 'men'

    const params = new URLSearchParams()
    params.set('club', club.id)
    if (leagueId) params.set('league', String(leagueId))
    if (gender === 'men') params.set('gender', 'men')

    if (club.province_slug) {
      navigate(`/world/${countrySlug}/${club.province_slug}?${params}`)
    } else {
      navigate(`/world/${countrySlug}?${params}`)
    }
  }

  const handleSelect = (index: number) => {
    const item = allItems[index]
    if (!item) return
    if (item.type === 'country') handleCountrySelect(item.data as CountryItem)
    else handleClubSelect(item.data as WorldClubSearchResult)
  }

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown || allItems.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightedIndex(i => Math.min(i + 1, allItems.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && highlightedIndex >= 0) {
      e.preventDefault()
      handleSelect(highlightedIndex)
    } else if (e.key === 'Escape') {
      setShowDropdown(false)
    }
  }

  // Click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Cleanup debounce
  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [])

  const hasCountries = matchedCountries.length > 0
  const hasClubs = clubResults.length > 0
  const hasAny = hasCountries || hasClubs || isSearching

  // Track offset for club section in flat index
  const clubStartIndex = matchedCountries.length

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
        <input
          type="search"
          data-keyboard-shortcut="search"
          placeholder="Search countries or clubs..."
          value={query}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => { if (query.trim().length > 0) setShowDropdown(true) }}
          onKeyDown={handleKeyDown}
          className="w-full pl-12 pr-4 py-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-sm"
          autoComplete="off"
          enterKeyHint="search"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        {isSearching && (
          <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-gray-400" />
        )}
      </div>

      {/* Dropdown */}
      {showDropdown && hasAny && (
        <div className="absolute z-50 mt-2 w-full rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden">
          <div className="max-h-80 overflow-y-auto">
            {/* Countries Section */}
            {hasCountries && (
              <div>
                <div className="px-3 py-1.5 bg-gray-50 text-[10px] font-semibold uppercase tracking-wider text-gray-400 sticky top-0">
                  Countries
                </div>
                {matchedCountries.map((country, i) => (
                  <button
                    key={country.country_id}
                    type="button"
                    onClick={() => handleCountrySelect(country)}
                    onMouseEnter={() => setHighlightedIndex(i)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                      highlightedIndex === i ? 'bg-purple-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <img
                      src={getFlagUrl(country.country_code)}
                      alt=""
                      className="w-7 h-5 rounded object-cover flex-shrink-0"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                    />
                    <span className="font-medium text-gray-900 text-sm">{country.country_name}</span>
                    <span className="text-xs text-gray-400 ml-auto">{country.total_clubs} clubs</span>
                  </button>
                ))}
              </div>
            )}

            {/* Clubs Section */}
            {(hasClubs || (isSearching && query.trim().length >= 2)) && (
              <div>
                <div className="px-3 py-1.5 bg-gray-50 text-[10px] font-semibold uppercase tracking-wider text-gray-400 sticky top-0 flex items-center justify-between">
                  <span>Clubs</span>
                  {isSearching && <Loader2 className="w-3 h-3 animate-spin text-gray-400" />}
                </div>
                {clubResults.map((club, i) => {
                  const flatIndex = clubStartIndex + i
                  const leagueName = club.women_league_name || club.men_league_name
                  return (
                    <button
                      key={club.id}
                      type="button"
                      onClick={() => handleClubSelect(club)}
                      onMouseEnter={() => setHighlightedIndex(flatIndex)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                        highlightedIndex === flatIndex ? 'bg-purple-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center flex-shrink-0 overflow-hidden">
                        {club.avatar_url ? (
                          <img
                            src={club.avatar_url}
                            alt=""
                            className="w-full h-full object-cover"
                            loading="eager"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                          />
                        ) : (
                          <Building2 className="w-4 h-4 text-gray-400" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-gray-900 text-sm truncate">{club.club_name}</p>
                        <p className="text-xs text-gray-400 truncate inline-flex items-center gap-1">
                          <Flag code={club.country_code} countryName={club.country_name} fallbackEmoji={club.flag_emoji} size="sm" />
                          <span className="truncate">
                            {club.country_name}
                            {club.province_name && ` · ${club.province_name}`}
                            {leagueName && ` · ${leagueName}`}
                          </span>
                        </p>
                      </div>
                    </button>
                  )
                })}
                {isSearching && !hasClubs && (
                  <div className="px-3 py-4 text-center text-sm text-gray-400">Searching clubs...</div>
                )}
                {!isSearching && !hasClubs && query.trim().length >= 2 && (
                  <div className="px-3 py-4 text-center text-sm text-gray-400">No clubs found</div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
