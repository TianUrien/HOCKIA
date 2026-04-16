import { useState, useRef, useEffect, useCallback, useId } from 'react'
import { Building2, Check, Globe2, Loader2, Plus, Search, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import StorageImage from './StorageImage'

// ── Types ──────────────────────────────────────────────────────────────────

export interface WorldClubSearchResult {
  id: string
  club_name: string
  club_name_normalized: string
  avatar_url: string | null
  country_id: number
  country_name: string
  country_code: string
  flag_emoji: string | null
  province_id: number | null
  province_name: string | null
  province_slug: string | null
  men_league_id: number | null
  women_league_id: number | null
  men_league_name: string | null
  women_league_name: string | null
  men_league_tier: number | null
  women_league_tier: number | null
  is_claimed: boolean
}

interface WorldClubSearchProps {
  value: string
  onChange: (value: string) => void
  onClubSelect: (club: WorldClubSearchResult) => void
  onClubClear: () => void
  selectedClubId: string | null
  placeholder?: string
  label?: string
  required?: boolean
  error?: string
  disabled?: boolean
  id?: string
}

interface WorldCountryOption {
  country_id: number | null
  country_name: string | null
  country_code: string | null
  flag_emoji: string | null
  has_regions: boolean | null
}

interface RegionOption {
  id: number
  name: string
}

// ── Component ──────────────────────────────────────────────────────────────

export default function WorldClubSearch({
  value,
  onChange,
  onClubSelect,
  onClubClear,
  selectedClubId,
  placeholder = 'Search clubs...',
  label,
  required = false,
  error,
  disabled = false,
  id: externalId,
}: WorldClubSearchProps) {
  const generatedId = useId()
  const inputId = externalId || `world-club-search-${generatedId}`

  // Search state
  const [results, setResults] = useState<WorldClubSearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)

  // "Add to directory" state
  const [showAddForm, setShowAddForm] = useState(false)
  const [addCountries, setAddCountries] = useState<WorldCountryOption[]>([])
  const [addRegions, setAddRegions] = useState<RegionOption[]>([])
  const [addCountryId, setAddCountryId] = useState<number | null>(null)
  const [addRegionId, setAddRegionId] = useState<number | null>(null)
  const [addCountryHasRegions, setAddCountryHasRegions] = useState(false)
  const [isCreating, setIsCreating] = useState(false)

  // Refs
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // ── Search ─────────────────────────────────────────────────────────────

  const searchClubs = useCallback(async (query: string) => {
    if (query.trim().length < 2) {
      setResults([])
      setShowDropdown(false)
      return
    }

    setIsSearching(true)
    try {
       
      const { data, error: rpcError } = await supabase.rpc('search_world_clubs', {
        p_query: query.trim(),
      }) as { data: WorldClubSearchResult[] | null; error: Error | null }

      if (rpcError) throw rpcError

      setResults(data || [])
      setShowDropdown(true)
      setHighlightedIndex(-1)
    } catch (err) {
      logger.error('[WorldClubSearch] Search failed:', err)
      setResults([])
    } finally {
      setIsSearching(false)
    }
  }, [])

  const handleInputChange = useCallback((newValue: string) => {
    onChange(newValue)

    // If there's a linked club and user starts typing differently, clear the link
    if (selectedClubId) {
      onClubClear()
    }

    // Debounced search
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => searchClubs(newValue), 300)
  }, [onChange, selectedClubId, onClubClear, searchClubs])

  // ── Selection ──────────────────────────────────────────────────────────

  const handleSelect = useCallback((club: WorldClubSearchResult) => {
    onClubSelect(club)
    setShowDropdown(false)
    setShowAddForm(false)
    setResults([])
  }, [onClubSelect])

  const handleClear = useCallback(() => {
    onClubClear()
    inputRef.current?.focus()
  }, [onClubClear])

  // ── "Add to Directory" ─────────────────────────────────────────────────

  const openAddForm = useCallback(async () => {
    setShowAddForm(true)
    setAddCountryId(null)
    setAddRegionId(null)
    setAddRegions([])
    setAddCountryHasRegions(false)

    // Fetch countries with World directory
    try {
      const { data } = await supabase
        .from('world_countries_with_directory')
        .select('country_id, country_name, country_code, flag_emoji, has_regions')
        .order('country_name')

      setAddCountries(data || [])
    } catch (err) {
      logger.error('[WorldClubSearch] Failed to fetch countries:', err)
    }
  }, [])

  const handleAddCountryChange = useCallback(async (countryId: number) => {
    setAddCountryId(countryId)
    setAddRegionId(null)

    const country = addCountries.find(c => c.country_id === countryId)
    const hasRegions = country?.has_regions ?? false
    setAddCountryHasRegions(hasRegions)

    if (hasRegions) {
      try {
        const { data } = await supabase
          .from('world_provinces')
          .select('id, name')
          .eq('country_id', countryId)
          .order('name')

        setAddRegions(data || [])
      } catch (err) {
        logger.error('[WorldClubSearch] Failed to fetch regions:', err)
      }
    } else {
      setAddRegions([])
    }
  }, [addCountries])

  const handleCreateClub = useCallback(async () => {
    if (!value.trim() || !addCountryId) return

    setIsCreating(true)
    try {
       
      const { data, error: rpcError } = await supabase.rpc('create_world_club_from_career', {
        p_club_name: value.trim(),
        p_country_id: addCountryId,
        p_province_id: addRegionId ?? undefined,
      }) as { data: { success: boolean; club_id: string; club_name: string; avatar_url: string | null; already_exists: boolean } | null; error: Error | null }

      if (rpcError) throw rpcError
      if (!data?.success) throw new Error('Failed to create club')

      // Get the full club info for the callback
      const country = addCountries.find(c => c.country_id === addCountryId)
      const region = addRegions.find(r => r.id === addRegionId)

      const newClub: WorldClubSearchResult = {
        id: data.club_id,
        club_name: data.club_name,
        club_name_normalized: data.club_name.toLowerCase(),
        avatar_url: data.avatar_url,
        country_id: addCountryId,
        country_name: country?.country_name || '',
        country_code: country?.country_code || '',
        flag_emoji: country?.flag_emoji || null,
        province_id: addRegionId,
        province_name: region?.name || null,
        province_slug: null,
        men_league_id: null,
        women_league_id: null,
        men_league_name: null,
        women_league_name: null,
        men_league_tier: null,
        women_league_tier: null,
        is_claimed: false,
      }

      handleSelect(newClub)
    } catch (err) {
      logger.error('[WorldClubSearch] Failed to create club:', err)
    } finally {
      setIsCreating(false)
    }
  }, [value, addCountryId, addRegionId, addCountries, addRegions, handleSelect])

  // ── Keyboard navigation ────────────────────────────────────────────────

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!showDropdown || results.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightedIndex(i => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && highlightedIndex >= 0) {
      e.preventDefault()
      handleSelect(results[highlightedIndex])
    } else if (e.key === 'Escape') {
      setShowDropdown(false)
      setShowAddForm(false)
    }
  }, [showDropdown, results, highlightedIndex, handleSelect])

  // ── Click outside ──────────────────────────────────────────────────────

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
        setShowAddForm(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Cleanup debounce
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  // ── Render ─────────────────────────────────────────────────────────────

  const isLinked = Boolean(selectedClubId)

  return (
    <div ref={containerRef} className="relative">
      {label && (
        <label htmlFor={inputId} className="text-sm font-medium text-gray-700">
          {label}
          {required && <span className="text-red-500">*</span>}
        </label>
      )}

      <div className="relative mt-1">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
          {isSearching ? (
            <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
          ) : isLinked ? (
            <Check className="h-4 w-4 text-emerald-500" />
          ) : (
            <Search className="h-4 w-4 text-gray-400" />
          )}
        </div>

        <input
          ref={inputRef}
          id={inputId}
          type="search"
          value={value}
          onChange={e => handleInputChange(e.target.value)}
          onFocus={() => { if (value.trim().length >= 2 && !isLinked) searchClubs(value) }}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={placeholder}
          autoComplete="off"
          enterKeyHint="search"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className={`w-full rounded-lg border py-2.5 pl-10 pr-10 focus:border-transparent focus:ring-2 focus:ring-indigo-500 ${
            error ? 'border-red-400' : isLinked ? 'border-emerald-300 bg-emerald-50/30' : 'border-gray-300'
          } ${disabled ? 'cursor-not-allowed bg-gray-50' : ''}`}
        />

        {/* Right side: linked badge or clear */}
        <div className="absolute inset-y-0 right-0 flex items-center pr-2">
          {isLinked && (
            <>
              <span className="mr-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                Linked
              </span>
              <button
                type="button"
                onClick={handleClear}
                className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                title="Unlink club"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}

      {/* ── Dropdown ── */}
      {showDropdown && !isLinked && (
        <div className="absolute z-50 mt-1 w-full rounded-xl border border-gray-200 bg-white shadow-lg">
          {results.length > 0 && (
            <ul className="max-h-60 overflow-y-auto py-1">
              {results.map((club, index) => {
                const leagueName = club.men_league_name || club.women_league_name
                const tier = club.men_league_tier ?? club.women_league_tier

                return (
                  <li key={club.id}>
                    <button
                      type="button"
                      onClick={() => handleSelect(club)}
                      onMouseEnter={() => setHighlightedIndex(index)}
                      className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                        index === highlightedIndex ? 'bg-indigo-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      {/* Club avatar */}
                      {club.avatar_url ? (
                        <StorageImage
                          src={club.avatar_url}
                          alt=""
                          className="h-full w-full rounded-lg object-cover"
                          containerClassName="h-8 w-8 min-w-[2rem] rounded-lg"
                          fallbackClassName="h-8 w-8 rounded-lg bg-gray-100"
                          fallback={<Building2 className="h-4 w-4 text-gray-400" />}
                        />
                      ) : (
                        <div className="flex h-8 w-8 min-w-[2rem] items-center justify-center rounded-lg bg-gray-100">
                          <Building2 className="h-4 w-4 text-gray-400" />
                        </div>
                      )}

                      {/* Club info */}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-gray-900">{club.club_name}</p>
                        <p className="truncate text-xs text-gray-500">
                          {club.flag_emoji && <span className="mr-1">{club.flag_emoji}</span>}
                          {club.country_name}
                          {club.province_name && ` · ${club.province_name}`}
                          {leagueName && ` · ${leagueName}`}
                        </p>
                      </div>

                      {/* Tier badge */}
                      {tier != null && (
                        <span className="flex-shrink-0 rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">
                          T{tier}
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          {results.length === 0 && !isSearching && value.trim().length >= 2 && (
            <div className="px-3 py-3 text-center text-sm text-gray-500">
              No clubs found matching &ldquo;{value.trim()}&rdquo;
            </div>
          )}

          {/* "Add to directory" button */}
          {value.trim().length >= 2 && !showAddForm && (
            <div className="border-t border-gray-100 px-3 py-2">
              <button
                type="button"
                onClick={openAddForm}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-indigo-600 transition-colors hover:bg-indigo-50"
              >
                <Plus className="h-4 w-4" />
                Add &ldquo;{value.trim()}&rdquo; to directory
              </button>
            </div>
          )}

          {/* "Add to directory" inline form */}
          {showAddForm && (
            <div className="border-t border-gray-100 px-3 py-3 space-y-3">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Add to World Directory
              </p>

              {/* Country select */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Country<span className="text-red-500">*</span>
                </label>
                <select
                  aria-label="Country"
                  value={addCountryId ?? ''}
                  onChange={e => {
                    const id = e.target.value ? Number(e.target.value) : null
                    if (id) handleAddCountryChange(id)
                  }}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">Select country...</option>
                  {addCountries.map(c => (
                    <option key={c.country_id} value={c.country_id ?? ''}>
                      {c.flag_emoji} {c.country_name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Region select (conditional) */}
              {addCountryHasRegions && addRegions.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Region (Optional)
                  </label>
                  <select
                    aria-label="Region"
                    value={addRegionId ?? ''}
                    onChange={e => setAddRegionId(e.target.value ? Number(e.target.value) : null)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">No specific region</option>
                    {addRegions.map(r => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCreateClub}
                  disabled={!addCountryId || isCreating}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isCreating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Globe2 className="h-3.5 w-3.5" />
                  )}
                  Add Club
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="rounded-lg px-3 py-1.5 text-sm text-gray-500 transition-colors hover:bg-gray-100"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
