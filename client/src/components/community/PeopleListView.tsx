/**
 * PeopleListView
 * 
 * The People mode view for the Community page.
 * Displays a searchable, filterable member directory.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { useNavigationType, Link } from 'react-router-dom'
import { MemberTile } from '@/components'
import RecruiterCandidateCard from '@/components/recruiting/RecruiterCandidateCard'
import { logger } from '@/lib/logger'
import { isAuthExpiredError } from '@/lib/sentryHelpers'
import { isOpenToAny } from '@/lib/hockeyCategories'
import { MemberTileSkeleton } from '@/components/Skeleton'
import { MemberPreviewModal } from './MemberPreviewModal'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { computeClubFit, type ClubFitState } from '@/lib/clubFit'
import { computeCoachFit } from '@/lib/coachFit'
import { useActiveRecruitingTarget, useActiveRecruitingTargetRole, useActiveRecruitingTargetPosition, useActiveRecruitingEuRequired, useActiveRecruitingTargetSpecialists } from '@/hooks/useRecruitingContext'
import { useCountries, isEuCountryCode } from '@/hooks/useCountries'
import { requestCache } from '@/lib/requestCache'
import { monitor } from '@/lib/monitor'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { usePageState } from '@/hooks/usePageState'
import { useScrollRestore } from '@/hooks/useScrollRestore'
import { prefetchWorldClubLogos } from '@/hooks/useWorldClubLogo'
import { getMemberTier } from '@/lib/profileTier'
import { logSearchAppearances } from '@/lib/searchAppearances'
import type { CommunityFiltersState } from './communityFilters'

export interface Profile {
  id: string
  avatar_url: string | null
  full_name: string
  role: 'player' | 'coach' | 'club' | 'brand' | 'umpire'
  nationality: string | null
  nationality_country_id: number | null
  nationality2_country_id: number | null
  base_location: string | null
  position: string | null
  secondary_position: string | null
  current_club: string | null
  current_world_club_id: string | null
  gender: string | null
  // Phase 3 hockey categories — drives the community category filter.
  playing_category: string | null
  coaching_categories: string[] | null
  umpiring_categories: string[] | null
  created_at: string
  is_test_account?: boolean
  open_to_play?: boolean
  open_to_coach?: boolean
  open_to_opportunities?: boolean
  last_active_at?: string | null
  accepted_reference_count?: number
  coach_specialization?: string | null
  coach_specialization_custom?: string | null
  // Matching Increment #2.2 — candidate intent for the Interested lens.
  base_country_id?: number | null
  relocation_willingness?: string | null
  relocation_countries_open?: number[] | null
  relocation_countries_excluded?: number[] | null
  available_from?: string | null
  // Self-declared intent (#2.1) — fed to the Interested lens level +
  // compensation alignment (#4b).
  level_target?: string | null
  opportunity_preference?: string | null
  // Increment #3.2 — player specialist tags for the Fit-lens role match.
  specialist_skills?: string[] | null
  brand_slug?: string | null
  brand_category?: string | null
  // Extra fields used to compute profile-complete pill (cheap, on the profile row or brand join)
  highlight_video_url?: string | null
  // Increment #1 (Proven lens) — count of full-match videos on the row.
  full_game_video_count?: number | null
  bio?: string | null
  club_bio?: string | null
  year_founded?: number | null
  website?: string | null
  contact_email?: string | null
  career_entry_count?: number | null
  accepted_friend_count?: number | null
  // Server-computed completeness 0-100. Drives both the Top Members
  // ranking and the per-card badge on the grid.
  profile_completeness_pct?: number | null
  brand_bio?: string | null
  brand_website_url?: string | null
  brand_instagram_url?: string | null
  brand_logo_url?: string | null
  // Admin-granted verified badge — unified on profiles for every role.
  is_verified?: boolean | null
  verified_at?: string | null
  // Umpire-only fields (on profiles row; gated by DB chk_umpire_fields_role)
  umpire_level?: string | null
  federation?: string | null
  umpire_since?: number | null
  officiating_specialization?: string | null
  languages?: string[] | null
  last_officiated_at?: string | null
  umpire_appointment_count?: number | null
}

const PROFILES_SELECT =
  'id, avatar_url, full_name, role, nationality, nationality_country_id, nationality2_country_id, base_location, position, secondary_position, current_club, current_world_club_id, gender, playing_category, coaching_categories, umpiring_categories, created_at, is_test_account, open_to_play, open_to_coach, open_to_opportunities, last_active_at, accepted_reference_count, coach_specialization, coach_specialization_custom, base_country_id, relocation_willingness, relocation_countries_open, relocation_countries_excluded, available_from, level_target, opportunity_preference, specialist_skills, highlight_video_url, full_game_video_count, bio, club_bio, year_founded, website, contact_email, career_entry_count, accepted_friend_count, is_verified, verified_at, umpire_level, federation, umpire_since, officiating_specialization, languages, last_officiated_at, umpire_appointment_count, profile_completeness_pct'

// CommunityFilters type moved to ./communityFilters.ts so the lifted
// search bar / quick filters / drawer (now rendered by CommunityPage)
// and this grid can share one source of truth via a single hook
// instance passed in via the `state` prop.
//
// Brand categories + position constants live in CommunityFiltersDrawer
// alongside the UI that uses them.

interface PeopleListViewProps {
  roleFilter?: 'player' | 'coach' | 'club' | 'brand' | 'umpire'
  /** Filter state lifted to CommunityPage (May 2026 redesign) so the
   *  search bar, quick filters, and drawer can live ABOVE the Top
   *  Community Members carousel. This component is now a presentational
   *  grid that reads state from props — it no longer owns search,
   *  filters, sort, or shows-filters-drawer state. */
  state: CommunityFiltersState
  /** Fires once after the initial fetch with the total members count
   *  (scoped to role + test-account visibility). CommunityPage uses
   *  this to render "12,458 members" under the All members heading. */
  onTotalCountChange?: (n: number) => void
  /** Fires whenever the filtered list size changes (search + drawer
   *  filters applied). The parent shows this count under the All
   *  members heading WHEN the user is narrowing — otherwise it shows
   *  the total. Fixes the QA-flagged 'badge says 13 but grid shows 1'
   *  desync. */
  onFilteredCountChange?: (n: number) => void
  /** True when an active recruiting scope is reshaping the grid (the
   *  focused, role-hard-filtered view — NOT the "Show everyone" escape).
   *  Phase 2D: gates the EU-eligibility hard filter so it applies only in
   *  the scoped view and is lifted the moment the user widens to everyone. */
  scopeReshaping?: boolean
}

export function PeopleListView({ roleFilter, state, onTotalCountChange, onFilteredCountChange, scopeReshaping = false }: PeopleListViewProps) {
  const navigationType = useNavigationType()
  // `loading` flips false once the auth session + profile resolve.
  // Gating the fetch on it prevents the historical double-fire:
  //   render 1 — profile null → viewerScope='anon' → fetch as anon
  //   render 2 — profile loads → viewerScope='std' → fetch AGAIN
  // The second fetch made Community look like it "loads twice".
  // We now wait for auth to settle so viewerScope is correct on the
  // very first fetch, and re-runs only happen for real filter changes.
  const { profile: currentUserProfile, loading: authLoading } = useAuthStore()
  // QA F5: profiles + count queries are RLS-gated and 401 for anon
  // viewers. Skip both fetches entirely for anon and render a sign-in
  // prompt below instead of letting the error path log to Sentry.
  const isAnon = !authLoading && !currentUserProfile
  const isCurrentUserTestAccount = currentUserProfile?.is_test_account ?? false
  // On staging, test accounts are visible to everyone for QA. When true,
  // the test-account filter below is skipped entirely.
  const hideTestAccounts = !isCurrentUserTestAccount
    && !import.meta.env.VITE_SUPABASE_URL?.includes('ivjkdaylalhsteyyclvl')
  // Cache scope — anon, logged-in test, and logged-in standard viewers
  // each see a different RLS-filtered result set. Keying the request
  // cache on this keeps a logged-in count from leaking into a
  // logged-out view (and vice versa).
  const viewerScope = !currentUserProfile
    ? 'anon'
    : isCurrentUserTestAccount ? 'test' : 'std'

  const { searchQuery, filters, sort, applyContextFit, clearFilters, isNarrowed } = state
  // Active recruiting context (recruiter-only; null otherwise). When the
  // recruiter explicitly opts in via `applyContextFit`, the grid sorts
  // best-fit-first FOR THIS CONTEXT instead of the viewer's own profile
  // target — matching what the per-card Fit chips already show. Nobody
  // is hidden; this only re-orders.
  const contextTarget = useActiveRecruitingTarget()
  const contextTargetRole = useActiveRecruitingTargetRole()
  const contextTargetPosition = useActiveRecruitingTargetPosition()
  const contextTargetSpecialists = useActiveRecruitingTargetSpecialists()
  // Phase 2D — EU eligibility hard filter. When the active scope's linked
  // opportunity requires an EU passport, candidates whose declared
  // nationality is non-EU drop out of the scoped grid. Candidates with NO
  // nationality on file are KEPT (missing data never hides someone — same
  // philosophy as opportunityEligibility.ts). Only applies while the scope
  // is reshaping the grid; widening to "Show everyone" lifts it.
  const euRequired = useActiveRecruitingEuRequired()
  const { countries } = useCountries()
  const euCountryIds = useMemo(
    () => new Set(countries.filter((c) => isEuCountryCode(c.code)).map((c) => c.id)),
    [countries],
  )
  const euFilterActive = scopeReshaping && euRequired

  const [baseMembers, setBaseMembers] = useState<Profile[]>([])
  const [allMembers, setAllMembers] = useState<Profile[]>([])
  const [displayedMembers, setDisplayedMembers] = useState<Profile[]>([])
  const [previewMember, setPreviewMember] = useState<Profile | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSearching, setIsSearching] = useState(false)
  const [page, setPage] = usePageState('community-page', 1)
  const [hasMore, setHasMore] = useState(true)
  const sentinelRef = useRef<HTMLDivElement>(null)

  // Track whether this is a restored (back/forward) navigation
  const isRestoredRef = useRef(navigationType === 'POP')


  // Scroll restoration — waits for data to load before restoring position
  useScrollRestore(!isLoading)

  // Responsive page size — reacts to viewport changes
  const isMobile = useMediaQuery('(max-width: 767px)')
  const pageSize = isMobile ? 12 : 24

  // Total count for the current role + test-visibility scope. Runs
  // once per scope change (cheap head query). Drives the "N members"
  // line under the All members heading in CommunityPage. Gated on
  // authLoading + dedupe-wrapped so a single cold load doesn't fire
  // it twice under StrictMode / Suspense replay.
  useEffect(() => {
    if (authLoading || isAnon) return
    let cancelled = false
    const cacheKey = `community-count-${roleFilter ?? 'all'}-${hideTestAccounts ? 'no-test' : 'all'}`
    const run = async () => {
      try {
        const count = await requestCache.dedupe<number>(
          cacheKey,
          async () => {
            let q = supabase
              .from('profiles')
              .select('id', { count: 'exact', head: true })
              .eq('onboarding_completed', true)
            if (roleFilter) q = q.eq('role', roleFilter)
            if (hideTestAccounts) {
              q = q.or('is_test_account.is.null,is_test_account.eq.false')
            }
            const { count: c, error } = await q
            if (error) throw error
            return c ?? 0
          },
          30000,
        )
        if (cancelled) return
        onTotalCountChange?.(count)
      } catch (err) {
        // 401s during the auth sign-out transition are expected (the
        // in-flight request races against onAuthStateChange clearing
        // the session). Downgrade to debug so it doesn't dominate the
        // console; real errors still surface as ERROR.
        if (isAuthExpiredError(err)) {
          logger.debug('[PeopleListView] total count: session expired mid-fetch (ignored)')
        } else {
          logger.error('Error fetching total community count:', err)
        }
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [authLoading, isAnon, roleFilter, hideTestAccounts, onTotalCountChange])

  // Fetch members from Supabase. Critical: measure() is INSIDE
  // requestCache.dedupe so the module-level dedupe controls whether
  // the measure runs at all. React 18 StrictMode (dev-only) double-
  // invokes effects and React's Suspense/concurrent renderer can
  // replay effects via reconnectPassiveEffects after CommunityPage
  // resumes from its React.lazy boundary — without this structure,
  // each replay triggered its own measure() + setState pair (user
  // saw 2-3 "fetch_community_members" log entries on a single visit).
  // Now: cache HIT → short-circuit via peek (no spinner, no measure);
  // in-flight HIT → dedupe returns existing promise (no fn call, no
  // measure); cache MISS + no in-flight → fn runs once (measure once).
  const fetchMembers = useCallback(async () => {
    const roleKey = roleFilter ?? 'all'
    const cacheKey = `community-members-${viewerScope}-${roleKey}`

    // Fastest path: data already cached at the module level → hand
    // it back synchronously, never touch isLoading or measure.
    const cached = requestCache.peek<Profile[]>(cacheKey)
    if (cached) {
      setBaseMembers(cached)
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    try {
      const members = await requestCache.dedupe(
        cacheKey,
        async () => monitor.measure('fetch_community_members', async () => {
          let query = supabase
            .from('profiles')
            .select(PROFILES_SELECT)
            .eq('onboarding_completed', true) // Only show fully onboarded users

          // Narrow server-side when a role route is active — otherwise the
          // 200-row ceiling silently truncates under-represented roles.
          if (roleFilter) {
            query = query.eq('role', roleFilter)
          }

          // If current user is NOT a test account, exclude test accounts from results
          if (hideTestAccounts) {
            query = query.or('is_test_account.is.null,is_test_account.eq.false')
          }

          const { data, error } = await query
            .order('created_at', { ascending: false })
            .limit(200) // Load reasonable batch for client-side filtering

          if (error) throw error
          const members = ((data || []) as unknown) as Profile[]

          // Resolve brand slugs + completion fields for brand cards
          const brandIds = members.filter(m => m.role === 'brand').map(m => m.id)
          if (brandIds.length > 0) {
            const { data: brands } = await supabase
              .from('brands')
              .select('profile_id, slug, category, bio, website_url, instagram_url, logo_url')
              .in('profile_id', brandIds)
            if (brands) {
              const brandMap = new Map(
                (brands as { profile_id: string; slug: string; category: string; bio: string | null; website_url: string | null; instagram_url: string | null; logo_url: string | null }[]).map(
                  (b) => [b.profile_id, b]
                )
              )
              members.forEach(m => {
                if (m.role === 'brand') {
                  const brand = brandMap.get(m.id)
                  m.brand_slug = brand?.slug || null
                  m.brand_category = brand?.category || null
                  m.brand_bio = brand?.bio || null
                  m.brand_website_url = brand?.website_url || null
                  m.brand_instagram_url = brand?.instagram_url || null
                  m.brand_logo_url = brand?.logo_url || null
                }
              })
            }
          }

          return members
        }),
        30000 // 30 second cache for community members
      )

      // Batch-prefetch world club logos BEFORE rendering to avoid N+1
      // queries in MemberCard. Runs on cache hits too (cheap if
      // already warm).
      const worldClubIds = members
        .map(m => m.current_world_club_id)
        .filter((id): id is string => !!id)
      if (worldClubIds.length > 0) {
        await prefetchWorldClubLogos(worldClubIds)
      }

      setBaseMembers(members)
      // INTENTIONAL: do NOT setAllMembers(members) here. The post-
      // render effect below ([searchQuery, clientFilteredMembers, …])
      // is the single writer for allMembers. Setting it from
      // fetchMembers caused a race on hard-load with ?q= deep links:
      // fetchMembers' setAllMembers([13]) won the race against the
      // effect's setAllMembers([1 match]), and the grid stayed
      // unfiltered until the user typed something to re-trigger the
      // chain. (QA "13 members match" + grid shows 13.) The flow
      // is now deterministic: baseMembers is the raw fetch, allMembers
      // is always the search-filtered view derived from it.
      // displayedMembers + hasMore are derived from filteredMembers
      // via the useEffect below.
    } catch (error) {
      if (isAuthExpiredError(error)) {
        logger.debug('[PeopleListView] fetchMembers: session expired mid-fetch (ignored)')
      } else {
        logger.error('Error fetching members:', error)
      }
    } finally {
      setIsLoading(false)
    }
  }, [hideTestAccounts, viewerScope, roleFilter])

  // Role sync moved to CommunityPage (it owns the filter state now).

  // Initial load — gated on authLoading so we don't fire as 'anon'
  // and then immediately re-fire as 'std' once the profile resolves.
  // QA F5: also skip entirely for anon viewers (RLS would 401 the
  // query and the error path logs to Sentry).
  useEffect(() => {
    if (authLoading || isAnon) {
      setIsLoading(false)
      return
    }
    fetchMembers()
  }, [authLoading, isAnon, fetchMembers])

  // Perform server-side search
  const performServerSearch = useCallback(async (query: string) => {
    setIsSearching(true)

    await monitor.measure('search_community_members', async () => {
      // Cache key scoped by test-account status and role route — mirrors
      // fetchMembers so a search on a role-filtered tab (e.g.
      // /community/players) doesn't accidentally surface profiles from
      // other roles.
      const roleKey = roleFilter ?? 'all'
      const cacheKey = `community-search-${viewerScope}-${roleKey}-${query}`

      try {
        const members = await requestCache.dedupe(
          cacheKey,
          async () => {
            const searchTerm = `%${query}%`
            let dbQuery = supabase
              .from('profiles')
              .select(PROFILES_SELECT)
              .eq('onboarding_completed', true) // Only show fully onboarded users
              .or(
                `full_name.ilike.${searchTerm},nationality.ilike.${searchTerm},base_location.ilike.${searchTerm},position.ilike.${searchTerm},secondary_position.ilike.${searchTerm},current_club.ilike.${searchTerm}`
              )

            // Match fetchMembers: narrow server-side by role when a chip-scoped
            // route is active.
            if (roleFilter) {
              dbQuery = dbQuery.eq('role', roleFilter)
            }

            // If current user is NOT a test account, exclude test accounts from results
            if (hideTestAccounts) {
              dbQuery = dbQuery.or('is_test_account.is.null,is_test_account.eq.false')
            }

            const { data, error } = await dbQuery
              .order('created_at', { ascending: false })
              .limit(200)

            if (error) throw error
            const members = ((data || []) as unknown) as Profile[]

            // Resolve brand slugs + completion fields for brand cards
            const brandIds = members.filter(m => m.role === 'brand').map(m => m.id)
            if (brandIds.length > 0) {
              const { data: brands } = await supabase
                .from('brands')
                .select('profile_id, slug, category, bio, website_url, instagram_url, logo_url')
                .in('profile_id', brandIds)
              if (brands) {
                const brandMap = new Map(
                  (brands as { profile_id: string; slug: string; category: string; bio: string | null; website_url: string | null; instagram_url: string | null; logo_url: string | null }[]).map(
                    (b) => [b.profile_id, b]
                  )
                )
                members.forEach(m => {
                  if (m.role === 'brand') {
                    const brand = brandMap.get(m.id)
                    m.brand_slug = brand?.slug || null
                    m.brand_category = brand?.category || null
                    m.brand_bio = brand?.bio || null
                    m.brand_website_url = brand?.website_url || null
                    m.brand_instagram_url = brand?.instagram_url || null
                    m.brand_logo_url = brand?.logo_url || null
                  }
                })
              }
            }

            return members
          },
          20000 // 20 second cache for searches
        )

        // Batch-prefetch world club logos BEFORE rendering (same pattern as fetchMembers)
        const worldClubIds = members
          .map(m => m.current_world_club_id)
          .filter((id): id is string => !!id)
        if (worldClubIds.length > 0) {
          await prefetchWorldClubLogos(worldClubIds)
        }

        setAllMembers(members)
        setPage(1)
        // displayedMembers + hasMore derive from filteredMembers (see useEffect
        // below). Setting them here would clobber the filtered grid when
        // performServerSearch double-fires under StrictMode.
      } catch (error) {
        if (isAuthExpiredError(error)) {
          logger.debug('[PeopleListView] search: session expired mid-fetch (ignored)')
        } else {
          logger.error('Error searching members:', error)
        }
      } finally {
        setIsSearching(false)
      }
    }, { query })
  }, [hideTestAccounts, viewerScope, roleFilter, setPage])

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
    // (the person might exist beyond the initial 200 loaded). Skip
    // entirely for anon — the query would 401.
    if (!isAnon && searchQuery.trim() && clientFilteredMembers.length === 0) {
      const debounceTimer = setTimeout(() => {
        performServerSearch(searchQuery)
      }, 500)
      return () => clearTimeout(debounceTimer)
    }
  }, [isAnon, searchQuery, clientFilteredMembers, performServerSearch])

  // Client-side filtering (all filters)
  const filteredMembers = useMemo(() => {
    let result = allMembers

    if (filters.role !== 'all') {
      result = result.filter(m => m.role === filters.role)
    }
    if (filters.brandCategory) {
      result = result.filter(m => m.role === 'brand' && m.brand_category === filters.brandCategory)
    }
    if (filters.position.length > 0) {
      result = result.filter(m =>
        (m.position && filters.position.includes(m.position.toLowerCase())) ||
        (m.secondary_position && filters.position.includes(m.secondary_position.toLowerCase()))
      )
    }
    if (filters.category !== 'all') {
      const target = filters.category
      result = result.filter((m) => {
        if (m.role === 'player') return m.playing_category === target
        if (m.role === 'coach') {
          return isOpenToAny(m.coaching_categories) ||
            (Array.isArray(m.coaching_categories) && m.coaching_categories.includes(target))
        }
        if (m.role === 'umpire') {
          return isOpenToAny(m.umpiring_categories) ||
            (Array.isArray(m.umpiring_categories) && m.umpiring_categories.includes(target))
        }
        // Club + brand have no category — exclude when a category filter is active.
        return false
      })
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

    // Phase 2D — EU eligibility HARD filter. When the active scope requires
    // an EU passport (eu_required, derived from the opportunity), drop
    // candidates whose declared nationality is verifiably non-EU. A
    // candidate is kept when EITHER nationality is an EU member state, OR
    // they have no nationality on file at all (incomplete profile is never
    // a reason to hide someone — mirrors opportunityEligibility.ts). Gated
    // on euFilterActive so it only bites in the focused scoped view.
    if (euFilterActive) {
      result = result.filter((m) => {
        const ids = [m.nationality_country_id, m.nationality2_country_id]
          .filter((id): id is number => typeof id === 'number')
        if (ids.length === 0) return true // unknown nationality → keep
        return ids.some((id) => euCountryIds.has(id))
      })
    }

    // Sort. 'newest' is the natural fetch order (created_at DESC); no
    // re-sort needed — slicing keeps that order intact. 'completeness'
    // sorts by profile_completeness_pct DESC with id tiebreaker for
    // stable pagination across renders.
    if (sort === 'completeness') {
      result = [...result].sort((a, b) => {
        const ap = a.profile_completeness_pct ?? 0
        const bp = b.profile_completeness_pct ?? 0
        if (bp !== ap) return bp - ap
        return a.id.localeCompare(b.id)
      })
    }

    // Club Fit ranking: re-order by Fit score descending — ONLY when an
    // active recruiting context exists. Fit/match needs a real need to match
    // against, so with no context we leave the chosen sort (newest /
    // completeness) untouched — the list is honestly "newest", not silently
    // fit-ranked. (Mirrors useClubFit gating the per-card fit display.)
    const useContextFit = applyContextFit && !!contextTarget
    // Phase 2C — coach-fit ranking. A coach opportunity carries no gender,
    // so contextTarget (category) is null and the player path won't fire for
    // it. Detect a coach scope that names a specific coaching role and rank
    // coaches by coach fit instead. (Category may be null; coach fit is
    // specialization-first.)
    const useCoachContextFit =
      applyContextFit && contextTargetRole === 'coach' && Boolean(contextTargetPosition)
    if (sort === 'newest' && currentUserProfile && (useContextFit || useCoachContextFit)) {
      const viewerCtx = {
        role: currentUserProfile.role,
        womens_league_division: (currentUserProfile as { womens_league_division?: string | null }).womens_league_division ?? null,
        mens_league_division: (currentUserProfile as { mens_league_division?: string | null }).mens_league_division ?? null,
        current_world_club_id: currentUserProfile.current_world_club_id ?? null,
      }
      // In context-fit mode, pass the context target + role through so
      // the score (and the role gate that suppresses player-fit for
      // coach-seeking contexts) matches exactly what the Fit chips show.
      const fitOptions = useContextFit
        ? { overrideTarget: contextTarget, targetRole: contextTargetRole, targetPosition: contextTargetPosition, targetSpecialists: contextTargetSpecialists }
        : undefined
      result = [...result]
        .map((m) => {
          // Coach candidates under a coach scope are ranked by Coach Fit;
          // everyone else by Club Fit (NOT_APPLICABLE → 0).
          const score =
            useCoachContextFit && m.role === 'coach'
              ? computeCoachFit(viewerCtx, {
                  id: m.id,
                  role: m.role,
                  coach_specialization: m.coach_specialization ?? null,
                  coaching_categories: m.coaching_categories ?? null,
                }, {
                  overrideTarget: contextTarget,
                  targetRole: contextTargetRole,
                  targetSpecialization: contextTargetPosition,
                }).score
              : computeClubFit(viewerCtx, {
                  id: m.id,
                  role: m.role,
                  playing_category: m.playing_category ?? null,
                  current_world_club_id: m.current_world_club_id ?? null,
                  open_to_play: m.open_to_play ?? null,
                  open_to_coach: m.open_to_coach ?? null,
                  open_to_opportunities: m.open_to_opportunities ?? null,
                  last_active_at: m.last_active_at ?? null,
                  position: m.position ?? null,
                  secondary_position: m.secondary_position ?? null,
                  specialist_skills: m.specialist_skills ?? null,
                }, fitOptions).score
          return { m, score }
        })
        .sort((a, b) => {
          // Primary: Fit score descending (NOT_APPLICABLE returns 0).
          if (b.score !== a.score) return b.score - a.score
          // Tiebreaker 1: completeness desc.
          const ap = a.m.profile_completeness_pct ?? 0
          const bp = b.m.profile_completeness_pct ?? 0
          if (bp !== ap) return bp - ap
          // Tiebreaker 2: id for stable pagination.
          return a.m.id.localeCompare(b.m.id)
        })
        .map(({ m }) => m)
    }

    return result
  }, [allMembers, filters, sort, currentUserProfile, applyContextFit, contextTarget, contextTargetRole, contextTargetPosition, contextTargetSpecialists, euFilterActive, euCountryIds])

  // Recruiter Match is "active" only while an active scope ranks PLAYERS by
  // fit — a coach scope ranks coaches, so the player match bar stays off.
  const playerMatchActive =
    applyContextFit && !!contextTarget && contextTargetRole !== 'coach'

  // Real Club Fit score + state per scoped player, fed to the recruiter
  // card (which displays the % and the slider). Computed with the full
  // position/specialist fields so the card's number matches the ranking.
  const matchById = useMemo(() => {
    const map = new Map<string, { score: number; state: ClubFitState }>()
    if (!playerMatchActive || !currentUserProfile) return map
    const viewerCtx = {
      role: currentUserProfile.role,
      womens_league_division: (currentUserProfile as { womens_league_division?: string | null }).womens_league_division ?? null,
      mens_league_division: (currentUserProfile as { mens_league_division?: string | null }).mens_league_division ?? null,
      current_world_club_id: currentUserProfile.current_world_club_id ?? null,
    }
    const fitOptions = {
      overrideTarget: contextTarget,
      targetRole: contextTargetRole,
      targetPosition: contextTargetPosition,
      targetSpecialists: contextTargetSpecialists,
    }
    filteredMembers
      .filter((m) => m.role === 'player')
      .forEach((m) => {
        const r = computeClubFit(viewerCtx, {
          id: m.id,
          role: m.role,
          playing_category: m.playing_category ?? null,
          current_world_club_id: m.current_world_club_id ?? null,
          open_to_play: m.open_to_play ?? null,
          open_to_coach: m.open_to_coach ?? null,
          open_to_opportunities: m.open_to_opportunities ?? null,
          last_active_at: m.last_active_at ?? null,
          position: m.position ?? null,
          secondary_position: m.secondary_position ?? null,
          specialist_skills: m.specialist_skills ?? null,
        }, fitOptions)
        if (r.isApplicable) map.set(m.id, { score: r.score, state: r.state })
      })
    return map
  }, [playerMatchActive, currentUserProfile, filteredMembers, contextTarget, contextTargetRole, contextTargetPosition, contextTargetSpecialists])

  // Emit filtered count upward whenever it changes. Combined with the
  // total-count effect this lets the parent choose: total when not
  // narrowing, filtered when narrowing.
  useEffect(() => {
    onFilteredCountChange?.(filteredMembers.length)
  }, [filteredMembers.length, onFilteredCountChange])

  // Update displayed members when filter (or sort) changes. Sort
  // changes shouldn't truncate to first page — QA flagged that
  // flipping the sort dropdown momentarily hid the 13th card until
  // the user scrolled. Preserve the loaded count across resorts by
  // slicing to `page * pageSize` instead of `pageSize`.
  useEffect(() => {
    if (isRestoredRef.current) {
      const endIndex = page * pageSize
      setDisplayedMembers(filteredMembers.slice(0, endIndex))
      setHasMore(filteredMembers.length > endIndex)
      isRestoredRef.current = false
    } else {
      const endIndex = Math.max(pageSize, page * pageSize)
      setDisplayedMembers(filteredMembers.slice(0, endIndex))
      setHasMore(filteredMembers.length > endIndex)
    }
  }, [filteredMembers, pageSize]) // eslint-disable-line react-hooks/exhaustive-deps

  // Log search appearances when the displayed set is the result of an active
  // search or non-default filter. Debounced and throttled server-side via a
  // unique (viewer, profile, hour) index — cheap to fire often.
  useEffect(() => {
    const viewerId = currentUserProfile?.id
    if (!viewerId) return
    if (isLoading || isSearching) return
    if (displayedMembers.length === 0) return
    if (!isNarrowed) return

    const handle = setTimeout(() => {
      void logSearchAppearances({
        viewerId,
        profileIds: displayedMembers.map((m) => m.id),
        filters: {
          search_query_present: searchQuery.trim().length > 0,
          role: filters.role !== 'all' ? filters.role : null,
          position: filters.position.length > 0 ? filters.position : null,
          gender: filters.category !== 'all' ? filters.category : null,
          location: filters.location.trim() || null,
          nationality: filters.nationality.trim() || null,
          availability: filters.availability !== 'all' ? filters.availability : null,
        },
      })
    }, 800)
    return () => clearTimeout(handle)
  }, [displayedMembers, filters, searchQuery, isLoading, isSearching, currentUserProfile?.id, isNarrowed])

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

  // Search suggestions, filter mutators, hasActiveFilters / isNarrowed
  // all live in the lifted CommunityFiltersState now (state prop).
  // The empty-state CTA below calls state.clearFilters directly.

  // Anon viewers: surface a sign-in prompt instead of letting the
  // empty grid (from the gated-out fetch above) look broken. Profile
  // visibility is auth-gated by RLS; no public browse mode today.
  if (isAnon) {
    return (
      <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
        <div className="w-16 h-16 bg-gradient-to-br from-[#8026FA]/10 to-[#924CEC]/10 rounded-full flex items-center justify-center mx-auto mb-4">
          <span className="text-3xl">👋</span>
        </div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">
          Sign in to browse the HOCKIA community
        </h3>
        <p className="text-gray-500 mb-5 max-w-sm mx-auto">
          Create a free account to discover players, coaches, clubs, brands, and umpires.
        </p>
        <div className="inline-flex items-center gap-2">
          <Link
            to="/signin"
            className="px-5 py-2 rounded-lg bg-gradient-to-r from-[#8026FA] to-[#924CEC] text-white font-medium hover:opacity-90 transition-opacity"
          >
            Sign in
          </Link>
          <Link
            to="/signup"
            className="px-5 py-2 rounded-lg border border-[#8026FA]/30 text-[#8026FA] font-medium hover:bg-[#8026FA]/5 transition-colors"
          >
            Create account
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div>
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
          {[...Array(15)].map((_, i) => (
            <MemberTileSkeleton key={i} />
          ))}
        </div>
      ) : displayedMembers.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span className="text-3xl">🔍</span>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No members found</h3>
          <p className="text-gray-500 mb-4">
            {isNarrowed
              ? 'Try adjusting your search or filters to see more results.'
              : 'No members yet.'}
          </p>
          {isNarrowed && (
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
          <div className={playerMatchActive
            ? 'grid grid-cols-2 auto-rows-fr gap-3 sm:gap-4 mb-6 sm:mb-8'
            // No-context grid: auto-rows-fr makes every tile in a row the
            // same length. The tile's key rows (avatar → name → role →
            // nationality) stay top-aligned and its footer is pinned to the
            // bottom (mt-auto), so cards match length AND line up.
            : 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 auto-rows-fr gap-3 sm:gap-4 mb-6 sm:mb-8'}>
            {displayedMembers.map((member) => {
              // Scoped recruiter view → the premium evaluation card for
              // players we have a match for; everyone else keeps the
              // compact tile.
              const md = matchById.get(member.id)
              if (playerMatchActive && member.role === 'player' && md) {
                return (
                  <RecruiterCandidateCard
                    key={member.id}
                    member={member}
                    matchScore={md.score}
                    matchState={md.state}
                    onPreview={() => setPreviewMember(member)}
                  />
                )
              }
              return (
              <MemberTile
                key={member.id}
                id={member.id}
                avatar_url={member.avatar_url}
                full_name={member.full_name}
                role={member.role}
                brandSlug={member.brand_slug ?? undefined}
                brandCategory={member.brand_category ?? undefined}
                brandLogoUrl={member.brand_logo_url ?? null}
                nationality={member.nationality}
                nationality_country_id={member.nationality_country_id}
                nationality2_country_id={member.role === 'club' ? null : member.nationality2_country_id}
                base_location={member.base_location}
                current_team={member.current_club}
                current_world_club_id={member.current_world_club_id}
                open_to_play={member.open_to_play}
                open_to_coach={member.open_to_coach}
                open_to_opportunities={member.open_to_opportunities}
                playing_category={member.playing_category ?? null}
                coach_specialization={member.coach_specialization ?? null}
                coaching_categories={member.coaching_categories ?? null}
                position={member.position ?? null}
                last_active_at={member.last_active_at ?? null}
                highlight_video_url={member.highlight_video_url ?? null}
                full_game_video_count={member.full_game_video_count ?? null}
                accepted_reference_count={member.accepted_reference_count ?? null}
                career_entry_count={member.career_entry_count ?? null}
                relocation_willingness={member.relocation_willingness ?? null}
                relocation_countries_open={member.relocation_countries_open ?? null}
                relocation_countries_excluded={member.relocation_countries_excluded ?? null}
                available_from={member.available_from ?? null}
                level_target={member.level_target ?? null}
                opportunity_preference={member.opportunity_preference ?? null}
                home_country_id={member.base_country_id ?? member.nationality_country_id ?? null}
                tier={getMemberTier(member)}
                isVerified={Boolean(member.is_verified)}
                verifiedAt={member.verified_at ?? null}
                umpireLevel={member.umpire_level ?? null}
                federation={member.federation ?? null}
                profileCompletenessPct={member.profile_completeness_pct ?? null}
                onPreview={() => setPreviewMember(member)}
              />
              )
            })}
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

      <MemberPreviewModal
        member={previewMember}
        onClose={() => setPreviewMember(null)}
      />
    </div>
  )
}
