import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronDown, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../lib/auth'
import type { Vacancy } from '../lib/supabase'
import Header from '../components/Header'
import OpportunityCard from '../components/OpportunityCard'
import OpportunityDetailView from '../components/OpportunityDetailView'
import ApplyToOpportunityModal from '../components/ApplyToOpportunityModal'
import SignInPromptModal from '../components/SignInPromptModal'
import Button from '../components/Button'
import { OpportunityCardSkeleton } from '../components/Skeleton'
import { OpportunitiesListJsonLd } from '../components/OpportunityJsonLd'
import { requestCache } from '@/lib/requestCache'
import { monitor } from '@/lib/monitor'
import { logger } from '@/lib/logger'
import { useOpportunityNotifications } from '@/hooks/useOpportunityNotifications'
import { useCountries, type Country } from '@/hooks/useCountries'

// ─── Types ───────────────────────────────────────────────────────────────────

interface FiltersState {
  country: string        // country name or '' for all
  role: 'all' | 'player' | 'coach'
  gender: 'all' | 'Men' | 'Women'
  position: string       // single position or '' for all
}

const POSITIONS = ['goalkeeper', 'defender', 'midfielder', 'forward'] as const

// ─── Filter Dropdown Component ───────────────────────────────────────────────

interface FilterDropdownProps {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
  icon?: React.ReactNode
}

function FilterDropdown({ label, value, options, onChange, icon }: FilterDropdownProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const selectedOption = options.find(o => o.value === value)
  const isActive = value !== '' && value !== 'all'
  const displayLabel = isActive ? selectedOption?.label || label : label

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-colors whitespace-nowrap ${
          isActive
            ? 'bg-[#8026FA]/5 border-[#8026FA]/20 text-[#8026FA]'
            : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
        }`}
      >
        {icon}
        <span>{displayLabel}</span>
        {isActive ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onChange(options[0].value); setOpen(false) }}
            className="ml-0.5 p-0.5 rounded-full hover:bg-[#8026FA]/10"
            aria-label={`Clear ${label} filter`}
          >
            <X className="w-3 h-3" />
          </button>
        ) : (
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        )}
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 min-w-[180px] bg-white border border-gray-200 rounded-xl shadow-lg z-50 py-1 max-h-[300px] overflow-y-auto">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => { onChange(option.value); setOpen(false) }}
              className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                value === option.value
                  ? 'bg-[#8026FA]/5 text-[#8026FA] font-medium'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Country Group Header ────────────────────────────────────────────────────

function CountryGroupHeader({ countryName, flagEmoji }: { countryName: string; flagEmoji: string | null }) {
  return (
    <div className="flex items-center gap-2.5 mb-4 pt-10">
      {flagEmoji && <span className="text-2xl">{flagEmoji}</span>}
      <h2 className="text-xl font-bold text-gray-900">{countryName}</h2>
    </div>
  )
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function OpportunitiesPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { user, profile } = useAuthStore()
  const isCurrentUserTestAccount = profile?.is_test_account ?? false
  const isStaging = import.meta.env.VITE_SUPABASE_URL?.includes('ivjkdaylalhsteyyclvl')
  const { countries } = useCountries()

  const [vacancies, setVacancies] = useState<Vacancy[]>([])
  const [clubs, setClubs] = useState<Record<string, { id: string; full_name: string; avatar_url: string | null; role: string | null; current_club: string | null; womens_league_division: string | null; mens_league_division: string | null }>>({})
  const [worldClubsMap, setWorldClubsMap] = useState<Record<string, { id: string; clubName: string; avatarUrl: string | null; countryName: string | null; flagEmoji: string | null; leagueName: string | null }>>({})
  const [userApplications, setUserApplications] = useState<string[]>([])
  const [selectedVacancy, setSelectedVacancy] = useState<Vacancy | null>(null)
  const [showApplyModal, setShowApplyModal] = useState(false)
  const [showSignInPrompt, setShowSignInPrompt] = useState(false)
  const [showDetailView, setShowDetailView] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [isSyncingNewVacancies, setIsSyncingNewVacancies] = useState(false)

  // Filters — initialized from URL params
  const [filters, setFilters] = useState<FiltersState>(() => {
    const roleParam = searchParams.get('role')
    const genderParam = searchParams.get('gender')
    return {
      country: searchParams.get('country') || '',
      role: (roleParam === 'player' || roleParam === 'coach') ? roleParam : 'all',
      gender: (genderParam === 'Men' || genderParam === 'Women') ? genderParam : 'all',
      position: searchParams.get('position') || '',
    }
  })

  // Sync filter state to URL (replaceState)
  useEffect(() => {
    const params = new URLSearchParams()
    if (filters.country) params.set('country', filters.country)
    if (filters.role !== 'all') params.set('role', filters.role)
    if (filters.gender !== 'all') params.set('gender', filters.gender)
    if (filters.position) params.set('position', filters.position)
    setSearchParams(params, { replace: true })
  }, [filters, setSearchParams])

  const { count: opportunityCount, markSeen, refresh: refreshOpportunityNotifications } = useOpportunityNotifications()

  // Build country name → flag emoji map from countries data
  const countryFlagMap = useMemo(() => {
    const map: Record<string, string> = {}
    countries.forEach((c: Country) => {
      if (c.flag_emoji) {
        map[c.name.toLowerCase()] = c.flag_emoji
        if (c.common_name) map[c.common_name.toLowerCase()] = c.flag_emoji
      }
    })
    return map
  }, [countries])

  const getFlagEmoji = useCallback((countryName: string | null | undefined): string | null => {
    if (!countryName) return null
    return countryFlagMap[countryName.toLowerCase()] || null
  }, [countryFlagMap])

  // Build country options from available vacancies
  const countryOptions = useMemo(() => {
    const countrySet = new Set<string>()
    vacancies.forEach(v => {
      if (v.location_country) countrySet.add(v.location_country)
    })
    const sorted = [...countrySet].sort((a, b) => a.localeCompare(b))
    return [
      { value: '', label: 'All Countries' },
      ...sorted.map(c => {
        const flag = getFlagEmoji(c)
        return { value: c, label: flag ? `${flag}  ${c}` : c }
      }),
    ]
  }, [vacancies, getFlagEmoji])

  // ─── Data Fetching ─────────────────────────────────────────────────────────

  const fetchVacancies = useCallback(async (options?: { skipCache?: boolean; silent?: boolean }) => {
    if (!options?.silent) setIsLoading(true)
    setFetchError(null)

    const filterKey = `${filters.role}-${filters.gender}-${filters.position}`
    const cacheKey = isCurrentUserTestAccount ? `open-vacancies-test-${filterKey}` : `open-vacancies-${filterKey}`

    if (options?.skipCache) requestCache.invalidate(cacheKey)

    await monitor.measure('fetch_vacancies', async () => {
      try {
        const { vacanciesData, clubsMap, wcMap } = await requestCache.dedupe(
          cacheKey,
          async () => {
            let query = supabase
              .from('opportunities')
              .select(`
                *,
                club:profiles!opportunities_club_id_fkey(
                  id, full_name, avatar_url, is_test_account, role, current_club,
                  womens_league_division, mens_league_division
                ),
                world_club:world_clubs!opportunities_world_club_id_fkey(
                  id, club_name, avatar_url,
                  claimed_profile:profiles!world_clubs_claimed_profile_id_fkey(avatar_url),
                  country:countries(name, flag_emoji),
                  men_league:world_leagues!world_clubs_men_league_id_fkey(name, tier),
                  women_league:world_leagues!world_clubs_women_league_id_fkey(name, tier)
                )
              `)
              .eq('status', 'open')

            // Server-side filters
            if (filters.role !== 'all') query = query.eq('opportunity_type', filters.role)
            if (filters.gender !== 'all') query = query.eq('gender', filters.gender)
            if (filters.position) query = query.eq('position', filters.position as NonNullable<Vacancy['position']>)

            const { data: vacanciesData, error: vacanciesError } = await query
              .order('created_at', { ascending: false })

            if (vacanciesError) throw vacanciesError

            type WorldClubJoin = {
              id: string; club_name: string; avatar_url: string | null
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
            if (!isStaging && !isCurrentUserTestAccount) {
              filteredVacancies = filteredVacancies.filter(v => !v.club?.is_test_account)
            }

            const clubsMap: Record<string, { id: string; full_name: string; avatar_url: string | null; role: string | null; current_club: string | null; womens_league_division: string | null; mens_league_division: string | null }> = {}
            const wcMap: Record<string, { id: string; clubName: string; avatarUrl: string | null; countryName: string | null; flagEmoji: string | null; leagueName: string | null }> = {}

            filteredVacancies.forEach((vacancy) => {
              if (vacancy.club?.id) {
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

            return { vacanciesData: filteredVacancies, clubsMap, wcMap }
          },
          options?.skipCache ? 0 : 5000
        )

        setVacancies((vacanciesData as Vacancy[]) || [])
        setClubs(clubsMap)
        setWorldClubsMap(wcMap)
      } catch (error) {
        logger.error('Error fetching vacancies:', error)
        setFetchError('Could not load opportunities. Please check your connection and try again.')
      } finally {
        if (!options?.silent) setIsLoading(false)
      }
    })
  }, [isCurrentUserTestAccount, isStaging, filters])

  const fetchUserApplications = useCallback(async (options?: { skipCache?: boolean }) => {
    if (!user || (profile?.role !== 'player' && profile?.role !== 'coach')) return

    await monitor.measure('fetch_user_applications', async () => {
      const cacheKey = `user-applications-${user.id}`
      const shouldSkipCache = options?.skipCache === true
      try {
        if (shouldSkipCache) requestCache.invalidate(cacheKey)
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
          shouldSkipCache ? 0 : 30000
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

  // SEO meta tags
  useEffect(() => {
    document.title = 'Field Hockey Opportunities | HOCKIA'
    const metaDescription = 'Browse field hockey opportunities for players and coaches. Find your next team, coaching position, or club role on HOCKIA.'
    const metaDescTag = document.querySelector('meta[name="description"]')
    if (metaDescTag) metaDescTag.setAttribute('content', metaDescription)
    const ogTitle = document.querySelector('meta[property="og:title"]')
    if (ogTitle) ogTitle.setAttribute('content', 'Field Hockey Opportunities | HOCKIA')
    const ogDesc = document.querySelector('meta[property="og:description"]')
    if (ogDesc) ogDesc.setAttribute('content', metaDescription)
    const ogUrl = document.querySelector('meta[property="og:url"]')
    if (ogUrl) ogUrl.setAttribute('content', 'https://inhockia.com/opportunities')
    return () => {
      document.title = 'HOCKIA | Field Hockey Community'
      const defaultDesc = 'Connect players, coaches, and clubs. Raise the sport together. Join HOCKIA.'
      if (metaDescTag) metaDescTag.setAttribute('content', defaultDesc)
      if (ogTitle) ogTitle.setAttribute('content', 'HOCKIA | Field Hockey Community')
      if (ogDesc) ogDesc.setAttribute('content', defaultDesc)
      if (ogUrl) ogUrl.setAttribute('content', 'https://inhockia.com')
    }
  }, [])

  const handleSyncNewVacancies = useCallback(async () => {
    if (isSyncingNewVacancies) return
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

  const handleApplyClick = (vacancy: Vacancy) => {
    setSelectedVacancy(vacancy)
    if (!user) {
      setShowSignInPrompt(true)
    } else if ((profile?.role === 'player' || profile?.role === 'coach') && !userApplications.includes(vacancy.id)) {
      setShowApplyModal(true)
    }
  }

  const canShowApplyButton = (vacancy: Vacancy) => {
    if (userApplications.includes(vacancy.id)) return false
    if (!user) return true
    if (profile?.role === 'player' && vacancy.opportunity_type === 'player') return true
    if (profile?.role === 'coach' && vacancy.opportunity_type === 'coach') return true
    return false
  }

  // ─── Filtering & Grouping ──────────────────────────────────────────────────

  // Apply client-side country filter + sort, then group by country
  const groupedOpportunities = useMemo(() => {
    let filtered = [...vacancies]

    // Country filter (client-side since it's from location_country free text)
    if (filters.country) {
      filtered = filtered.filter(v =>
        v.location_country?.toLowerCase() === filters.country.toLowerCase()
      )
    }

    // Sort by newest first (already sorted from DB, but ensure it after filtering)
    filtered.sort((a, b) => {
      const dateA = a.created_at ? new Date(a.created_at).getTime() : 0
      const dateB = b.created_at ? new Date(b.created_at).getTime() : 0
      return dateB - dateA
    })

    // Group by country
    const groups: { country: string; flagEmoji: string | null; newestAt: number; opportunities: Vacancy[] }[] = []
    const countryGroupMap = new Map<string, typeof groups[0]>()

    filtered.forEach(v => {
      const country = v.location_country || 'Other'
      let group = countryGroupMap.get(country)
      if (!group) {
        group = {
          country,
          flagEmoji: getFlagEmoji(country),
          newestAt: v.created_at ? new Date(v.created_at).getTime() : 0,
          opportunities: [],
        }
        countryGroupMap.set(country, group)
        groups.push(group)
      }
      group.opportunities.push(v)
      // Track the newest opportunity in this country group
      const ts = v.created_at ? new Date(v.created_at).getTime() : 0
      if (ts > group.newestAt) group.newestAt = ts
    })

    // Sort country groups by most recent opportunity in that country
    groups.sort((a, b) => b.newestAt - a.newestAt)

    return groups
  }, [vacancies, filters.country, getFlagEmoji])

  const totalFilteredCount = groupedOpportunities.reduce((sum, g) => sum + g.opportunities.length, 0)

  const hasActiveFilters = filters.country !== '' || filters.role !== 'all' || filters.gender !== 'all' || filters.position !== ''

  const clearFilters = () => {
    setFilters({ country: '', role: 'all', gender: 'all', position: '' })
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {!isLoading && totalFilteredCount > 0 && (
        <OpportunitiesListJsonLd
          opportunities={groupedOpportunities.flatMap(g => g.opportunities)}
          totalCount={totalFilteredCount}
        />
      )}

      <div className="min-h-screen bg-gray-50">
        <Header />

        <main className="max-w-[600px] mx-auto px-4 pt-24 pb-12">
          {/* Page Header */}
          <div className="mb-6">
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900 mb-1">
              Opportunities
            </h1>
            <p className="text-sm text-gray-500">
              Find your next career move in field hockey
            </p>
          </div>

          {/* Filter Bar */}
          <div className="flex items-center gap-2 flex-wrap mb-6">
            <FilterDropdown
              label="Country"
              value={filters.country}
              options={countryOptions}
              onChange={(v) => setFilters(prev => ({ ...prev, country: v }))}
            />
            <FilterDropdown
              label="Role"
              value={filters.role}
              options={[
                { value: 'all', label: 'All Roles' },
                { value: 'player', label: 'Player' },
                { value: 'coach', label: 'Coach' },
              ]}
              onChange={(v) => setFilters(prev => ({
                ...prev,
                role: v as FiltersState['role'],
                // Clear gender and position when switching to coach
                ...(v === 'coach' ? { gender: 'all' as const, position: '' } : {}),
              }))}
            />
            {filters.role !== 'coach' && (
              <FilterDropdown
                label="Gender"
                value={filters.gender}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'Men', label: "Men's" },
                  { value: 'Women', label: "Women's" },
                ]}
                onChange={(v) => setFilters(prev => ({ ...prev, gender: v as FiltersState['gender'] }))}
              />
            )}
            <FilterDropdown
              label="Position"
              value={filters.position}
              options={[
                { value: '', label: 'All Positions' },
                ...POSITIONS.map(p => ({
                  value: p,
                  label: p.charAt(0).toUpperCase() + p.slice(1),
                })),
              ]}
              onChange={(v) => setFilters(prev => ({ ...prev, position: v }))}
            />

            {/* Sort indicator */}
            <div className="ml-auto flex items-center gap-1.5 text-sm text-gray-500">
              <span className="text-base">↕</span>
              <span className="font-medium">Sort: Newest</span>
            </div>
          </div>

          {/* New opportunities banner */}
          {opportunityCount > 0 && (
            <div className="bg-[#8026FA]/5 border border-[#8026FA]/10 text-gray-900 rounded-xl p-4 mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <p className="font-semibold text-sm">
                  {opportunityCount === 1 ? 'New opportunity available' : `${opportunityCount} new opportunities available`}
                </p>
                <p className="text-sm text-gray-600">
                  {opportunityCount === 1 ? 'A new opportunity was just published.' : 'Fresh opportunities were published since you opened this page.'}
                </p>
              </div>
              <Button
                variant="outline"
                className="border-[#8026FA]/20 text-[#8026FA] bg-white hover:bg-[#8026FA]/5 disabled:opacity-60 flex-shrink-0"
                disabled={isSyncingNewVacancies}
                onClick={handleSyncNewVacancies}
              >
                {isSyncingNewVacancies ? 'Updating...' : 'View latest'}
              </Button>
            </div>
          )}

          {/* Content */}
          {isLoading ? (
            <div className="space-y-6">
              {[1, 2, 3].map(i => (
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
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Something went wrong</h3>
              <p className="text-gray-600 mb-6">{fetchError}</p>
              <Button
                onClick={() => fetchVacancies({ skipCache: true })}
                className="mx-auto bg-gradient-to-r from-[#8026FA] to-[#924CEC]"
              >
                Try Again
              </Button>
            </div>
          ) : totalFilteredCount === 0 ? (
            <div className="bg-white rounded-xl p-12 text-center">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-3xl">🔍</span>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">No opportunities found</h3>
              <p className="text-gray-600 mb-6">
                {hasActiveFilters
                  ? 'Try adjusting your filters to see more results'
                  : 'No opportunities are currently available'}
              </p>
              {hasActiveFilters && (
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
            /* Grouped opportunity cards by country */
            <div className="space-y-2">
              {groupedOpportunities.map((group) => (
                <div key={group.country}>
                  <CountryGroupHeader
                    countryName={group.country}
                    flagEmoji={group.flagEmoji}
                  />
                  <div className="space-y-5">
                    {group.opportunities.map((vacancy) => {
                      const club = clubs[vacancy.club_id]
                      const isApplied = userApplications.includes(vacancy.id)
                      const org = vacancy.organization_name || club?.current_club || null
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
                </div>
              ))}
            </div>
          )}
        </main>

        {/* Detail View Modal */}
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
            onClose={() => { setShowDetailView(false); setSelectedVacancy(null) }}
            onApply={
              canShowApplyButton(selectedVacancy)
                ? () => { if (!user) setShowSignInPrompt(true); else setShowApplyModal(true) }
                : undefined
            }
            hasApplied={userApplications.includes(selectedVacancy.id)}
          />
        )}

        {/* Sign In Prompt */}
        <SignInPromptModal
          isOpen={showSignInPrompt}
          onClose={() => setShowSignInPrompt(false)}
          title="Sign in to apply"
          message="Sign in or create a free HOCKIA account to apply to this opportunity."
        />

        {/* Apply Modal */}
        {selectedVacancy && (
          <ApplyToOpportunityModal
            isOpen={showApplyModal}
            onClose={() => setShowApplyModal(false)}
            vacancy={selectedVacancy}
            onSuccess={(vacancyId) => {
              setShowApplyModal(false)
              setShowDetailView(false)
              setSelectedVacancy(null)
              setUserApplications(prev => prev.includes(vacancyId) ? prev : [...prev, vacancyId])
              fetchUserApplications({ skipCache: true })
            }}
            onError={(vacancyId) => {
              setUserApplications(prev => prev.filter(id => id !== vacancyId))
              fetchUserApplications({ skipCache: true })
            }}
          />
        )}
      </div>
    </>
  )
}
