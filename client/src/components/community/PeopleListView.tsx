/**
 * PeopleListView
 * 
 * The People mode view for the Community page.
 * Displays a searchable, filterable member directory.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Search, Filter, Loader2 } from 'lucide-react'
import { useNavigate, useNavigationType } from 'react-router-dom'
import { Avatar, RoleBadge, MemberCard } from '@/components'
import { logger } from '@/lib/logger'
import { ProfileCardSkeleton } from '@/components/Skeleton'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { requestCache } from '@/lib/requestCache'
import { monitor } from '@/lib/monitor'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { usePageState } from '@/hooks/usePageState'
import { useScrollRestore } from '@/hooks/useScrollRestore'

interface Profile {
  id: string
  avatar_url: string | null
  full_name: string
  role: 'player' | 'coach' | 'club' | 'brand'
  nationality: string | null
  nationality_country_id: number | null
  nationality2_country_id: number | null
  base_location: string | null
  position: string | null
  secondary_position: string | null
  current_club: string | null
  current_world_club_id: string | null
  gender: string | null
  created_at: string
  is_test_account?: boolean
  open_to_play?: boolean
  open_to_coach?: boolean
  brand_slug?: string | null
  brand_category?: string | null
}

interface CommunityFilters {
  role: 'all' | 'player' | 'coach' | 'club' | 'brand'
  position: string[]
  gender: 'all' | 'Men' | 'Women'
  location: string
  nationality: string
  availability: 'all' | 'open'
}

const PLAYER_POSITIONS = ['goalkeeper', 'defender', 'midfielder', 'forward']
const COACH_POSITIONS = ['head coach', 'assistant coach', 'youth coach']

interface PeopleListViewProps {
  roleFilter?: 'player' | 'coach' | 'club'
}

export function PeopleListView({ roleFilter }: PeopleListViewProps = {}) {
  const navigate = useNavigate()
  const navigationType = useNavigationType()
  const { profile: currentUserProfile } = useAuthStore()
  const isCurrentUserTestAccount = currentUserProfile?.is_test_account ?? false

  const [baseMembers, setBaseMembers] = useState<Profile[]>([])
  const [allMembers, setAllMembers] = useState<Profile[]>([])
  const [displayedMembers, setDisplayedMembers] = useState<Profile[]>([])
  const [searchQuery, setSearchQuery] = usePageState('community-search', '')
  const [filters, setFilters] = usePageState<CommunityFilters>('community-filters', {
    role: roleFilter || 'all',
    position: [],
    gender: 'all',
    location: '',
    nationality: '',
    availability: 'all',
  })
  const [showFilters, setShowFilters] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSearching, setIsSearching] = useState(false)
  const [page, setPage] = usePageState('community-page', 1)
  const [hasMore, setHasMore] = useState(true)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const searchContainerRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  // Track whether this is a restored (back/forward) navigation
  const isRestoredRef = useRef(navigationType === 'POP')

  // Scroll restoration — waits for data to load before restoring position
  useScrollRestore(!isLoading)

  // Responsive page size — reacts to viewport changes
  const isMobile = useMediaQuery('(max-width: 767px)')
  const pageSize = isMobile ? 12 : 24

  // Fetch members from Supabase
  const fetchMembers = useCallback(async () => {
    setIsLoading(true)
    
    await monitor.measure('fetch_community_members', async () => {
      try {
        // Cache key includes test account status to avoid mixing results
        const cacheKey = isCurrentUserTestAccount ? 'community-members-test' : 'community-members'
        
        const members = await requestCache.dedupe(
          cacheKey,
          async () => {
            let query = supabase
              .from('profiles')
              .select('id, avatar_url, full_name, role, nationality, nationality_country_id, nationality2_country_id, base_location, position, secondary_position, current_club, current_world_club_id, gender, created_at, is_test_account, open_to_play, open_to_coach, accepted_reference_count')
              .eq('onboarding_completed', true) // Only show fully onboarded users

            // If current user is NOT a test account, exclude test accounts from results
            if (!isCurrentUserTestAccount) {
              query = query.or('is_test_account.is.null,is_test_account.eq.false')
            }

            const { data, error } = await query
              .order('created_at', { ascending: false })
              .limit(200) // Load reasonable batch for client-side filtering

            if (error) throw error
            const members = (data || []) as Profile[]

            // Resolve brand slugs for navigation
            const brandIds = members.filter(m => m.role === 'brand').map(m => m.id)
            if (brandIds.length > 0) {
              const { data: brands } = await supabase
                .from('brands')
                .select('profile_id, slug, category')
                .in('profile_id', brandIds)
              if (brands) {
                const brandMap = new Map((brands as { profile_id: string; slug: string; category: string }[]).map((b) => [b.profile_id, b]))
                members.forEach(m => {
                  if (m.role === 'brand') {
                    const brand = brandMap.get(m.id)
                    m.brand_slug = brand?.slug || null
                    m.brand_category = brand?.category || null
                  }
                })
              }
            }

            return members
          },
          30000 // 30 second cache for community members
        )
        
        setBaseMembers(members)
        setAllMembers(members)
        setDisplayedMembers(members.slice(0, pageSize))
        setHasMore(members.length > pageSize)
      } catch (error) {
        logger.error('Error fetching members:', error)
      } finally {
        setIsLoading(false)
      }
    })
  }, [pageSize, isCurrentUserTestAccount])

  // Sync role filter when roleFilter prop changes
  useEffect(() => {
    setFilters(prev => ({ ...prev, role: roleFilter || 'all' }))
  }, [roleFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  // Initial load
  useEffect(() => {
    fetchMembers()
  }, [fetchMembers])

  // Perform server-side search
  const performServerSearch = useCallback(async (query: string) => {
    setIsSearching(true)
    
    await monitor.measure('search_community_members', async () => {
      // Cache key includes test account status
      const cacheKey = isCurrentUserTestAccount 
        ? `community-search-test-${query}` 
        : `community-search-${query}`
      
      try {
        const members = await requestCache.dedupe(
          cacheKey,
          async () => {
            const searchTerm = `%${query}%`
            let dbQuery = supabase
              .from('profiles')
              .select('id, avatar_url, full_name, role, nationality, nationality_country_id, nationality2_country_id, base_location, position, secondary_position, current_club, current_world_club_id, gender, created_at, is_test_account, open_to_play, open_to_coach, accepted_reference_count')
              .eq('onboarding_completed', true) // Only show fully onboarded users
              .or(
                `full_name.ilike.${searchTerm},nationality.ilike.${searchTerm},base_location.ilike.${searchTerm},position.ilike.${searchTerm},secondary_position.ilike.${searchTerm},current_club.ilike.${searchTerm}`
              )
            
            // If current user is NOT a test account, exclude test accounts from results
            if (!isCurrentUserTestAccount) {
              dbQuery = dbQuery.or('is_test_account.is.null,is_test_account.eq.false')
            }
            
            const { data, error } = await dbQuery
              .order('created_at', { ascending: false })
              .limit(200)

            if (error) throw error
            const members = (data || []) as Profile[]

            // Resolve brand slugs for navigation
            const brandIds = members.filter(m => m.role === 'brand').map(m => m.id)
            if (brandIds.length > 0) {
              const { data: brands } = await supabase
                .from('brands')
                .select('profile_id, slug, category')
                .in('profile_id', brandIds)
              if (brands) {
                const brandMap = new Map((brands as { profile_id: string; slug: string; category: string }[]).map((b) => [b.profile_id, b]))
                members.forEach(m => {
                  if (m.role === 'brand') {
                    const brand = brandMap.get(m.id)
                    m.brand_slug = brand?.slug || null
                    m.brand_category = brand?.category || null
                  }
                })
              }
            }

            return members
          },
          20000 // 20 second cache for searches
        )
        
        setAllMembers(members)
        setDisplayedMembers(members.slice(0, pageSize))
        setPage(1)
        setHasMore(members.length > pageSize)
      } catch (error) {
        logger.error('Error searching members:', error)
      } finally {
        setIsSearching(false)
      }
    }, { query })
  }, [pageSize, isCurrentUserTestAccount]) // eslint-disable-line react-hooks/exhaustive-deps

  // Client-side search filtering (instant, for both grid and suggestions)
  const clientFilteredMembers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return baseMembers
    return baseMembers.filter(m =>
      m.full_name?.toLowerCase().includes(q) ||
      m.base_location?.toLowerCase().includes(q) ||
      m.position?.toLowerCase().includes(q) ||
      m.secondary_position?.toLowerCase().includes(q) ||
      m.current_club?.toLowerCase().includes(q) ||
      m.nationality?.toLowerCase().includes(q)
    )
  }, [searchQuery, baseMembers])

  // Update grid with client-side results instantly; fall back to server when no matches
  useEffect(() => {
    setAllMembers(clientFilteredMembers)
    setIsSearching(false)

    // Only trigger server search if client-side found nothing
    // (the person might exist beyond the initial 200 loaded)
    if (searchQuery.trim() && clientFilteredMembers.length === 0) {
      const debounceTimer = setTimeout(() => {
        performServerSearch(searchQuery)
      }, 500)
      return () => clearTimeout(debounceTimer)
    }
  }, [searchQuery, clientFilteredMembers, performServerSearch])

  // Client-side filtering (all filters)
  const filteredMembers = useMemo(() => {
    let result = allMembers

    if (filters.role !== 'all') {
      result = result.filter(m => m.role === filters.role)
    }
    if (filters.position.length > 0) {
      result = result.filter(m =>
        (m.position && filters.position.includes(m.position.toLowerCase())) ||
        (m.secondary_position && filters.position.includes(m.secondary_position.toLowerCase()))
      )
    }
    if (filters.gender !== 'all') {
      result = result.filter(m => m.gender === filters.gender)
    }
    if (filters.location.trim()) {
      const loc = filters.location.toLowerCase()
      result = result.filter(m => m.base_location?.toLowerCase().includes(loc))
    }
    if (filters.nationality.trim()) {
      const nat = filters.nationality.toLowerCase()
      result = result.filter(m => m.nationality?.toLowerCase().includes(nat))
    }
    if (filters.availability === 'open') {
      result = result.filter(m =>
        (m.role === 'player' && m.open_to_play) ||
        (m.role === 'coach' && m.open_to_coach)
      )
    }

    return result
  }, [allMembers, filters])

  // Update displayed members when filter changes
  useEffect(() => {
    if (isRestoredRef.current) {
      // On back navigation, show items up to the restored page
      const endIndex = page * pageSize
      setDisplayedMembers(filteredMembers.slice(0, endIndex))
      setHasMore(filteredMembers.length > endIndex)
      isRestoredRef.current = false
    } else {
      setDisplayedMembers(filteredMembers.slice(0, pageSize))
      setPage(1)
      setHasMore(filteredMembers.length > pageSize)
    }
  }, [filteredMembers, pageSize]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load more handler
  const handleLoadMore = useCallback(() => {
    const nextPage = page + 1
    const startIndex = page * pageSize
    const endIndex = startIndex + pageSize
    const newMembers = filteredMembers.slice(0, endIndex)

    setDisplayedMembers(newMembers)
    setPage(nextPage)
    setHasMore(filteredMembers.length > endIndex)
  }, [page, pageSize, filteredMembers, setPage])

  // Infinite scroll via IntersectionObserver
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasMore) {
          handleLoadMore()
        }
      },
      { rootMargin: '200px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMore, handleLoadMore])

  // Inline suggestions derived from client-filtered results
  const suggestions = useMemo(() => {
    if (!searchQuery.trim()) return []
    return clientFilteredMembers.slice(0, 6)
  }, [searchQuery, clientFilteredMembers])

  // Show suggestions when input is focused and has content
  useEffect(() => {
    if (!showSuggestions) return
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showSuggestions])

  const handleSuggestionClick = (member: Profile) => {
    setShowSuggestions(false)
    if (member.role === 'brand') {
      navigate(member.brand_slug ? `/brands/${member.brand_slug}` : '/brands')
    } else if (member.role === 'club') {
      navigate(`/clubs/id/${member.id}`)
    } else {
      navigate(`/players/id/${member.id}`)
    }
  }

  // Filter helpers
  const updateFilter = <K extends keyof CommunityFilters>(key: K, value: CommunityFilters[K]) => {
    setFilters(prev => {
      const next = { ...prev, [key]: value }
      if (key === 'role') {
        next.position = []
        next.gender = 'all'
      }
      return next
    })
  }

  const togglePosition = (pos: string) => {
    setFilters(prev => ({
      ...prev,
      position: prev.position.includes(pos)
        ? prev.position.filter(p => p !== pos)
        : [...prev.position, pos]
    }))
  }

  const clearFilters = () => {
    setFilters({ role: roleFilter || 'all', position: [], gender: 'all', location: '', nationality: '', availability: 'all' })
  }

  const hasActiveFilters = () => {
    // When role is driven by the tab switcher (roleFilter prop), don't count it
    const expectedRole = roleFilter || 'all'
    return (
      filters.role !== expectedRole ||
      filters.position.length > 0 ||
      filters.gender !== 'all' ||
      filters.location.trim() !== '' ||
      filters.nationality.trim() !== '' ||
      filters.availability !== 'all'
    )
  }

  return (
    <div>
      {/* Search Bar with Inline Suggestions */}
      <div ref={searchContainerRef} className="max-w-2xl mx-auto relative mb-4">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 z-10" />
        <input
          type="search"
          data-keyboard-shortcut="search"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value)
            setShowSuggestions(true)
          }}
          onFocus={() => { if (searchQuery.trim()) setShowSuggestions(true) }}
          onKeyDown={(e) => { if (e.key === 'Enter') setShowSuggestions(false) }}
          placeholder="Search by name, location, position, or club..."
          className="w-full pl-12 pr-4 py-2.5 sm:py-3 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm sm:text-base"
          autoComplete="off"
          enterKeyHint="search"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        {isSearching && (
          <div className="absolute right-4 top-1/2 -translate-y-1/2">
            <div className="w-5 h-5 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* Inline suggestion dropdown */}
        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute left-0 right-0 top-full mt-1 bg-white rounded-xl border border-gray-200 shadow-lg z-50 overflow-hidden">
            {suggestions.map((member) => (
              <button
                key={member.id}
                type="button"
                onClick={() => handleSuggestionClick(member)}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 active:bg-gray-100 transition-colors text-left"
              >
                <Avatar
                  src={member.avatar_url}
                  alt={member.full_name}
                  initials={member.full_name ? member.full_name.split(' ').map(n => n[0]).join('') : '?'}
                  size="sm"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900 truncate text-sm">
                      {member.full_name}
                    </span>
                    <RoleBadge role={member.role} />
                  </div>
                  {(member.position || member.base_location) && (
                    <p className="text-xs text-gray-500 truncate">
                      {[member.position, member.base_location].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Action Row: Availability toggle + Filters button */}
      <div className="flex items-center justify-center gap-2 mb-4">
        <button
          type="button"
          onClick={() => updateFilter('availability', filters.availability === 'open' ? 'all' : 'open')}
          className={`whitespace-nowrap px-3.5 sm:px-4 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-1.5 flex-shrink-0 ${
            filters.availability === 'open'
              ? 'bg-emerald-500 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-current flex-shrink-0" />
          Open to Opportunities
        </button>
        <button
          type="button"
          onClick={() => setShowFilters(!showFilters)}
          className="md:hidden flex items-center gap-1.5 whitespace-nowrap px-3.5 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 rounded-full hover:bg-gray-200 active:bg-gray-300 transition-colors flex-shrink-0"
        >
          <Filter className="w-3.5 h-3.5" />
          Filters
          {hasActiveFilters() && (
            <span className="w-2 h-2 bg-purple-600 rounded-full" />
          )}
        </button>
      </div>

      {/* Filtered results count — only when narrowing */}
      {(searchQuery.trim() || hasActiveFilters()) && (
        <p className="text-sm text-gray-500 mb-4">
          Showing <span className="font-semibold text-gray-900">{filteredMembers.length}</span> members
        </p>
      )}

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Filters Panel */}
        <aside className={`${showFilters ? 'block' : 'hidden'} md:block w-full lg:w-72 flex-shrink-0`}>
          <div className="bg-white rounded-xl p-6 shadow-sm sticky top-24 space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">Filters</h2>
              {hasActiveFilters() && (
                <button
                  onClick={clearFilters}
                  className="text-sm text-purple-600 hover:text-purple-700 font-medium"
                >
                  Clear all
                </button>
              )}
            </div>

            {/* Role — hidden when pre-filtered by tab */}
            {!roleFilter && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Role</label>
                <div className="space-y-2">
                  {(['all', 'player', 'coach', 'club', 'brand'] as const).map((role) => (
                    <label key={role} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        checked={filters.role === role}
                        onChange={() => updateFilter('role', role)}
                        className="w-4 h-4 text-purple-600"
                      />
                      <span className="text-sm text-gray-700 capitalize">{role === 'all' ? 'All' : role}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Position — hidden when role is club or brand */}
            {filters.role !== 'club' && filters.role !== 'brand' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {filters.role === 'coach' ? 'Coaching Role' : 'Position'}
                </label>
                <div className="space-y-2">
                  {(filters.role === 'coach' ? COACH_POSITIONS : PLAYER_POSITIONS).map((position) => (
                    <label key={position} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={filters.position.includes(position)}
                        onChange={() => togglePosition(position)}
                        className="w-4 h-4 text-purple-600 rounded"
                      />
                      <span className="text-sm text-gray-700 capitalize">{position}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Gender — hidden when role is club or brand */}
            {filters.role !== 'club' && filters.role !== 'brand' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Gender</label>
                <div className="space-y-2">
                  {(['all', 'Men', 'Women'] as const).map((gender) => (
                    <label key={gender} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        checked={filters.gender === gender}
                        onChange={() => updateFilter('gender', gender)}
                        className="w-4 h-4 text-purple-600"
                      />
                      <span className="text-sm text-gray-700">{gender === 'all' ? 'All' : gender}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Location */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Location</label>
              <input
                type="text"
                value={filters.location}
                onChange={(e) => updateFilter('location', e.target.value)}
                placeholder="City or Country"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
            </div>

            {/* Nationality */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Nationality</label>
              <input
                type="text"
                value={filters.nationality}
                onChange={(e) => updateFilter('nationality', e.target.value)}
                placeholder="e.g. Dutch, Australian"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              />
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <div className="flex-1">
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
              {[...Array(12)].map((_, i) => (
                <ProfileCardSkeleton key={i} />
              ))}
            </div>
          ) : displayedMembers.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-3xl">🔍</span>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">No members found</h3>
              <p className="text-gray-500 mb-4">
                {searchQuery.trim() || hasActiveFilters()
                  ? 'Try adjusting your search or filters to see more results.'
                  : 'No members yet.'}
              </p>
              {hasActiveFilters() && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="px-6 py-2 rounded-lg bg-gradient-to-r from-[#8026FA] to-[#924CEC] text-white font-medium hover:opacity-90 transition-opacity"
                >
                  Clear Filters
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 mb-6 sm:mb-8">
                {displayedMembers.map((member) => (
                  <MemberCard
                    key={member.id}
                    id={member.id}
                    avatar_url={member.avatar_url}
                    full_name={member.full_name}
                    role={member.role}
                    brandSlug={member.brand_slug ?? undefined}
                    brandCategory={member.brand_category ?? undefined}
                    nationality={member.nationality}
                    nationality_country_id={member.nationality_country_id}
                    nationality2_country_id={member.role === 'club' ? null : member.nationality2_country_id}
                    base_location={member.base_location}
                    position={member.position}
                    secondary_position={member.secondary_position}
                    current_team={member.current_club}
                    current_world_club_id={member.current_world_club_id}
                    created_at={member.created_at}
                    open_to_play={member.open_to_play}
                    open_to_coach={member.open_to_coach}
                    accepted_reference_count={member.accepted_reference_count ?? 0}
                  />
                ))}
              </div>

              {/* Infinite scroll sentinel */}
              {hasMore && <div ref={sentinelRef} className="h-1" />}
              {hasMore && (
                <div className="flex justify-center py-6">
                  <Loader2 className="w-6 h-6 text-[#8026FA] animate-spin" />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
