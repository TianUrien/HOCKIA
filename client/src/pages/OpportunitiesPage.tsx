import { lazy, Suspense, useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { navState } from '@/lib/navSource'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Shield, Plus, SlidersHorizontal } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../lib/auth'
import type { Vacancy } from '../lib/supabase'
import Header from '../components/Header'
import CreateOpportunityModal from '../components/CreateOpportunityModal'
import Button from '../components/Button'
import { OpportunityCardSkeleton } from '../components/Skeleton'
import { OpportunitiesListJsonLd } from '../components/OpportunityJsonLd'
import { queryClient } from '@/lib/queryClient'
import { qk } from '@/lib/queryKeys'
import { monitor } from '@/lib/monitor'
import { logger } from '@/lib/logger'
import { useOpportunityNotifications } from '@/hooks/useOpportunityNotifications'
import { useCountries, isEuCountryCode, type Country } from '@/hooks/useCountries'
import { isEuEligible } from '@/lib/euEligibility'
import { LargeTitleBar } from '@/components/ui/LargeTitleBar'
import { IconButton } from '@/components/ui/IconButton'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { RoleCard } from '@/components/opportunities/RoleCard'
import { FeaturedRoleCard } from '@/components/opportunities/FeaturedRoleCard'
import { RailCard, RoleRail, RoleRailDesktop } from '@/components/opportunities/RoleRail'
import { roleIdentity, type RoleIdentity } from '@/lib/opportunityIdentity'
import { buildRails, pickFeatured, type RailKey } from '@/lib/opportunityRails'
import { useClubCrestPalettes, useWorldClubCrestPalettes } from '@/hooks/useClubCrestColors'
import { CATEGORY_DOT_CLASSES } from '@/lib/opportunityCopy'
import { installSpringEasing } from '@/lib/spring'
import { hapticSelection } from '@/lib/haptics'
import type { CrestPalette } from '@/lib/crestPalette'
import { OpportunityFiltersSheet } from '@/components/opportunities/OpportunityFiltersSheet'
import { EMPTY_ROLE_FILTERS, QUICK_CHIPS, applyRoleFilters, countActiveRoleFilters, isQuickChipOn, toggleQuickChip, type RoleFilters } from '@/lib/opportunityFilters'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useScrollRestore } from '@/hooks/useScrollRestore'
import { Chip } from '@/components/ui/Chip'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useClubRoles, type ClubRole } from '@/hooks/useClubRoles'
import { useCoachingRolesHistory } from '@/hooks/useCoachingRolesHistory'
import { useProfileWriter } from '@/hooks/useProfileWriter'
import { CoachRolesEmptyState } from '@/components/opportunities/CoachRolesEmptyState'
import { RecruiterRoles } from '@/components/club/ClubOpportunitiesScreen'
import { HockiaAiButton } from '@/components/hockiaAi/HockiaAiButton'
import { useHockiaAiSheet } from '@/components/hockiaAi/hockiaAiSheetStore'
import { coachingRolesOpenLine, isCandidateCoach, isRecruitingCoach } from '@/lib/coachRoles'

// Coach v2 · My roles (recruiting coaches, phones): the Club v2 panel in its
// own chunk, so players and candidate coaches never download it.
const CoachMyRoles = lazy(() => import('@/components/opportunities/CoachMyRoles'))

// ─── Types ───────────────────────────────────────────────────────────────────

interface FiltersState {
  country: string        // country name or '' for all
  role: 'all' | 'player' | 'coach'
  /** Player-role teams only (no Girls/Boys — player roles are adult-only,
   * founder ruling 2026-09-25). URL param remains `gender` for backward
   * compatibility; an old ?gender=Girls|Boys link falls back to 'all'. */
  gender: 'all' | 'Men' | 'Women' | 'Mixed'
  position: string       // single position or '' for all
  euPassport: boolean    // only show opportunities requiring EU passport
  /** "mine" restricts the list to opportunities the current user has
   *  applied to. Deep-linked from the coach dashboard
   *  ("View applications") and the player dashboard. */
  applied: 'all' | 'mine'
}

const GENDER_FILTER_VALUES = ['Men', 'Women', 'Mixed'] as const
type GenderFilterValue = typeof GENDER_FILTER_VALUES[number]
const isGenderFilterValue = (v: string | null): v is GenderFilterValue =>
  v !== null && (GENDER_FILTER_VALUES as readonly string[]).includes(v)

const SORT_VALUES = ['newest', 'oldest', 'deadline'] as const
type SortValue = typeof SORT_VALUES[number]
const isSortValue = (v: string | null): v is SortValue =>
  v !== null && (SORT_VALUES as readonly string[]).includes(v)
// ─── Main Page ───────────────────────────────────────────────────────────────

export default function OpportunitiesPage() {
  useDocumentTitle('Opportunities')
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
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
  const [clubs, setClubs] = useState<Record<string, { id: string; full_name: string; avatar_url: string | null; role: string | null; current_club: string | null; coach_current_role?: string | null; womens_league_division: string | null; mens_league_division: string | null }>>({})
  const [worldClubsMap, setWorldClubsMap] = useState<Record<string, { id: string; clubName: string; avatarUrl: string | null; countryName: string | null; flagEmoji: string | null; leagueName: string | null }>>({})
  const [userApplications, setUserApplications] = useState<string[]>([])
  // The viewer's own status per applied role — the preview shows the real
  // status (No reply, Shortlisted…) instead of a generic "submitted".
  const [applicationStatuses, setApplicationStatuses] = useState<Record<string, string>>({})
  const [showCreateModal, setShowCreateModal] = useState(false)
  // Coach v2 · My roles: "Edit role" / a draft's Continue open the coach's own role form.
  const [editingRole, setEditingRole] = useState<Vacancy | null>(null)
  // Club speed CS3 · Post again: a closed role that seeds a new one in the create form.
  const [templateRole, setTemplateRole] = useState<Vacancy | null>(null)

  // Coach v2 (Figma D6.2 377:614 · D6.4 377:1814), phone only. A candidate
  // coach's Roles list holds coaching roles only; a coach who recruits keeps
  // today's list and gets "My roles" next to it. Players are untouched.
  const isPhone = useMediaQuery('(max-width: 1023px)')
  const candidateCoach = isCandidateCoach(profile)
  const recruitingCoach = isRecruitingCoach(profile)
  const [coachView, setCoachView] = useState<'roles' | 'mine'>(() => (searchParams.get('view') === 'mine' ? 'mine' : 'roles'))
  // Desktop D3 (Figma 195:889, ruling 16 Oct 2026): a club's /opportunities is
  // its own roles; a recruiting coach gets them under "My roles" on every width.
  const clubDesktop = !isPhone && profile?.role === 'club'
  const showMyRoles = recruitingCoach && coachView === 'mine'
  const myRoles = useClubRoles(recruitingCoach || clubDesktop ? profile?.id : null)
  const myOpenRoleCount = myRoles.open.filter((r) => r.status === 'open').length
  // "Edit role" on a coach's applicants screen lands here with the role to
  // edit: open the coach's own role form once their roles have loaded.
  const routeLocation = useLocation()
  const routeState = routeLocation.state as { editRoleId?: string; postAgainRoleId?: string } | null
  const routeEditRoleId = routeState?.editRoleId ?? null
  // Club speed CS3 on desktop: "Post again" on the applicants page lands here too.
  const routePostAgainId = routeState?.postAgainRoleId ?? null
  const [pendingEditRoleId, setPendingEditRoleId] = useState<string | null>(routeEditRoleId)
  const [pendingPostAgainId, setPendingPostAgainId] = useState<string | null>(routePostAgainId)
  // Taken once: drop it from the history entry so coming back doesn't reopen the form.
  useEffect(() => {
    if (routeEditRoleId || routePostAgainId) navigate(`${routeLocation.pathname}${routeLocation.search}`, { replace: true, state: null })
  }, [routeEditRoleId, routePostAgainId, navigate, routeLocation.pathname, routeLocation.search])
  useEffect(() => {
    if ((!pendingEditRoleId && !pendingPostAgainId) || !showMyRoles || myRoles.loading) return
    const all = [...myRoles.open, ...myRoles.closed]
    const edit = pendingEditRoleId ? all.find((r) => r.id === pendingEditRoleId) : null
    const again = pendingPostAgainId ? all.find((r) => r.id === pendingPostAgainId) : null
    if (edit) { setTemplateRole(null); setEditingRole(edit); setShowCreateModal(true) }
    else if (again) { setEditingRole(null); setTemplateRole(again); setShowCreateModal(true) }
    setPendingEditRoleId(null)
    setPendingPostAgainId(null)
  }, [pendingEditRoleId, pendingPostAgainId, showMyRoles, myRoles.loading, myRoles.open, myRoles.closed])
  const settings = useProfileWriter()

  // Opportunities v2 (phone and desktop): filters sheet + quick chips + role
  // cards, applied client-side on top of the open list. A card opens the
  // role page (/opportunities/:id) on every width (desktop ruling 16 Oct 2026).
  const [roleFilters, setRoleFilters] = useState<RoleFilters>(EMPTY_ROLE_FILTERS)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  // Hockia AI (beta): the header mascot opens the sheet; a one-time tip says so.
  const showAi = useHockiaAiSheet((st) => st.show)
  const [aiTip, setAiTip] = useState(() => { try { return !localStorage.getItem('hockia-ai-tip-seen') } catch { return false } })
  const openAi = () => {
    setAiTip(false)
    try { localStorage.setItem('hockia-ai-tip-seen', '1') } catch { /* private mode */ }
    showAi('opportunities')
  }
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
    if (recruitingCoach && coachView === 'mine') params.set('view', 'mine')
    setSearchParams(params, { replace: true })
  }, [filters, sort, recruitingCoach, coachView, setSearchParams])

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

  // ─── Data Fetching ─────────────────────────────────────────────────────────

  const fetchVacancies = useCallback(async (options?: { skipCache?: boolean; silent?: boolean }) => {
    if (!options?.silent) setIsLoading(true)
    setFetchError(null)

    const filterKey = `${filters.role}-${filters.gender}-${filters.position}-${filters.euPassport}`
    const queryKey = qk.openVacancies(isCurrentUserTestAccount ? 'test' : 'std', filterKey)

    await monitor.measure('fetch_vacancies', async () => {
      try {
        // staleTime 0 on skipCache forces a fresh fetch while still
        // joining an in-flight one; otherwise 5s absorbs mount bursts.
        const { vacanciesData, clubsMap, wcMap } = await queryClient.fetchQuery({
          queryKey,
          staleTime: options?.skipCache ? 0 : 5_000,
          retry: false,
          queryFn: async () => {
            let query = supabase
              .from('opportunities')
              .select(`
                *,
                club:profiles!opportunities_club_id_fkey(
                  id, full_name, avatar_url, is_test_account, role, current_club, coach_current_role,
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

            // Order strictly by creation date (founder ruling 2026-08-13).
            // NOT published_at: re-opening a closed listing re-stamps
            // published_at via the set_opportunity_published_at trigger, so
            // publish-ordering sent every RENEWED listing to the top of
            // "Newest", above genuinely new ones (a May listing renewed in
            // August outranked an August creation). created_at matches the
            // admin panel and the shipped native builds.
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
              club?: { id: string; full_name: string | null; avatar_url: string | null; is_test_account?: boolean; role?: string | null; current_club?: string | null; coach_current_role?: string | null; womens_league_division?: string | null; mens_league_division?: string | null }
              world_club?: WorldClubJoin
            }

            let filteredVacancies = vacanciesData as VacancyWithClub[]
            if (!isStaging && !isCurrentUserTestAccount) {
              filteredVacancies = filteredVacancies.filter(v => !v.club?.is_test_account)
            }

            const clubsMap: Record<string, { id: string; full_name: string; avatar_url: string | null; role: string | null; current_club: string | null; coach_current_role?: string | null; womens_league_division: string | null; mens_league_division: string | null }> = {}
            const wcMap: Record<string, { id: string; clubName: string; avatarUrl: string | null; countryName: string | null; flagEmoji: string | null; leagueName: string | null }> = {}

            filteredVacancies.forEach((vacancy) => {
              if (vacancy.club?.id) {
                clubsMap[vacancy.club.id] = {
                  id: vacancy.club.id,
                  full_name: vacancy.club.full_name || 'Unknown Club',
                  avatar_url: vacancy.club.avatar_url,
                  role: vacancy.club.role ?? null,
                  current_club: vacancy.club.current_club ?? null,
                  coach_current_role: vacancy.club.coach_current_role ?? null,
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
        })

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
      const shouldSkipCache = options?.skipCache === true
      try {
        const appliedRows = await queryClient.fetchQuery({
          queryKey: qk.userApplications(user.id),
          staleTime: shouldSkipCache ? 0 : 30_000,
          retry: false,
          queryFn: async () => {
            const { data, error } = await supabase
              .from('opportunity_applications')
              .select('opportunity_id, status')
              .eq('applicant_id', user.id)
            if (error) throw error
            return (data as { opportunity_id: string; status: string | null }[]) ?? []
          },
        })
        setUserApplications(appliedRows.map((app) => app.opportunity_id))
        setApplicationStatuses(Object.fromEntries(appliedRows.filter((a) => a.status).map((a) => [a.opportunity_id, a.status as string])))
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
    // "Newest" = strictly by created_at, descending (founder ruling
    // 2026-08-13, reverting the 2026-08-12 publish-date ordering). The
    // set_opportunity_published_at trigger re-stamps published_at whenever a
    // closed listing is re-opened, so publish-ordering floated every RENEWAL
    // to the top above genuinely new listings. Creation date is the stable
    // key — and the one the admin panel and native builds already use.
    // Trade-off, accepted: a renewed old listing keeps its chronological
    // place mid-list even when the Home feed announces its re-publish.
    const created = (v: { created_at: string }) => time(v.created_at)
    filtered.sort((a, b) => {
      if (sort === 'oldest') return created(a) - created(b)
      if (sort === 'deadline') {
        // Soonest deadline first; opportunities with no deadline go last.
        const da = a.application_deadline ? time(a.application_deadline) : Infinity
        const db = b.application_deadline ? time(b.application_deadline) : Infinity
        if (da !== db) return da - db
        return created(b) - created(a)
      }
      // newest (default)
      return created(b) - created(a)
    })

    return filtered
  }, [vacancies, filters.country, filters.applied, userApplications, sort])

  const totalFilteredCount = filteredOpportunities.length

  // "Only roles my passports qualify for" — EU-only roles hide for a non-EU
  // player. Unknown nationality keeps everything (never hide for an
  // incomplete profile).
  const euCountryIds = useMemo(() => new Set(countries.filter((c) => isEuCountryCode(c.code)).map((c) => c.id)), [countries])
  const viewerIsEuEligible = isEuEligible(profile?.nationality_country_id, profile?.nationality2_country_id, euCountryIds)
  // The phone list's base: coaching roles only for a candidate coach.
  const phoneBase = useMemo(
    () => (candidateCoach ? filteredOpportunities.filter((v) => v.opportunity_type === 'coach') : filteredOpportunities),
    [candidateCoach, filteredOpportunities],
  )
  const mobileList = useMemo(() => applyRoleFilters(phoneBase, roleFilters, viewerIsEuEligible), [phoneBase, roleFilters, viewerIsEuEligible])
  // No coaching role open at all (before any phone filter): the D6.2 empty state.
  const coachEmpty = candidateCoach && !isLoading && !fetchError && filters.applied !== 'mine' && phoneBase.length === 0
  // Hockia AI's chip says "Coaching roles · N open" with the same N this list shows.
  const setAiPageFacts = useHockiaAiSheet((st) => st.setPageFacts)
  const coachOpenKnown = candidateCoach && !isLoading && !fetchError && filters.applied !== 'mine'
  useEffect(() => {
    if (!coachOpenKnown) return
    setAiPageFacts({ coachingRolesOpen: phoneBase.length })
    return () => setAiPageFacts({})
  }, [coachOpenKnown, phoneBase.length, setAiPageFacts])

  const leagueFor = useCallback((v: Vacancy) => {
    const wc = v.world_club_id ? worldClubsMap[v.world_club_id] : null
    const club = clubs[v.club_id]
    if (wc?.leagueName) return wc.leagueName
    const womens = v.gender === 'Women' || v.gender === 'Girls'
    return (womens ? club?.womens_league_division ?? club?.mens_league_division : club?.mens_league_division ?? club?.womens_league_division) ?? null
  }, [worldClubsMap, clubs])

  // ── Opportunities v2 (phone + desktop): covers in the club's crest colours,
  // the featured role and the themed rails over the filtered list ──
  useEffect(() => { installSpringEasing() }, [])
  const phoneClubs = useMemo(() => Object.values(clubs).filter((c) => c.role !== 'coach').map((c) => ({ id: c.id, avatar_url: c.avatar_url })), [clubs])
  const phoneWorldClubs = useMemo(() => Object.values(worldClubsMap).map((w) => ({ id: w.id, avatar_url: w.avatarUrl })), [worldClubsMap])
  const profilePalettes = useClubCrestPalettes(phoneClubs)
  const worldPalettes = useWorldClubCrestPalettes(phoneWorldClubs)
  const relevance = useMemo(() => ({ profile, countries }), [profile, countries])
  const structured = !showMyRoles && !coachEmpty && filters.applied !== 'mine'
  // A featured card over a list of one or two roles only repeats them: it needs three.
  const featured = useMemo(() => (structured && mobileList.length >= 3 ? pickFeatured(mobileList, relevance) : null), [structured, mobileList, relevance])
  const rails = useMemo(() => (structured ? buildRails(mobileList, relevance, featured?.id ?? null) : []), [structured, mobileList, relevance, featured])
  const allRolesRef = useRef<HTMLDivElement>(null)
  /** Everything a phone card needs about one role: who is behind it and the cover palette. */
  const describeRole = useCallback((vacancy: Vacancy): { identity: RoleIdentity; palette: CrestPalette | null; flag: string | null; league: string | null } => {
    const club = clubs[vacancy.club_id]
    const wc = vacancy.world_club_id ? worldClubsMap[vacancy.world_club_id] ?? null : null
    const identity = roleIdentity({ publisherRole: club?.role, publisherName: club?.full_name, publisherAvatar: club?.avatar_url, organizationName: vacancy.organization_name, publisherCurrentClub: club?.current_club, publisherCoachRole: club?.coach_current_role, worldClub: wc ? { name: wc.clubName, avatarUrl: wc.avatarUrl } : null })
    const palette = (wc && worldPalettes.get(wc.id)) || (club && club.role !== 'coach' ? profilePalettes.get(club.id) : null) || null
    return { identity, palette, flag: getFlagEmoji(vacancy.location_country), league: leagueFor(vacancy) }
  }, [clubs, worldClubsMap, worldPalettes, profilePalettes, getFlagEmoji, leagueFor])
  const seeAll = (key: RailKey) => {
    if (key === 'for-you') setRoleFilters({ ...EMPTY_ROLE_FILTERS, eligibleOnly: true, position: profile?.role === 'player' ? profile.position ?? '' : '' })
    else if (key === 'paid-housing') setRoleFilters({ ...EMPTY_ROLE_FILTERS, package: ['paid', 'housing'] })
    else setSort('deadline')
    requestAnimationFrame(() => allRolesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
  const coachHistory = useCoachingRolesHistory({ enabled: coachEmpty && isPhone, includeTestAccounts: Boolean(isStaging) || isCurrentUserTestAccount })
  const activeRoleFilterCount = countActiveRoleFilters(roleFilters)
  const nationalityWord = countries.find((c) => c.id === profile?.nationality_country_id)?.nationality_name ?? profile?.nationality ?? null
  const eligibleCount = useMemo(() => vacancies.filter((v) => !v.eu_passport_required || viewerIsEuEligible).length, [vacancies, viewerIsEuEligible])
  const passportHint = profile?.role === 'player' && nationalityWord ? `${nationalityWord} · ${eligibleCount} of ${vacancies.length} open roles` : null

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

      <div className="min-h-screen bg-white lg:bg-gray-50">
        <Header mobileHidden />

        <main className="max-w-[640px] md:max-w-5xl mx-auto px-0 pt-[calc(env(safe-area-inset-top)+0.5rem)] pb-24 lg:max-w-[1232px] lg:px-4 lg:pt-24 lg:pb-20">
          {clubDesktop ? (
            <RecruiterRoles
              data={myRoles}
              layout="desktop"
              subtitle={profile?.full_name ? `${profile.full_name} · your roles` : 'Your roles'}
              onPostRole={() => { setEditingRole(null); setTemplateRole(null); setShowCreateModal(true) }}
              onEditRole={(role: ClubRole) => { setTemplateRole(null); setEditingRole(role); setShowCreateModal(true) }}
              onPostAgainRole={(role: ClubRole) => { setEditingRole(null); setTemplateRole(role); setShowCreateModal(true) }}
            />
          ) : (
          <>
          {/* Phone header (Figma Opportunities v2): large title, one filters
              button, a search pill, and Open roles | Applied. */}
          {isPhone && (
          <div>
            <LargeTitleBar
              title="Opportunities"
              trailing={showMyRoles ? (
                // Recruiting coach · My roles: the mascot beside Post a role, as for clubs (handoff S1).
                <span className="flex items-center gap-1">
                  <HockiaAiButton onClick={openAi} />
                  <IconButton label="Post a role" onClick={() => { setEditingRole(null); setTemplateRole(null); setShowCreateModal(true) }}>
                    <Plus className="h-6 w-6" strokeWidth={2} />
                  </IconButton>
                </span>
              ) : user ? (
                /* Hockia AI header button (Figma B1 178:26); Filters moved to the first quick chip. */
                <span className="relative mr-1">
                  <HockiaAiButton onClick={openAi} />
                  {aiTip && (
                    <button type="button" onClick={() => setAiTip(false)} className="absolute right-0 top-full z-20 mt-2 whitespace-nowrap rounded-[12px] bg-ink-1 px-3 py-2 text-[13px] font-semibold text-white shadow-lg" data-testid="hockia-ai-tip">
                      New: ask Hockia AI anything
                    </button>
                  )}
                </span>
              ) : (
                <IconButton label="Filters" onClick={() => setFiltersOpen(true)}>
                  <span className="relative">
                    <SlidersHorizontal className="h-6 w-6" strokeWidth={1.8} />
                    {activeRoleFilterCount > 0 && <span aria-hidden="true" className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-hockia-primary ring-2 ring-white" />}
                  </span>
                </IconButton>
              )}
            />
            {user && profile?.role === 'coach' && (
              /* Coach v2 (Figma D6.2 / D6.4): Roles · Applied · My roles — the
                 last one only for a coach who recruits for their team. */
              <div className="px-5 pb-3">
                <SegmentedControl<'roles' | 'applied' | 'mine'>
                  ariaLabel="Roles"
                  value={showMyRoles ? 'mine' : 'roles'}
                  onChange={(v) => {
                    if (v === 'applied') navigate('/opportunities/applications', { state: { from: '/opportunities' } })
                    else setCoachView(v)
                  }}
                  options={[
                    { value: 'roles', label: 'Roles' },
                    { value: 'applied', label: 'Applied', count: userApplications.length },
                    ...(recruitingCoach ? [{ value: 'mine' as const, label: 'My roles', count: myOpenRoleCount }] : []),
                  ]}
                />
              </div>
            )}
            {candidateCoach && !isLoading && !fetchError && (
              <p className="px-5 pb-2.5 text-secondary text-ink-2" data-testid="coach-roles-open-line">{coachingRolesOpenLine(phoneBase.length)}</p>
            )}
            {user && profile?.role === 'player' && (
              <div className="px-5 pb-3">
                <SegmentedControl<'open' | 'applied'>
                  ariaLabel="Roles"
                  value="open"
                  onChange={(v) => { if (v === 'applied') navigate('/opportunities/applications', { state: { from: '/opportunities' } }) }}
                  options={[
                    { value: 'open', label: 'Open roles', count: mobileList.length },
                    { value: 'applied', label: 'Applied', count: userApplications.length },
                  ]}
                />
              </div>
            )}
            {/* Quick chips (Figma 313:1417): the same filters the sheet edits. */}
            {!showMyRoles && !coachEmpty && (
            <div className="-mt-1 flex gap-2 overflow-x-auto px-5 pb-1 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label="Quick filters" data-testid="opportunity-quick-chips">
              {/* Selected = soft violet (chip ruling 2026-10-05, confirmed by the founder 16 Oct); category chips carry their colour dot, never a fill. */}
              {user && (
                <Chip
                  label={activeRoleFilterCount > 0 ? `Filters · ${activeRoleFilterCount}` : 'Filters'}
                  selected={activeRoleFilterCount > 0}
                  leading={<SlidersHorizontal className="h-4 w-4" strokeWidth={1.8} />}
                  onClick={() => setFiltersOpen(true)}
                  data-testid="phone-filters-chip"
                />
              )}
              {QUICK_CHIPS.map((c) => {
                const family = c.key === 'women' ? 'women' : c.key === 'men' ? 'men' : c.key === 'mixed' ? 'mixed' : null
                return (
                  <Chip
                    key={c.key}
                    label={c.label}
                    selected={isQuickChipOn(roleFilters, c.key)}
                    leading={family ? <span aria-hidden="true" className={`h-2 w-2 rounded-full ${CATEGORY_DOT_CLASSES[family]}`} /> : undefined}
                    onClick={() => { void hapticSelection(); setRoleFilters((f) => toggleQuickChip(f, c.key)) }}
                  />
                )
              })}
            </div>
            )}
          </div>
          )}
          {/* Desktop header (Figma D1 192:770): Display title + "N open roles",
              Open roles | Applied on the right. Clubs and recruiting coaches
              keep "Post Opportunity" until the D3 club roles screen lands. */}
          {!isPhone && (
          <div className="mb-7 flex items-center gap-4" data-testid="opportunities-desktop-header">
            <div className="min-w-0 flex-1">
              <h1 className="text-[34px] font-bold leading-[41px] tracking-[-0.015em] text-ink-1">Opportunities</h1>
              <p className="mt-1 text-[16px] leading-[22px] text-ink-2">
                {isUmpire
                  ? 'See what clubs are looking for across the HOCKIA network.'
                  : isLoading || fetchError
                    ? 'Open roles from clubs and coaches'
                    : `${mobileList.length} open role${mobileList.length === 1 ? '' : 's'} from clubs and coaches`}
              </p>
            </div>
            {user && (profile?.role === 'player' || profile?.role === 'coach') && (
              <div className="shrink-0">
                <SegmentedControl<'open' | 'applied' | 'mine'>
                  ariaLabel="Roles"
                  value={showMyRoles ? 'mine' : 'open'}
                  className="[&_button]:whitespace-nowrap [&_button]:px-4"
                  onChange={(v) => {
                    if (v === 'applied') navigate('/opportunities/applications', { state: { from: '/opportunities' } })
                    else setCoachView(v === 'mine' ? 'mine' : 'roles')
                  }}
                  options={[
                    { value: 'open', label: profile.role === 'coach' ? 'Roles' : 'Open roles', count: mobileList.length },
                    { value: 'applied', label: 'Applied', count: userApplications.length },
                    ...(recruitingCoach ? [{ value: 'mine' as const, label: 'My roles', count: myOpenRoleCount }] : []),
                  ]}
                />
              </div>
            )}
            {user && <HockiaAiButton onClick={openAi} />}
            {canPostOpportunity && !showMyRoles && (
              <Button
                onClick={() => { setEditingRole(null); setTemplateRole(null); setShowCreateModal(true) }}
                className="flex-shrink-0 inline-flex items-center gap-1.5 bg-gradient-to-r from-hockia-primary to-hockia-secondary hover:opacity-90"
              >
                <Plus className="w-4 h-4" />
                Post a role
              </Button>
            )}
          </div>
          )}

          {/* Umpire read-only notice — opportunities are player/coach roster
              listings today, so Apply is hidden for umpires. Kept low-key so
              it informs without blocking the browsing experience. */}
          {isUmpire && (
            <div className="mx-5 mb-6 flex items-start gap-3 rounded-xl bg-surface-grouped border border-line px-4 py-3 lg:mx-0">
              <Shield className="w-5 h-5 text-ink-2 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-ink-1">
                <p className="font-medium">Browse-only for umpires right now</p>
                <p className="text-ink-2 mt-0.5">
                  Opportunities here are player and coach roster openings.
                  You can see what clubs are building, but Apply is hidden.
                  Umpire appointments and assessments will live here when we open them.
                </p>
              </div>
            </div>
          )}

          {/* Desktop filters (Figma D1 192:784): Filters opens the sheet as a
              floating dialog; the quick chips are the phone ones (selected =
              soft violet). Deep-link filters (?role, ?position, ?applied=mine…)
              keep working and show a clear chip. */}
          {!isPhone && !coachEmpty && !showMyRoles && (
          <div className="mb-9 flex flex-wrap items-center gap-2" role="group" aria-label="Filters" data-testid="opportunity-desktop-chips">
            <Chip
              label="Filters"
              selected={activeRoleFilterCount > 0}
              leading={<SlidersHorizontal className="h-4 w-4" strokeWidth={1.8} />}
              onClick={() => setFiltersOpen(true)}
              data-testid="desktop-filters"
            />
            {QUICK_CHIPS.map((c) => {
              const family = c.key === 'women' ? 'women' : c.key === 'men' ? 'men' : c.key === 'mixed' ? 'mixed' : null
              return (
                <Chip
                  key={c.key}
                  label={c.label}
                  selected={isQuickChipOn(roleFilters, c.key)}
                  leading={family ? <span aria-hidden="true" className={`h-2 w-2 rounded-full ${CATEGORY_DOT_CLASSES[family]}`} /> : undefined}
                  onClick={() => setRoleFilters((f) => toggleQuickChip(f, c.key))}
                />
              )
            })}
            {filters.applied === 'mine' && (
              <Chip label="My applications ×" selected onClick={() => setFilters((prev) => ({ ...prev, applied: 'all' }))} aria-label="Clear the my-applications filter" />
            )}
            {hasActiveFilters && (
              <button type="button" onClick={clearFilters} className="ml-1 text-[14px] font-semibold leading-[19px] text-ink-2 hover:text-brand-primary">Clear filters</button>
            )}
          </div>
          )}

          {showMyRoles && profile ? (
            <Suspense fallback={<div className="min-h-[40vh]" />}>
              <CoachMyRoles
                profile={profile}
                data={myRoles}
                layout={isPhone ? 'phone' : 'desktop'}
                onPostRole={() => { setEditingRole(null); setTemplateRole(null); setShowCreateModal(true) }}
                onEditRole={(role: ClubRole) => { setTemplateRole(null); setEditingRole(role); setShowCreateModal(true) }}
                onPostAgainRole={(role: ClubRole) => { setEditingRole(null); setTemplateRole(role); setShowCreateModal(true) }}
              />
            </Suspense>
          ) : coachEmpty && isPhone ? (
            <CoachRolesEmptyState
              postedThisYear={coachHistory.postedThisYear}
              recentlyClosed={coachHistory.recentlyClosed}
              ownStatuses={applicationStatuses}
              careerEntryCount={profile?.career_entry_count ?? 0}
              acceptedReferenceCount={profile?.accepted_reference_count ?? 0}
              alertsOn={settings.read('notify_opportunities', true)}
              alertsBusy={settings.busy === 'notify_opportunities'}
              onToggleAlerts={() => void settings.toggle('notify_opportunities', true)}
              onAddCareer={() => navigate('/dashboard/profile/journey')}
              onAskReference={() => navigate('/dashboard/profile/references')}
              onOpenRole={(id) => navigate(`/opportunities/${id}`, navState('opportunities'))}
            />
          ) : (
          <>
          {/* New opportunities banner */}
          {opportunityCount > 0 && (
            <div className="mx-5 mb-6 flex flex-col gap-3 rounded-xl border border-hockia-primary/10 bg-hockia-primary/5 p-4 text-gray-900 sm:flex-row sm:items-center sm:justify-between lg:mx-0">
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
            <div className="columns-1 gap-4 px-5 md:columns-2 lg:px-0">
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
                        <>
              {/* Phone (Figma O1): featured role → themed rails → all open roles. Tap → detail; Apply → sheet. */}
              {isPhone && (
              <div>
              {featured && (() => {
                const d = describeRole(featured)
                return (
                  <div className="px-5 pt-3">
                    <FeaturedRoleCard vacancy={featured} clubName={d.identity.displayName} clubLogo={d.identity.displayLogo} countryFlag={d.flag} league={d.league} palette={d.palette} onOpen={() => navigate(`/opportunities/${featured.id}`, navState('opportunities'))} />
                  </div>
                )
              })()}
              {rails.map((rail) => (
                <RoleRail key={rail.key} title={rail.title} subtitle={rail.subtitle} onSeeAll={() => seeAll(rail.key)} testId={`rail-${rail.key}`}>
                  {rail.roles.map((v) => {
                    const d = describeRole(v)
                    return <RailCard key={v.id} data={{ vacancy: v, clubName: d.identity.displayName, clubLogo: d.identity.displayLogo, palette: d.palette }} countryName={v.location_country?.trim() || null} onOpen={() => navigate(`/opportunities/${v.id}`, navState('opportunities'))} />
                  })}
                </RoleRail>
              ))}
              {structured && mobileList.length > 0 && (
                <div ref={allRolesRef} className="flex items-end px-5 pb-3 pt-7 [scroll-margin-top:12px]">
                  <h2 className="flex-1 text-title text-ink-1">All open roles</h2>
                  <span className="text-[14px] font-semibold leading-[19px] text-brand-primary">{sort === 'deadline' ? 'Closing soon' : 'Newest'}</span>
                </div>
              )}
              <div className="flex flex-col gap-3 px-5">
                {mobileList.length === 0 && (
                  <div className="py-10 text-center">
                    <p className="text-row font-semibold text-ink-1">No roles match these filters</p>
                    <button type="button" onClick={() => setRoleFilters(EMPTY_ROLE_FILTERS)} className="mt-2 text-row font-semibold text-hockia-primary">Reset filters</button>
                  </div>
                )}
                {mobileList.map((vacancy) => {
                  const { identity, flag, league } = describeRole(vacancy)
                  return (
                    <RoleCard
                      key={vacancy.id}
                      vacancy={vacancy}
                      clubName={identity.displayName}
                      clubLogo={identity.displayLogo}
                      publisherRole={identity.hiringClub ? 'club' : 'coach'}
                      postedBy={identity.kind === 'coach-for-club' && identity.postedBy ? { name: identity.postedBy.name, avatar: identity.postedBy.avatar, roleLabel: identity.postedBy.roleLabel } : null}
                      countryFlag={flag}
                      league={league}
                      applied={userApplications.includes(vacancy.id)}
                      onOpen={() => navigate(`/opportunities/${vacancy.id}`, navState('opportunities'))}
                    />
                  )
                })}
              </div>
              </div>
              )}
              {/* Desktop (Figma D1 192:755): wide featured → paged rails → All open roles in 3 columns (2 at 1024–1199). */}
              {!isPhone && (
              <div className="flex flex-col gap-9" data-testid="opportunities-desktop">
                {featured && (() => {
                  const d = describeRole(featured)
                  return <FeaturedRoleCard layout="wide" vacancy={featured} clubName={d.identity.displayName} clubLogo={d.identity.displayLogo} countryFlag={d.flag} league={d.league} palette={d.palette} onOpen={() => navigate(`/opportunities/${featured.id}`, navState('opportunities'))} />
                })()}
                {rails.map((rail) => (
                  <RoleRailDesktop
                    key={rail.key}
                    title={rail.title}
                    subtitle={rail.subtitle}
                    onSeeAll={() => seeAll(rail.key)}
                    testId={`rail-${rail.key}`}
                    cards={rail.roles.map((v) => {
                      const d = describeRole(v)
                      return <RailCard key={v.id} fluid data={{ vacancy: v, clubName: d.identity.displayName, clubLogo: d.identity.displayLogo, palette: d.palette }} countryName={v.location_country?.trim() || null} onOpen={() => navigate(`/opportunities/${v.id}`, navState('opportunities'))} />
                    })}
                  />
                ))}
                <div ref={allRolesRef} className="[scroll-margin-top:96px]">
                  {structured && mobileList.length > 0 && (
                    <div className="flex items-end pb-3.5">
                      <h2 className="flex-1 text-title text-ink-1">All open roles</h2>
                      <span className="text-[14px] font-semibold leading-[19px] text-brand-primary">{sort === 'deadline' ? 'Closing soon' : 'Newest'}</span>
                    </div>
                  )}
                  {mobileList.length === 0 ? (
                    <div className="rounded-[24px] bg-white py-12 text-center">
                      <p className="text-row font-semibold text-ink-1">No roles match these filters</p>
                      <button type="button" onClick={() => setRoleFilters(EMPTY_ROLE_FILTERS)} className="mt-2 text-row font-semibold text-hockia-primary hover:underline">Reset filters</button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-4 min-[1200px]:grid-cols-3">
                      {mobileList.map((vacancy) => {
                        const { identity, flag, league } = describeRole(vacancy)
                        return (
                          <RoleCard
                            key={vacancy.id}
                            vacancy={vacancy}
                            clubName={identity.displayName}
                            clubLogo={identity.displayLogo}
                            publisherRole={identity.hiringClub ? 'club' : 'coach'}
                            postedBy={identity.kind === 'coach-for-club' && identity.postedBy ? { name: identity.postedBy.name, avatar: identity.postedBy.avatar, roleLabel: identity.postedBy.roleLabel } : null}
                            countryFlag={flag}
                            league={league}
                            applied={userApplications.includes(vacancy.id)}
                            onOpen={() => navigate(`/opportunities/${vacancy.id}`, navState('opportunities'))}
                          />
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
              )}
            </>
          )}
          </>
          )}
          </>
          )}
        </main>
      </div>

      <OpportunityFiltersSheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        value={roleFilters}
        onApply={setRoleFilters}
        countFor={(draft) => applyRoleFilters(phoneBase, draft, viewerIsEuEligible).length}
        passportHint={passportHint}
      />

      {/* Create Opportunity — launched directly from the feed for clubs
          and recruiter-coaches, so posting doesn't require a dashboard
          detour. Refetches the feed on success so the new opportunity
          appears immediately. */}
      {showCreateModal && (
        <CreateOpportunityModal
          isOpen={showCreateModal}
          editingVacancy={editingRole}
          templateVacancy={templateRole}
          onClose={() => { setShowCreateModal(false); setEditingRole(null); setTemplateRole(null) }}
          onSuccess={() => {
            setShowCreateModal(false)
            setEditingRole(null)
            setTemplateRole(null)
            fetchVacancies({ skipCache: true })
            myRoles.refresh()
          }}
        />
      )}

    </>
  )
}
