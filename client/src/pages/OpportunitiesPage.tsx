import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Grid, List, ChevronDown, Search } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../lib/auth'
// Vacancy is a legacy alias for Opportunity - keeping for compatibility during migration
import type { Vacancy } from '../lib/supabase'
import Header from '../components/Header'
import OpportunityCard from '../components/OpportunityCard'
import OpportunityDetailView from '../components/OpportunityDetailView'
import ApplyToOpportunityModal from '../components/ApplyToOpportunityModal'
import SignInPromptModal from '../components/SignInPromptModal'
import Button from '../components/Button'
import { OpportunityCardSkeleton } from '../components/Skeleton'
import OpportunityQuickFilters from '../components/OpportunityQuickFilters'
import OpportunityFilterSheet from '../components/OpportunityFilterSheet'
import { OpportunitiesListJsonLd } from '../components/OpportunityJsonLd'
import { requestCache } from '@/lib/requestCache'
import { monitor } from '@/lib/monitor'
import { logger } from '@/lib/logger'
import { useOpportunityNotifications } from '@/hooks/useOpportunityNotifications'

interface FiltersState {
  opportunityType: 'all' | 'player' | 'coach'
  position: string[]
  gender: 'all' | 'Men' | 'Women'
  location: string
  startDate: 'all' | 'immediate' | 'specific'
  benefits: string[]
  priority: 'all' | 'high' | 'medium' | 'low'
}

const POSITIONS = ['goalkeeper', 'defender', 'midfielder', 'forward']
const BENEFITS = ['housing', 'car', 'visa', 'flights', 'meals', 'job', 'insurance', 'education', 'bonuses', 'equipment']

// Valid sort values for type checking URL params
const VALID_SORTS = ['newest', 'deadline', 'priority', 'location'] as const
type SortBy = (typeof VALID_SORTS)[number]

export default function OpportunitiesPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { user, profile } = useAuthStore()
  const isCurrentUserTestAccount = profile?.is_test_account ?? false

  const [vacancies, setVacancies] = useState<Vacancy[]>([])
  const [filteredVacancies, setFilteredVacancies] = useState<Vacancy[]>([])
  const [clubs, setClubs] = useState<Record<string, { id: string; full_name: string; avatar_url: string | null; role: string | null; current_club: string | null; womens_league_division: string | null; mens_league_division: string | null }>>({})
  const [worldClubsMap, setWorldClubsMap] = useState<Record<string, { id: string; clubName: string; avatarUrl: string | null; countryName: string | null; flagEmoji: string | null; leagueName: string | null }>>({})
  const [userApplications, setUserApplications] = useState<string[]>([])
  const [selectedVacancy, setSelectedVacancy] = useState<Vacancy | null>(null)
  const [showApplyModal, setShowApplyModal] = useState(false)
  const [showSignInPrompt, setShowSignInPrompt] = useState(false)
  const [showDetailView, setShowDetailView] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => {
    const saved = localStorage.getItem('opp-view-mode')
    return saved === 'list' ? 'list' : 'grid'
  })
  const [sortBy, setSortBy] = useState<SortBy>(() => {
    const param = searchParams.get('sort')
    return param && VALID_SORTS.includes(param as SortBy) ? (param as SortBy) : 'newest'
  })
  const [showFilterSheet, setShowFilterSheet] = useState(false)
  const [isSyncingNewVacancies, setIsSyncingNewVacancies] = useState(false)
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('q') || '')

  const [filters, setFilters] = useState<FiltersState>(() => {
    const hasAnyParam = [...searchParams.keys()].length > 0

    const typeParam = searchParams.get('type')
    const genderParam = searchParams.get('gender')
    const startParam = searchParams.get('start')
    const priorityParam = searchParams.get('priority')

    // Smart defaults: if NO URL params and user has a profile, pre-populate opportunity type
    // Only type is safe to default — gender/position are too narrow and hide relevant opportunities
    if (!hasAnyParam && profile) {
      return {
        opportunityType: 'all' as const,
        position: [],
        gender: 'all',
        location: '',
        startDate: 'all',
        benefits: [],
        priority: 'all',
      }
    }

    // Otherwise initialize from URL params
    const defaultType: FiltersState['opportunityType'] =
      (typeParam === 'player' || typeParam === 'coach') ? typeParam : 'all'

    return {
      opportunityType: defaultType,
      position: searchParams.get('position')?.split(',').filter(Boolean) || [],
      gender: (genderParam === 'Men' || genderParam === 'Women') ? genderParam : 'all',
      location: searchParams.get('location') || '',
      startDate: (startParam === 'immediate' || startParam === 'specific') ? startParam : 'all',
      benefits: searchParams.get('benefits')?.split(',').filter(Boolean) || [],
      priority: (priorityParam === 'high' || priorityParam === 'medium' || priorityParam === 'low') ? priorityParam : 'all',
    }
  })

  // Sync filter/search/sort state to URL (replaceState, no history entries)
  useEffect(() => {
    const params = new URLSearchParams()
    if (searchQuery) params.set('q', searchQuery)
    if (sortBy !== 'newest') params.set('sort', sortBy)
    if (filters.opportunityType !== 'all') params.set('type', filters.opportunityType)
    if (filters.position.length > 0) params.set('position', filters.position.join(','))
    if (filters.gender !== 'all') params.set('gender', filters.gender)
    if (filters.location) params.set('location', filters.location)
    if (filters.startDate !== 'all') params.set('start', filters.startDate)
    if (filters.benefits.length > 0) params.set('benefits', filters.benefits.join(','))
    if (filters.priority !== 'all') params.set('priority', filters.priority)

    setSearchParams(params, { replace: true })
  }, [filters, searchQuery, sortBy, setSearchParams])
  const { count: opportunityCount, markSeen, refresh: refreshOpportunityNotifications, lastSeenAt } = useOpportunityNotifications()

  const fetchVacancies = useCallback(async (options?: { skipCache?: boolean; silent?: boolean }) => {
    if (!options?.silent) {
      setIsLoading(true)
    }
    setFetchError(null)

    // Cache key includes test account status and active filters to separate results
    const filterKey = `${filters.opportunityType}-${filters.gender}-${filters.position.join(',')}-${filters.priority}`
    const cacheKey = isCurrentUserTestAccount ? `open-vacancies-test-${filterKey}` : `open-vacancies-${filterKey}`

    if (options?.skipCache) {
      requestCache.invalidate(cacheKey)
    }

    await monitor.measure('fetch_vacancies', async () => {
      try {
        const { vacanciesData, clubsMap, wcMap } = await requestCache.dedupe(
          cacheKey,
          async () => {
            // Build query with server-side filters
            let query = supabase
              .from('opportunities')
              .select(`
                *,
                club:profiles!opportunities_club_id_fkey(
                  id,
                  full_name,
                  avatar_url,
                  is_test_account,
                  role,
                  current_club,
                  womens_league_division,
                  mens_league_division
                ),
                world_club:world_clubs!opportunities_world_club_id_fkey(
                  id,
                  club_name,
                  avatar_url,
                  claimed_profile:profiles!world_clubs_claimed_profile_id_fkey(avatar_url),
                  country:countries(name, flag_emoji),
                  men_league:world_leagues!world_clubs_men_league_id_fkey(name, tier),
                  women_league:world_leagues!world_clubs_women_league_id_fkey(name, tier)
                )
              `)
              .eq('status', 'open')

            // Server-side filters: push filtering to the DB instead of fetching all
            if (filters.opportunityType !== 'all') {
              query = query.eq('opportunity_type', filters.opportunityType)
            }
            if (filters.gender !== 'all') {
              query = query.eq('gender', filters.gender)
            }
            if (filters.position.length > 0) {
              query = query.in('position', filters.position)
            }
            if (filters.priority !== 'all') {
              query = query.eq('priority', filters.priority)
            }
            if (filters.startDate === 'immediate') {
              query = query.is('start_date', null)
            } else if (filters.startDate === 'specific') {
              query = query.not('start_date', 'is', null)
            }

            const { data: vacanciesData, error: vacanciesError } = await query
              .order('created_at', { ascending: false })

            if (vacanciesError) throw vacanciesError

            logger.debug('Fetched vacancies with clubs:', vacanciesData)

            // Filter out test vacancies for non-test users
            type WorldClubJoin = {
              id: string
              club_name: string
              avatar_url: string | null
              claimed_profile: { avatar_url: string | null } | null
              country: { name: string; flag_emoji: string | null } | null
              men_league: { name: string; tier: number | null } | null
              women_league: { name: string; tier: number | null } | null
            } | null
            type VacancyWithClub = Vacancy & {
              club?: { id: string; full_name: string | null; avatar_url: string | null; is_test_account?: boolean; role?: string | null; current_club?: string | null; womens_league_division?: string | null; mens_league_division?: string | null }
              world_club?: WorldClubJoin
            }
            let filteredVacancies = vacanciesData as VacancyWithClub[]

            if (!isCurrentUserTestAccount) {
              filteredVacancies = filteredVacancies.filter((vacancy) => {
                // Exclude vacancies where the club is a test account
                return !vacancy.club?.is_test_account
              })
            }

            // Build clubs map from embedded data
            const clubsMap: Record<string, { id: string; full_name: string; avatar_url: string | null; role: string | null; current_club: string | null; womens_league_division: string | null; mens_league_division: string | null }> = {}
            const wcMap: Record<string, { id: string; clubName: string; avatarUrl: string | null; countryName: string | null; flagEmoji: string | null; leagueName: string | null }> = {}

            filteredVacancies.forEach((vacancy) => {
              if (vacancy.club && vacancy.club.id) {
                clubsMap[vacancy.club.id] = {
                  id: vacancy.club.id,
                  full_name: vacancy.club.full_name || 'Unknown Club',
                  avatar_url: vacancy.club.avatar_url,
                  role: vacancy.club.role ?? null,
                  current_club: vacancy.club.current_club ?? null,
                  womens_league_division: vacancy.club.womens_league_division ?? null,
                  mens_league_division: vacancy.club.mens_league_division ?? null,
                }
              }
              if (vacancy.world_club && vacancy.world_club_id) {
                wcMap[vacancy.world_club_id] = {
                  id: vacancy.world_club.id,
                  clubName: vacancy.world_club.club_name,
                  avatarUrl: vacancy.world_club.avatar_url || vacancy.world_club.claimed_profile?.avatar_url || null,
                  countryName: vacancy.world_club.country?.name ?? null,
                  flagEmoji: vacancy.world_club.country?.flag_emoji ?? null,
                  leagueName: vacancy.world_club.men_league?.name ?? vacancy.world_club.women_league?.name ?? null,
                }
              }
            })

            logger.debug('Clubs map:', clubsMap)

            return { vacanciesData: filteredVacancies, clubsMap, wcMap }
          },
          options?.skipCache ? 0 : 5000 // disable cache when explicitly requesting fresh data
        )

        setVacancies((vacanciesData as Vacancy[]) || [])
        setClubs(clubsMap)
        setWorldClubsMap(wcMap)
      } catch (error) {
        logger.error('Error fetching vacancies:', error)
        setFetchError('Could not load opportunities. Please check your connection and try again.')
      } finally {
        if (!options?.silent) {
          setIsLoading(false)
        }
      }
    })
  }, [isCurrentUserTestAccount, filters])

  const fetchUserApplications = useCallback(async (options?: { skipCache?: boolean }) => {
    if (!user || (profile?.role !== 'player' && profile?.role !== 'coach')) return

    await monitor.measure('fetch_user_applications', async () => {
      const cacheKey = `user-applications-${user.id}`
      const shouldSkipCache = options?.skipCache === true
      
      try {
        if (shouldSkipCache) {
          requestCache.invalidate(cacheKey)
        }

        const appliedVacancyIds = await requestCache.dedupe(
          cacheKey,
          async () => {
            const { data, error } = await supabase
              .from('opportunity_applications')
              .select('opportunity_id')
              .eq('applicant_id', user.id)

            if (error) throw error

            return (data as { opportunity_id: string }[])?.map(app => app.opportunity_id) || []
          },
          shouldSkipCache ? 0 : 30000 // disable cache when explicitly requested
        )

        setUserApplications(appliedVacancyIds)
      } catch (error) {
        logger.error('Error fetching user applications:', error)
      }
    }, { userId: user.id })
  }, [user, profile])

  useEffect(() => {
    fetchVacancies()
    fetchUserApplications()
    void markSeen()
  }, [fetchVacancies, fetchUserApplications, markSeen])

  // SEO: Set page title and meta tags for opportunities listing
  useEffect(() => {
    document.title = 'Field Hockey Opportunities | PLAYR'
    
    const metaDescription = 'Browse field hockey opportunities for players and coaches. Find your next team, coaching position, or club role on PLAYR.'
    
    const metaDescTag = document.querySelector('meta[name="description"]')
    if (metaDescTag) metaDescTag.setAttribute('content', metaDescription)
    
    const ogTitle = document.querySelector('meta[property="og:title"]')
    if (ogTitle) ogTitle.setAttribute('content', 'Field Hockey Opportunities | PLAYR')
    
    const ogDesc = document.querySelector('meta[property="og:description"]')
    if (ogDesc) ogDesc.setAttribute('content', metaDescription)
    
    const ogUrl = document.querySelector('meta[property="og:url"]')
    if (ogUrl) ogUrl.setAttribute('content', 'https://www.oplayr.com/opportunities')
    
    return () => {
      document.title = 'PLAYR | Field Hockey Community'
      const defaultDesc = 'Connect players, coaches, and clubs. Raise the sport together. Join PLAYR.'
      
      if (metaDescTag) metaDescTag.setAttribute('content', defaultDesc)
      if (ogTitle) ogTitle.setAttribute('content', 'PLAYR | Field Hockey Community')
      if (ogDesc) ogDesc.setAttribute('content', defaultDesc)
      if (ogUrl) ogUrl.setAttribute('content', 'https://www.oplayr.com')
    }
  }, [])

  const handleSyncNewVacancies = useCallback(async () => {
    if (isSyncingNewVacancies) {
      return
    }

    setIsSyncingNewVacancies(true)
    try {
      await fetchVacancies({ skipCache: true, silent: true })
      await fetchUserApplications({ skipCache: true })
      await refreshOpportunityNotifications({ bypassCache: true })
      await markSeen()
    } catch (error) {
      logger.error('Failed to sync new vacancies:', error)
    } finally {
      setIsSyncingNewVacancies(false)
    }
  }, [fetchVacancies, fetchUserApplications, isSyncingNewVacancies, markSeen, refreshOpportunityNotifications])

  // Handle apply button click - shows sign-in prompt for unauthenticated users
  const handleApplyClick = (vacancy: Vacancy) => {
    setSelectedVacancy(vacancy)
    if (!user) {
      // Not authenticated - show sign-in prompt
      setShowSignInPrompt(true)
    } else if ((profile?.role === 'player' || profile?.role === 'coach') && !userApplications.includes(vacancy.id)) {
      // Authenticated player/coach who hasn't applied - show apply modal
      setShowApplyModal(true)
    }
  }

  // Check if user can see apply button for a vacancy
  const canShowApplyButton = (vacancy: Vacancy) => {
    const isApplied = userApplications.includes(vacancy.id)
    if (isApplied) return false

    // For unauthenticated users, show button (triggers sign-in prompt)
    if (!user) return true

    // For authenticated users, only show if their role matches the opportunity type
    // Players can only apply to player opportunities, coaches to coach opportunities
    if (profile?.role === 'player' && vacancy.opportunity_type === 'player') return true
    if (profile?.role === 'coach' && vacancy.opportunity_type === 'coach') return true

    return false
  }

  // Apply client-side search, remaining filters, and sort
  // Note: opportunityType, gender, position, priority, and startDate are now
  // applied server-side in fetchVacancies. Only text search, location, and
  // benefits still need client-side filtering.
  useEffect(() => {
    let filtered = [...vacancies]

    // Search query filter (title, description, club name, location)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      filtered = filtered.filter(v => {
        const title = v.title?.toLowerCase() ?? ''
        const description = v.description?.toLowerCase() ?? ''
        const city = v.location_city?.toLowerCase() ?? ''
        const country = v.location_country?.toLowerCase() ?? ''
        const club = clubs[v.club_id]?.full_name?.toLowerCase() ?? ''
        const position = v.position?.toLowerCase() ?? ''
        return title.includes(q) || description.includes(q) || city.includes(q) || country.includes(q) || club.includes(q) || position.includes(q)
      })
    }

    // Location filter (client-side — needs club join data)
    if (filters.location.trim()) {
      const locationLower = filters.location.toLowerCase()
      filtered = filtered.filter(v => {
        const city = v.location_city?.toLowerCase() ?? ''
        const country = v.location_country?.toLowerCase() ?? ''
        return city.includes(locationLower) || country.includes(locationLower)
      })
    }

    // Benefits filter (client-side — array contains check)
    if (filters.benefits.length > 0) {
      filtered = filtered.filter(v =>
        v.benefits && filters.benefits.some(benefit => v.benefits?.includes(benefit))
      )
    }

    // Sort
    const PRIORITY_WEIGHT: Record<string, number> = { high: 3, medium: 2, low: 1 }
    switch (sortBy) {
      case 'newest':
        filtered.sort((a, b) => {
          const dateA = a.created_at ? new Date(a.created_at).getTime() : 0
          const dateB = b.created_at ? new Date(b.created_at).getTime() : 0
          return dateB - dateA
        })
        break
      case 'deadline':
        filtered.sort((a, b) => {
          // Opportunities with deadlines first, sorted soonest-first
          if (!a.application_deadline && !b.application_deadline) return 0
          if (!a.application_deadline) return 1
          if (!b.application_deadline) return -1
          return new Date(a.application_deadline).getTime() - new Date(b.application_deadline).getTime()
        })
        break
      case 'priority':
        filtered.sort((a, b) => {
          return (PRIORITY_WEIGHT[b.priority || 'low'] || 0) - (PRIORITY_WEIGHT[a.priority || 'low'] || 0)
        })
        break
      case 'location':
        filtered.sort((a, b) => {
          const cityA = a.location_city?.toLowerCase() ?? ''
          const cityB = b.location_city?.toLowerCase() ?? ''
          return cityA.localeCompare(cityB)
        })
        break
    }

    setFilteredVacancies(filtered)
  }, [vacancies, clubs, filters, searchQuery, sortBy])

  const updateFilter = <K extends keyof FiltersState>(key: K, value: FiltersState[K]) => {
    setFilters(prev => {
      const next = { ...prev, [key]: value } as FiltersState
      if (key === 'opportunityType') {
        next.position = []
        next.gender = 'all'
      }
      return next
    })
  }

  const togglePosition = (position: string) => {
    setFilters(prev => ({
      ...prev,
      position: prev.position.includes(position)
        ? prev.position.filter(p => p !== position)
        : [...prev.position, position]
    }))
  }

  const toggleBenefit = (benefit: string) => {
    setFilters(prev => ({
      ...prev,
      benefits: prev.benefits.includes(benefit)
        ? prev.benefits.filter(b => b !== benefit)
        : [...prev.benefits, benefit]
    }))
  }

  const clearFilters = () => {
    setFilters({
      opportunityType: 'all',
      position: [],
      gender: 'all',
      location: '',
      startDate: 'all',
      benefits: [],
      priority: 'all',
    })
  }

  const hasActiveFilters = () => {
    return (
      filters.opportunityType !== 'all' ||
      filters.position.length > 0 ||
      filters.gender !== 'all' ||
      filters.location.trim() !== '' ||
      filters.startDate !== 'all' ||
      filters.benefits.length > 0 ||
      filters.priority !== 'all'
    )
  }

  // Count secondary filters (location, startDate, benefits, priority) for "More" badge
  const secondaryFilterCount =
    (filters.location.trim() !== '' ? 1 : 0) +
    (filters.startDate !== 'all' ? 1 : 0) +
    filters.benefits.length +
    (filters.priority !== 'all' ? 1 : 0)

  const clearSecondaryFilters = () => {
    setFilters(prev => ({
      ...prev,
      location: '',
      startDate: 'all',
      benefits: [],
      priority: 'all',
    }))
  }

  return (
    <>
      {/* Structured data for AI discoverability */}
      {!isLoading && filteredVacancies.length > 0 && (
        <OpportunitiesListJsonLd 
          opportunities={filteredVacancies} 
          totalCount={filteredVacancies.length} 
        />
      )}
      
      <div className="min-h-screen bg-gray-50">
        <Header />

        <main className="max-w-7xl mx-auto px-4 md:px-6 pt-24 pb-12">
          {/* Page Header */}
          <div className="mb-6">
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900 mb-1">
              Opportunities
            </h1>
            <p className="text-sm text-gray-500">
              Discover field hockey opportunities from clubs around the world
            </p>
          </div>

          {/* Search Bar */}
          <div className="relative mb-6">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by title, club, position, or location..."
              className="w-full h-12 pl-12 pr-4 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#8026FA]/30 focus:border-[#8026FA] transition-colors"
              autoComplete="off"
              enterKeyHint="search"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>

          {/* Mobile Quick-Filter Chips */}
          <div className="mb-4">
            <OpportunityQuickFilters
              opportunityType={filters.opportunityType}
              gender={filters.gender}
              position={filters.position}
              onSetType={(type) => updateFilter('opportunityType', type)}
              onSetGender={(gender) => updateFilter('gender', gender)}
              onTogglePosition={togglePosition}
              onClearAll={clearFilters}
              hasActiveFilters={hasActiveFilters()}
              secondaryFilterCount={secondaryFilterCount}
              onOpenMoreFilters={() => setShowFilterSheet(true)}
            />
          </div>

          {opportunityCount > 0 && (
            <div className="bg-[#8026FA]/5 border border-[#8026FA]/10 text-gray-900 rounded-xl p-4 mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <p className="font-semibold text-sm">{opportunityCount === 1 ? 'New opportunity available' : `${opportunityCount} new opportunities available`}</p>
                <p className="text-sm text-gray-600">
                  {opportunityCount === 1 ? 'A new opportunity was just published.' : 'Fresh opportunities were published since you opened this page.'}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  className="border-[#8026FA]/20 text-[#8026FA] bg-white hover:bg-[#8026FA]/5 disabled:opacity-60"
                  disabled={isSyncingNewVacancies}
                  onClick={handleSyncNewVacancies}
                >
                  {isSyncingNewVacancies ? 'Updating…' : 'View latest'}
                </Button>
              </div>
            </div>
          )}

          {/* Controls Bar */}
          <div className="bg-white rounded-xl p-4 mb-6 shadow-sm">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              {/* Results & Filters Toggle */}
              <div className="flex items-center gap-4">
                <p className="text-sm text-gray-600">
                  Showing <span className="font-semibold text-gray-900">{filteredVacancies.length}</span> opportunities
                </p>
              </div>

              {/* Sort & View Toggle */}
              <div className="flex items-center gap-3">
                {/* Sort */}
                <div className="relative">
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                    className="appearance-none pl-4 pr-10 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#8026FA]/30"
                    title="Sort by"
                  >
                    <option value="newest">Newest</option>
                    <option value="deadline">Ending Soon</option>
                    <option value="priority">Priority</option>
                    <option value="location">Location A-Z</option>
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
                </div>

                {/* View Toggle */}
                <div className="hidden md:flex items-center border border-gray-300 rounded-lg overflow-hidden">
                  <button
                    onClick={() => { setViewMode('grid'); localStorage.setItem('opp-view-mode', 'grid') }}
                    className={`p-2 ${viewMode === 'grid' ? 'bg-[#8026FA]/10 text-[#8026FA]' : 'text-gray-600 hover:bg-gray-50'}`}
                    title="Grid view"
                  >
                    <Grid className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => { setViewMode('list'); localStorage.setItem('opp-view-mode', 'list') }}
                    className={`p-2 ${viewMode === 'list' ? 'bg-[#8026FA]/10 text-[#8026FA]' : 'text-gray-600 hover:bg-gray-50'}`}
                    title="List view"
                  >
                    <List className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-6 lg:flex-row">
          {/* Filters Panel - Desktop */}
          <aside className={"hidden lg:block w-full lg:w-72 flex-shrink-0"}>
            <div className="bg-white rounded-xl p-6 shadow-sm sticky top-24 space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-gray-900">Filters</h2>
                {hasActiveFilters() && (
                  <button
                    onClick={clearFilters}
                    className="text-sm text-[#8026FA] hover:text-[#6b1de0] font-medium"
                  >
                    Clear all
                  </button>
                )}
              </div>

              {/* Opportunity Type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Role Type
                </label>
                <div className="space-y-2">
                  {(['all', 'player', 'coach'] as const).map((type) => (
                    <label key={type} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        checked={filters.opportunityType === type}
                        onChange={() => updateFilter('opportunityType', type)}
                        className="w-4 h-4 accent-[#8026FA]"
                      />
                      <span className="text-sm text-gray-700 capitalize">{type === 'all' ? 'All' : type}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Position */}
              {filters.opportunityType !== 'coach' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Position
                  </label>
                  <div className="space-y-2">
                    {POSITIONS.map((position) => (
                      <label key={position} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={filters.position.includes(position)}
                          onChange={() => togglePosition(position)}
                          className="w-4 h-4 accent-[#8026FA] rounded"
                        />
                        <span className="text-sm text-gray-700 capitalize">{position}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Gender */}
              {filters.opportunityType !== 'coach' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Gender
                  </label>
                  <div className="space-y-2">
                    {(['all', 'Men', 'Women'] as const).map((gender) => (
                      <label key={gender} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          checked={filters.gender === gender}
                          onChange={() => updateFilter('gender', gender)}
                          className="w-4 h-4 accent-[#8026FA]"
                        />
                        <span className="text-sm text-gray-700">{gender === 'all' ? 'All' : gender}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Location */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Location
                </label>
                <input
                  type="text"
                  value={filters.location}
                  onChange={(e) => updateFilter('location', e.target.value)}
                  placeholder="City or Country"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#8026FA]/30 focus:border-[#8026FA] focus:outline-none transition-colors"
                />
              </div>

              {/* Start Date */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Start Date
                </label>
                <div className="space-y-2">
                  {(['all', 'immediate', 'specific'] as const).map((start) => (
                    <label key={start} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        checked={filters.startDate === start}
                        onChange={() => updateFilter('startDate', start)}
                        className="w-4 h-4 accent-[#8026FA]"
                      />
                      <span className="text-sm text-gray-700 capitalize">
                        {start === 'all' ? 'All' : start === 'immediate' ? 'Immediate' : 'Scheduled'}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Benefits */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Benefits
                </label>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {BENEFITS.map((benefit) => (
                    <label key={benefit} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={filters.benefits.includes(benefit)}
                        onChange={() => toggleBenefit(benefit)}
                        className="w-4 h-4 accent-[#8026FA] rounded"
                      />
                      <span className="text-sm text-gray-700 capitalize">{benefit}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Priority */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Priority
                </label>
                <div className="space-y-2">
                  {(['all', 'high', 'medium', 'low'] as const).map((priority) => (
                    <label key={priority} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        checked={filters.priority === priority}
                        onChange={() => updateFilter('priority', priority)}
                        className="w-4 h-4 accent-[#8026FA]"
                      />
                      <span className="text-sm text-gray-700 capitalize">{priority === 'all' ? 'All' : priority}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </aside>

          {/* Main Content */}
          <div className="flex-1">
            {isLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {[1, 2, 3, 4, 5, 6].map(i => (
                  <OpportunityCardSkeleton key={i} />
                ))}
              </div>
            ) : fetchError ? (
              <div className="bg-white rounded-xl p-12 text-center border border-red-100">
                <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  Something went wrong
                </h3>
                <p className="text-gray-600 mb-6">
                  {fetchError}
                </p>
                <Button
                  onClick={() => { fetchVacancies({ skipCache: true }) }}
                  className="mx-auto bg-gradient-to-r from-[#8026FA] to-[#924CEC]"
                >
                  Try Again
                </Button>
              </div>
            ) : filteredVacancies.length === 0 ? (
              <div className="bg-white rounded-xl p-12 text-center">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-3xl">🔍</span>
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  No opportunities found
                </h3>
                <p className="text-gray-600 mb-6">
                  {hasActiveFilters()
                    ? 'Try adjusting your filters to see more results'
                    : 'No opportunities are currently available'}
                </p>
                {hasActiveFilters() && (
                  <Button onClick={clearFilters} className="mx-auto">
                    Clear Filters
                  </Button>
                )}
                {(profile?.role === 'club' || profile?.role === 'coach') && (
                  <div className="mt-4 pt-4 border-t border-gray-100">
                    <p className="text-sm text-gray-500 mb-3">
                      {profile.role === 'coach'
                        ? 'As a coach, you can post opportunities to find players and staff.'
                        : 'As a club, you can post opportunities to attract players and coaches.'}
                    </p>
                    <Button
                      onClick={() => navigate('/dashboard?tab=vacancies')}
                      className="mx-auto bg-gradient-to-r from-[#8026FA] to-[#924CEC]"
                    >
                      Post an Opportunity
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div className={viewMode === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 gap-6' : 'space-y-4'}>
                {filteredVacancies.map((vacancy) => {
                  const club = clubs[vacancy.club_id]
                  const isApplied = userApplications.includes(vacancy.id)
                  const org = vacancy.organization_name || club?.current_club || null
                  // Pick league based on opportunity gender
                  const leagueDivision = vacancy.gender === 'Women'
                    ? club?.womens_league_division ?? club?.mens_league_division ?? null
                    : club?.mens_league_division ?? club?.womens_league_division ?? null
                  return (
                    <OpportunityCard
                      key={vacancy.id}
                      vacancy={vacancy}
                      clubName={club?.full_name || 'Unknown Club'}
                      clubLogo={club?.avatar_url || null}
                      clubId={vacancy.club_id}
                      publisherRole={club?.role}
                      publisherOrganization={org}
                      leagueDivision={leagueDivision}
                      lastSeenAt={lastSeenAt}
                      worldClub={vacancy.world_club_id ? worldClubsMap[vacancy.world_club_id] ?? null : null}
                      onViewDetails={() => {
                        setSelectedVacancy(vacancy)
                        setShowDetailView(true)
                      }}
                      onApply={canShowApplyButton(vacancy) ? () => handleApplyClick(vacancy) : undefined}
                      hasApplied={isApplied}
                    />
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Vacancy Detail View */}
      {selectedVacancy && showDetailView && (
        <OpportunityDetailView
          vacancy={selectedVacancy}
          clubName={clubs[selectedVacancy.club_id]?.full_name || 'Unknown Club'}
          clubLogo={clubs[selectedVacancy.club_id]?.avatar_url || null}
          clubId={selectedVacancy.club_id}
          publisherRole={clubs[selectedVacancy.club_id]?.role}
          publisherOrganization={selectedVacancy.organization_name || clubs[selectedVacancy.club_id]?.current_club || null}
          leagueDivision={(() => {
            const c = clubs[selectedVacancy.club_id]
            return selectedVacancy.gender === 'Women'
              ? c?.womens_league_division ?? c?.mens_league_division ?? null
              : c?.mens_league_division ?? c?.womens_league_division ?? null
          })()}
          worldClub={selectedVacancy.world_club_id ? worldClubsMap[selectedVacancy.world_club_id] ?? null : null}
          onClose={() => {
            setShowDetailView(false)
            setSelectedVacancy(null)
          }}
          onApply={
            canShowApplyButton(selectedVacancy)
              ? () => {
                  if (!user) {
                    setShowSignInPrompt(true)
                  } else {
                    setShowApplyModal(true)
                  }
                }
              : undefined
          }
          hasApplied={userApplications.includes(selectedVacancy.id)}
        />
      )}

      {/* Sign In Prompt Modal - for unauthenticated users */}
      <SignInPromptModal
        isOpen={showSignInPrompt}
        onClose={() => setShowSignInPrompt(false)}
        title="Sign in to apply"
        message="Sign in or create a free PLAYR account to apply to this opportunity."
      />

      {/* Apply Modal */}
      {selectedVacancy && (
        <ApplyToOpportunityModal
          isOpen={showApplyModal}
          onClose={() => {
            setShowApplyModal(false)
          }}
          vacancy={selectedVacancy}
          onSuccess={(vacancyId) => {
            setShowApplyModal(false)
            setShowDetailView(false)
            setSelectedVacancy(null)
            setUserApplications(prev => {
              if (prev.includes(vacancyId)) {
                return prev
              }
              return [...prev, vacancyId]
            })
            fetchUserApplications({ skipCache: true })
          }}
          onError={(vacancyId) => {
            setUserApplications(prev => prev.filter(id => id !== vacancyId))
            fetchUserApplications({ skipCache: true })
          }}
        />
      )}

      {/* Mobile Filter Bottom Sheet */}
      <OpportunityFilterSheet
        isOpen={showFilterSheet}
        onClose={() => setShowFilterSheet(false)}
        location={filters.location}
        startDate={filters.startDate}
        benefits={filters.benefits}
        priority={filters.priority}
        onSetLocation={(location) => updateFilter('location', location)}
        onSetStartDate={(startDate) => updateFilter('startDate', startDate)}
        onToggleBenefit={toggleBenefit}
        onSetPriority={(priority) => updateFilter('priority', priority)}
        onClearSecondary={clearSecondaryFilters}
      />
      </div>
    </>
  )
}
