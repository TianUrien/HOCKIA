import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronDown, Shield, X, Check, ArrowUpDown, Plus } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../lib/auth'
import type { Vacancy } from '../lib/supabase'
import { fetchResponsivenessTiers } from '@/hooks/usePublisherResponsiveness'
import type { ResponsivenessTier } from '@/components/ResponsivenessBadge'
import Header from '../components/Header'
import OpportunityCard from '../components/OpportunityCard'
import OpportunityPreviewModal from '../components/OpportunityPreviewModal'
import CreateOpportunityModal from '../components/CreateOpportunityModal'
import Button from '../components/Button'
import { OpportunityCardSkeleton } from '../components/Skeleton'
import { OpportunitiesListJsonLd } from '../components/OpportunityJsonLd'
import { requestCache } from '@/lib/requestCache'
import { monitor } from '@/lib/monitor'
import { logger } from '@/lib/logger'
import { useOpportunityNotifications } from '@/hooks/useOpportunityNotifications'
import { useCountries, type Country } from '@/hooks/useCountries'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useScrollRestore } from '@/hooks/useScrollRestore'

// ─── Types ───────────────────────────────────────────────────────────────────

interface FiltersState {
  country: string        // country name or '' for all
  role: 'all' | 'player' | 'coach'
  /** Phase 3d — accepts the full opportunity_gender enum. URL param remains
   * `gender` for backward compatibility with public links and saved bookmarks. */
  gender: 'all' | 'Men' | 'Women' | 'Girls' | 'Boys' | 'Mixed'
  position: string       // single position or '' for all
  euPassport: boolean    // only show opportunities requiring EU passport
  /** "mine" restricts the list to opportunities the current user has
   *  applied to. Deep-linked from the coach dashboard
   *  ("View applications") and the player dashboard. */
  applied: 'all' | 'mine'
}

const GENDER_FILTER_VALUES = ['Men', 'Women', 'Girls', 'Boys', 'Mixed'] as const
type GenderFilterValue = typeof GENDER_FILTER_VALUES[number]
const isGenderFilterValue = (v: string | null): v is GenderFilterValue =>
  v !== null && (GENDER_FILTER_VALUES as readonly string[]).includes(v)

const POSITIONS = ['goalkeeper', 'defender', 'midfielder', 'forward'] as const

const SORT_VALUES = ['newest', 'oldest', 'deadline'] as const
type SortValue = typeof SORT_VALUES[number]
const isSortValue = (v: string | null): v is SortValue =>
  v !== null && (SORT_VALUES as readonly string[]).includes(v)
const SORT_OPTIONS: { value: SortValue; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'deadline', label: 'Closing soon' },
]

// ─── Filter Dropdown Component ───────────────────────────────────────────────

interface FilterDropdownProps {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
  icon?: React.ReactNode
  /** Filters are clearable (active state + an X to reset). A non-clearable
   *  dropdown — e.g. Sort — always has a value and shows a plain chevron. */
  clearable?: boolean
}

function FilterDropdown({ label, value, options, onChange, icon, clearable = true }: FilterDropdownProps) {
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
  const isActive = clearable && value !== '' && value !== 'all'
  // Fall back to the raw value when no option matches — e.g. a country
  // filtered out of the loaded results still shows "Belgium", not "Country".
  const displayLabel = clearable
    ? (isActive ? (selectedOption?.label || value || label) : label)
    : (selectedOption?.label || label)

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-colors whitespace-nowrap ${
          isActive
            ? 'bg-hockia-primary/10 border-hockia-primary text-hockia-primary font-semibold'
            : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
        }`}
      >
        {icon}
        <span>{displayLabel}</span>
        {isActive ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onChange(options[0].value); setOpen(false) }}
            className="ml-0.5 p-0.5 rounded-full hover:bg-hockia-primary/10"
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
                  ? 'bg-hockia-primary/5 text-hockia-primary font-medium'
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

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function OpportunitiesPage() {
  useDocumentTitle('Opportunities')
  const [searchParams, setSearchParams] = useSearchParams()
  const { user, profile } = useAuthStore()
  const isCurrentUserTestAccount = profile?.is_test_account ?? false
  const isStaging = import.meta.env.VITE_SUPABASE_URL?.includes('ivjkdaylalhsteyyclvl')
  const { countries } = useCountries()

  // Vacancies today are player/coach only (RLS enforces role + opportunity_type
  // on application insert). Umpires browse the list like everyone else — they
  // just don't see Apply buttons (gated below via canShowApplyButton) and
  // they still can't post. When umpire appointments ship we'll add an umpire
  // filter + umpire-specific vacancy types.
  const isUmpire = profile?.role === 'umpire'

  // Who may post an opportunity: clubs always, coaches only in recruiter
  // mode. Mirrors the gate on the dashboard "Post an Opportunity" CTA.
  const canPostOpportunity = profile?.role === 'club'
    || (profile?.role === 'coach' && profile?.coach_recruits_for_team === true)

  const [vacancies, setVacancies] = useState<Vacancy[]>([])
  const [responsivenessTiers, setResponsivenessTiers] = useState<Map<string, ResponsivenessTier>>(new Map())
  const [clubs, setClubs] = useState<Record<string, { id: string; full_name: string; avatar_url: string | null; role: string | null; current_club: string | null; womens_league_division: string | null; mens_league_division: string | null }>>({})
  const [worldClubsMap, setWorldClubsMap] = useState<Record<string, { id: string; clubName: string; avatarUrl: string | null; countryName: string | null; flagEmoji: string | null; leagueName: string | null }>>({})
  const [userApplications, setUserApplications] = useState<string[]>([])
  const [showCreateModal, setShowCreateModal] = useState(false)

  // Modal preview state — opening an opportunity from the list shows
  // it as an overlay on top of the (still-mounted) list, so scroll /
  // filters / search are preserved without a route navigation. Mirrors
  // the Community MemberPreviewModal pattern. Deep-link entries to
  // /opportunities/:id still use the standalone OpportunityDetailPage.
  const [previewVacancy, setPreviewVacancy] = useState<Vacancy | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [isSyncingNewVacancies, setIsSyncingNewVacancies] = useState(false)

  // Restore scroll on POP-back from /opportunities/:id so the X-close
  // (now navigate(-1)) lands the user exactly where they were. Gated on
  // !isLoading so the hook waits for the list to render tall enough
  // before scrolling.
  useScrollRestore(!isLoading)

  // Filters — initialized from URL params
  const [filters, setFilters] = useState<FiltersState>(() => {
    const roleParam = searchParams.get('role')
    // The dropdown is labelled "Category"; the canonical param stays
    // `gender` for backward compatibility, but `?category=` is accepted
    // as an alias so the label and the shareable URL agree.
    const genderParam = searchParams.get('gender') ?? searchParams.get('category')
    const appliedParam = searchParams.get('applied')
    return {
      country: searchParams.get('country') || '',
      role: (roleParam === 'player' || roleParam === 'coach') ? roleParam : 'all',
      gender: isGenderFilterValue(genderParam) ? genderParam : 'all',
      position: searchParams.get('position') || '',
      euPassport: searchParams.get('eu_passport') === 'true',
      applied: appliedParam === 'mine' ? 'mine' : 'all',
    }
  })

  // Sort — newest first by default. Persisted to ?sort= when non-default.
  const [sort, setSort] = useState<SortValue>(() => {
    const s = searchParams.get('sort')
    return isSortValue(s) ? s : 'newest'
  })

  // Sync filter + sort state to URL (replaceState)
  useEffect(() => {
    const params = new URLSearchParams()
    if (filters.country) params.set('country', filters.country)
    if (filters.role !== 'all') params.set('role', filters.role)
    if (filters.gender !== 'all') params.set('gender', filters.gender)
    if (filters.position) params.set('position', filters.position)
    if (filters.euPassport) params.set('eu_passport', 'true')
    if (filters.applied !== 'all') params.set('applied', filters.applied)
    if (sort !== 'newest') params.set('sort', sort)
    setSearchParams(params, { replace: true })
  }, [filters, sort, setSearchParams])

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

    const filterKey = `${filters.role}-${filters.gender}-${filters.position}-${filters.euPassport}`
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
            if (filters.euPassport) query = query.eq('eu_passport_required', true)

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
        // Responsiveness badges (Task 2): one tiny batch query per page —
        // absence of a row/tier is the neutral state (no badge, never shame).
        void fetchResponsivenessTiers(
          ((vacanciesData as Vacancy[]) || []).map((v) => v.club_id).filter(Boolean) as string[],
        ).then(setResponsivenessTiers)
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
    document.title = 'Field Hockey Opportunities • HOCKIA'
    const metaDescription = 'Browse field hockey opportunities for players and coaches. Find your next team, coaching position, or club role on HOCKIA.'
    const metaDescTag = document.querySelector('meta[name="description"]')
    if (metaDescTag) metaDescTag.setAttribute('content', metaDescription)
    const ogTitle = document.querySelector('meta[property="og:title"]')
    if (ogTitle) ogTitle.setAttribute('content', 'Field Hockey Opportunities • HOCKIA')
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

  // ─── Filtering & Sorting ───────────────────────────────────────────────────

  // Flat newest-first feed. Country is per-card metadata + a filter, not a
  // page-level grouping — so users always see the latest opportunities first.
  const filteredOpportunities = useMemo(() => {
    let filtered = [...vacancies]

    // Country filter (client-side since it's from location_country free text)
    if (filters.country) {
      filtered = filtered.filter(v =>
        v.location_country?.toLowerCase() === filters.country.toLowerCase()
      )
    }

    // "Applied: mine" — restrict to opportunities the current user has
    // applied to. Deep-linked from dashboards via ?applied=mine.
    if (filters.applied === 'mine') {
      const appliedSet = new Set(userApplications)
      filtered = filtered.filter(v => appliedSet.has(v.id))
    }

    const time = (d: string | null | undefined) => (d ? new Date(d).getTime() : 0)
    filtered.sort((a, b) => {
      if (sort === 'oldest') return time(a.created_at) - time(b.created_at)
      if (sort === 'deadline') {
        // Soonest deadline first; opportunities with no deadline go last.
        const da = a.application_deadline ? time(a.application_deadline) : Infinity
        const db = b.application_deadline ? time(b.application_deadline) : Infinity
        if (da !== db) return da - db
        return time(b.created_at) - time(a.created_at)
      }
      // newest (default)
      return time(b.created_at) - time(a.created_at)
    })

    return filtered
  }, [vacancies, filters.country, filters.applied, userApplications, sort])

  const totalFilteredCount = filteredOpportunities.length

  const hasActiveFilters = filters.country !== '' || filters.role !== 'all' || filters.gender !== 'all' || filters.position !== '' || filters.euPassport || filters.applied !== 'all'

  const clearFilters = () => {
    setFilters({ country: '', role: 'all', gender: 'all', position: '', euPassport: false, applied: 'all' })
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {!isLoading && totalFilteredCount > 0 && (
        <OpportunitiesListJsonLd
          opportunities={filteredOpportunities}
          totalCount={totalFilteredCount}
        />
      )}

      <div className="min-h-screen bg-gray-50">
        <Header />

        <main className="max-w-[640px] md:max-w-5xl mx-auto px-4 pt-24 pb-12">
          {/* Page Header */}
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-gray-900 mb-1">
                Opportunities
              </h1>
              <p className="text-sm text-gray-500">
                {isUmpire
                  ? 'See what clubs are looking for — roster openings across the HOCKIA network.'
                  : 'Find your next career move in field hockey'}
              </p>
            </div>
            {canPostOpportunity && (
              <Button
                onClick={() => setShowCreateModal(true)}
                className="flex-shrink-0 inline-flex items-center gap-1.5 bg-gradient-to-r from-hockia-primary to-hockia-secondary hover:opacity-90"
              >
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">Post Opportunity</span>
                <span className="sm:hidden">Post</span>
              </Button>
            )}
          </div>

          {/* Umpire read-only notice — opportunities are player/coach roster
              listings today, so Apply is hidden for umpires. Kept low-key so
              it informs without blocking the browsing experience. */}
          {isUmpire && (
            <div className="mb-6 flex items-start gap-3 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
              <Shield className="w-5 h-5 text-amber-700 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-amber-900">
                <p className="font-medium">Browse-only for umpires right now</p>
                <p className="text-amber-800 mt-0.5">
                  Opportunities here are player and coach roster openings.
                  You can see what clubs are building, but Apply is hidden.
                  Umpire appointments and assessments will live here when we open them.
                </p>
              </div>
            </div>
          )}

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
                label="Category"
                value={filters.gender}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'Men', label: 'Adult Men' },
                  { value: 'Women', label: 'Adult Women' },
                  { value: 'Girls', label: 'Girls' },
                  { value: 'Boys', label: 'Boys' },
                  { value: 'Mixed', label: 'Mixed' },
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
            {/* EU Passport — a toggle, not a dropdown. The checkbox box
                makes the on/off nature unambiguous next to the dropdowns. */}
            <button
              type="button"
              onClick={() => setFilters(prev => ({ ...prev, euPassport: !prev.euPassport }))}
              className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition-colors whitespace-nowrap ${
                filters.euPassport
                  ? 'bg-blue-50 border-blue-300 text-blue-700'
                  : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
              }`}
            >
              <span
                className={`flex h-4 w-4 items-center justify-center rounded border ${
                  filters.euPassport ? 'border-blue-600 bg-blue-600' : 'border-gray-300'
                }`}
                aria-hidden="true"
              >
                {filters.euPassport && <Check className="h-3 w-3 text-white" />}
              </span>
              EU Passport
            </button>

            {/* "Applied: mine" — chip shown only when the filter is
                active. Users land here from the dashboard "View
                applications" CTA, and the chip gives them a clear way
                to drop the restriction. */}
            {filters.applied === 'mine' && (
              <button
                type="button"
                onClick={() => setFilters(prev => ({ ...prev, applied: 'all' }))}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border bg-hockia-primary/5 border-hockia-primary/20 text-hockia-primary whitespace-nowrap"
                aria-label="Clear applied filter"
              >
                <span>My applications</span>
                <X className="w-3 h-3" />
              </button>
            )}

            {/* Clear all — shown once any filter is applied. */}
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex items-center gap-1 px-2.5 py-2 rounded-lg text-sm font-medium text-gray-500 hover:text-hockia-primary hover:bg-hockia-primary/5 transition-colors whitespace-nowrap"
              >
                <X className="w-3.5 h-3.5" />
                Clear all
              </button>
            )}

            {/* Sort — a real menu (Newest / Oldest / Closing soon). */}
            <div className="ml-auto">
              <FilterDropdown
                label="Sort"
                clearable={false}
                value={sort}
                options={SORT_OPTIONS}
                onChange={(v) => setSort(v as SortValue)}
                icon={<ArrowUpDown className="w-3.5 h-3.5" />}
              />
            </div>
          </div>

          {/* New opportunities banner */}
          {opportunityCount > 0 && (
            <div className="bg-hockia-primary/5 border border-hockia-primary/10 text-gray-900 rounded-xl p-4 mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
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
                className="border-hockia-primary/20 text-hockia-primary bg-white hover:bg-hockia-primary/5 disabled:opacity-60 flex-shrink-0"
                disabled={isSyncingNewVacancies}
                onClick={handleSyncNewVacancies}
              >
                {isSyncingNewVacancies ? 'Updating...' : 'View latest'}
              </Button>
            </div>
          )}

          {/* Content */}
          {isLoading ? (
            <div className="columns-1 md:columns-2 gap-4">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="break-inside-avoid mb-4">
                  <OpportunityCardSkeleton />
                </div>
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
                className="mx-auto bg-gradient-to-r from-hockia-primary to-hockia-secondary"
              >
                Try Again
              </Button>
            </div>
          ) : totalFilteredCount === 0 ? (
            <div className="bg-white rounded-xl p-12 text-center">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-3xl">🔍</span>
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                {filters.applied === 'mine' ? "You haven't applied yet" : 'No opportunities found'}
              </h3>
              <p className="text-gray-600 mb-6">
                {filters.applied === 'mine'
                  ? 'Apply to opportunities and they\'ll show up here.'
                  : hasActiveFilters
                    ? 'Try adjusting your filters to see more results'
                    : 'No opportunities are currently available'}
              </p>
              {hasActiveFilters && (
                <Button onClick={clearFilters} className="mx-auto">
                  Clear Filters
                </Button>
              )}
              {/* Posting an opportunity is recruiter-only.
                  - Clubs: always.
                  - Coaches: only when coach_recruits_for_team is true.
                  Without the coach gate, candidate-only coaches saw the
                  CTA and got bounced by CoachDashboard's tab=opportunities
                  redirect — confusing dead-end. */}
              {canPostOpportunity && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <p className="text-sm text-gray-500 mb-3">
                    {profile?.role === 'coach'
                      ? 'As a coach, you can post opportunities to find players and staff.'
                      : 'As a club, you can post opportunities to attract players and coaches.'}
                  </p>
                  <Button
                    onClick={() => setShowCreateModal(true)}
                    className="mx-auto inline-flex items-center gap-1.5 bg-gradient-to-r from-hockia-primary to-hockia-secondary"
                  >
                    <Plus className="w-4 h-4" />
                    Post an Opportunity
                  </Button>
                </div>
              )}
            </div>
          ) : (
            /* Flat newest-first feed — App Store-style masonry bento.
               Tiles flow into columns at their natural height, so a
               richly-completed opportunity reads taller than a sparse
               one and the feed never looks like a repetitive list. */
            <div className="columns-1 md:columns-2 gap-4">
              {filteredOpportunities.map((vacancy) => {
                const club = clubs[vacancy.club_id]
                const org = vacancy.organization_name || club?.current_club || null

                return (
                  <OpportunityCard
                    key={vacancy.id}
                    vacancy={vacancy}
                    clubName={club?.full_name || 'Unknown Club'}
                    clubLogo={club?.avatar_url || null}
                    clubId={vacancy.club_id}
                    publisherRole={club?.role}
                    publisherOrganization={org}
                    worldClub={vacancy.world_club_id ? worldClubsMap[vacancy.world_club_id] ?? null : null}
                    countryFlag={getFlagEmoji(vacancy.location_country)}
                    responsivenessTier={responsivenessTiers.get(vacancy.club_id) ?? null}
                    onViewDetails={() => setPreviewVacancy(vacancy)}
                  />
                )
              })}
            </div>
          )}
        </main>
      </div>

      {/* Create Opportunity — launched directly from the feed for clubs
          and recruiter-coaches, so posting doesn't require a dashboard
          detour. Refetches the feed on success so the new opportunity
          appears immediately. */}
      {showCreateModal && (
        <CreateOpportunityModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false)
            fetchVacancies({ skipCache: true })
          }}
        />
      )}

      {/* Opportunity preview — opens as an in-place overlay so the list
          underneath stays mounted (scroll, filters, search all preserved).
          All visible data is already in memory, so the modal opens
          instantly without a fetch. */}
      {previewVacancy && (
        <OpportunityPreviewModal
          vacancy={previewVacancy}
          clubInfo={clubs[previewVacancy.club_id]}
          worldClub={previewVacancy.world_club_id ? worldClubsMap[previewVacancy.world_club_id] ?? null : null}
          hasApplied={userApplications.includes(previewVacancy.id)}
          onClose={() => setPreviewVacancy(null)}
          onApplicationSuccess={(vacancyId) => {
            setUserApplications(prev => prev.includes(vacancyId) ? prev : [...prev, vacancyId])
          }}
        />
      )}
    </>
  )
}
