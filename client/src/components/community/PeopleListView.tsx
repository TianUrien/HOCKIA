/**
 * PeopleListView
 * 
 * The People mode view for the Community page.
 * Displays a searchable, filterable member directory.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Loader2 } from 'lucide-react'
import { useNavigationType } from 'react-router-dom'
import RecruiterCandidateCard from '@/components/recruiting/RecruiterCandidateCard'
import { logger } from '@/lib/logger'
import { isAuthExpiredError } from '@/lib/sentryHelpers'
import { isOpenToAny } from '@/lib/hockeyCategories'
import { MemberTileSkeleton } from '@/components/Skeleton'
import { MemberPreviewModal } from './MemberPreviewModal'
import { CandidatePreviewSheet } from '@/components/recruiting/CandidatePreviewSheet'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { computeClubFit } from '@/lib/clubFit'
import { isOpenToAvailability } from '@/lib/availabilityLabel'
import { computeCoachFit } from '@/lib/coachFit'
import { computeEvidence } from '@/lib/evidence'
import { computeInterest } from '@/lib/interestFit'
import { computeRecruiterVerdict, type RecruiterVerdict } from '@/lib/recruiterVerdict'
import {
  useActiveRecruitingTarget, useActiveRecruitingTargetRole, useActiveRecruitingTargetPosition,
  useActiveRecruitingEuRequired, useActiveRecruitingTargetSpecialists,
  useActiveRecruitingTargetLocation, useActiveRecruitingTargetStartDate,
  useActiveRecruitingTargetLevel, useActiveRecruitingTargetCompensation,
  useHasActiveRecruitingScope, useActiveRecruitingTargetProblem,
  useActiveRecruitingMustHaves,
} from '@/hooks/useRecruitingContext'
import { useCountries, isEuCountryCode } from '@/hooks/useCountries'
import { isEuEligible } from '@/lib/euEligibility'
import { expandCountryEquivalents } from '@/lib/countryEquivalents'
import { categoryToBandTarget } from '@/hooks/useInterest'
import { requestCache } from '@/lib/requestCache'
import { monitor } from '@/lib/monitor'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { usePageState } from '@/hooks/usePageState'
import { useScrollRestore } from '@/hooks/useScrollRestore'
import { prefetchWorldClubLogos, getClubLevelBand } from '@/hooks/useWorldClubLogo'
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
  // Denormalised brand engagement counts (on the brands row) — power the
  // unified card's neutral substance line ("N ambassadors · N followers").
  brand_follower_count?: number | null
  brand_ambassador_count?: number | null
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
  // Phase 2 (2b') — dedicated umpire availability flag (drives the card chip).
  available_for_appointments?: boolean | null
}

const PROFILES_SELECT =
  'id, avatar_url, full_name, role, nationality, nationality_country_id, nationality2_country_id, base_location, position, secondary_position, current_club, current_world_club_id, gender, playing_category, coaching_categories, umpiring_categories, created_at, is_test_account, open_to_play, open_to_coach, open_to_opportunities, last_active_at, accepted_reference_count, coach_specialization, coach_specialization_custom, base_country_id, relocation_willingness, relocation_countries_open, relocation_countries_excluded, available_from, level_target, opportunity_preference, specialist_skills, highlight_video_url, full_game_video_count, bio, club_bio, year_founded, website, career_entry_count, accepted_friend_count, is_verified, verified_at, umpire_level, federation, umpire_since, officiating_specialization, languages, last_officiated_at, umpire_appointment_count, available_for_appointments, profile_completeness_pct'

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
  /** Count of players-with-video in the current pool — drives "Has video (N)". */
  onVideoCountChange?: (n: number) => void
  /** True when an active recruiting scope is reshaping the grid (the
   *  focused, role-hard-filtered view — NOT the "Show everyone" escape).
   *  Phase 2D: gates the EU-eligibility hard filter so it applies only in
   *  the scoped view and is lifted the moment the user widens to everyone. */
  scopeReshaping?: boolean
}

/** Player has at least one video proof signal (highlight or full-game). */
const hasVideoMember = (m: Profile) =>
  !!m.highlight_video_url || (m.full_game_video_count ?? 0) > 0

/** Reuse the Proven-lens evidence model (lib/evidence.ts) for the evidence sort
 *  + the "Enough evidence or more" toggle — one source of truth, hockey-weighted. */
const memberEvidence = (m: Profile) =>
  computeEvidence({
    role: m.role,
    highlight_video_url: m.highlight_video_url ?? null,
    full_game_video_count: m.full_game_video_count ?? null,
    accepted_reference_count: m.accepted_reference_count ?? null,
    is_verified: m.is_verified ?? null,
    current_world_club_id: m.current_world_club_id ?? null,
  })

export function PeopleListView({ roleFilter, state, onTotalCountChange, onFilteredCountChange, onVideoCountChange, scopeReshaping = false }: PeopleListViewProps) {
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
  // Interested-lens + verdict scope inputs — the same values ScoutingCard and
  // useInterest read, so the grid card's verdict matches the profile's exactly.
  const contextTargetLocation = useActiveRecruitingTargetLocation()
  const contextTargetStartDate = useActiveRecruitingTargetStartDate()
  const contextTargetLevel = useActiveRecruitingTargetLevel()
  const contextTargetCompensation = useActiveRecruitingTargetCompensation()
  const hasOpeningScope = useHasActiveRecruitingScope()
  const contextProblem = useActiveRecruitingTargetProblem()
  // Phase 2D — EU eligibility hard filter. When the active scope's linked
  // opportunity requires an EU passport, candidates whose declared
  // nationality is non-EU drop out of the scoped grid. Candidates with NO
  // nationality on file are KEPT (missing data never hides someone — same
  // philosophy as opportunityEligibility.ts). Only applies while the scope
  // is reshaping the grid; widening to "Show everyone" lifts it.
  const euRequired = useActiveRecruitingEuRequired()
  // Phase 3 — per-criterion MUST-HAVE flags off the active scope. Threaded
  // into the same computeClubFit / computeInterest options the verdict reads,
  // so a must-have miss reads "Out of scope" identically here and on the
  // profile. A fit-side miss (position/specialist) also sinks the candidate
  // in the grid ranking (the sort floors a clubFit hard fail); interest-side
  // misses still read "Out of scope" on the card even though the score-only
  // sort doesn't model the Interested lens.
  const contextMustHaves = useActiveRecruitingMustHaves()
  const { countries, getCountryById } = useCountries()
  const euCountryIds = useMemo(
    () => new Set(countries.filter((c) => isEuCountryCode(c.code)).map((c) => c.id)),
    [countries],
  )
  const euFilterActive = scopeReshaping && euRequired

  const [baseMembers, setBaseMembers] = useState<Profile[]>([])
  const [allMembers, setAllMembers] = useState<Profile[]>([])
  const [displayedMembers, setDisplayedMembers] = useState<Profile[]>([])
  const [previewMember, setPreviewMember] = useState<Profile | null>(null)
  // For recruiter candidate evaluation: track the member + their match score for the lightweight preview sheet
  const [candidatePreview, setCandidatePreview] = useState<{ member: Profile } | null>(null)
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
    // Logged-out browse: anon viewers count too. The anon RLS policy
    // ("Anon can view active onboarded profiles") scopes the head query to
    // onboarded, non-test rows — same shape authenticated viewers get.
    if (authLoading) return
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
    // Phase 5 — server-side hard filtering via community_search_members. The
    // structured drawer filters (role + the toggle/select filters) run SERVER
    // side, so the result is the WHOLE filtered pool (cap 500, fit-neutral
    // created_at DESC) — lifting the old "filter the newest 200 client-side"
    // ceiling. Free-text search + city stay client narrowers; filteredMembers
    // re-applies the drawer predicates idempotently (defensive parity). Test-
    // account visibility is decided server-side by is_staging_env().
    // Unset filters are `undefined` (omitted from the request body), not
    // `null`: every param has a SQL DEFAULT NULL so omission is semantically
    // identical, and the current supabase CLI generates RPC args as
    // optional-without-null, so explicit nulls no longer typecheck.
    const rpcParams = {
      p_role: filters.role === 'all' ? undefined : filters.role,
      p_positions: filters.position.length ? filters.position : undefined,
      p_coach_specializations: filters.coachSpecializations.length ? filters.coachSpecializations : undefined,
      p_categories: filters.categories.length ? filters.categories : undefined,
      p_officiating_specializations: filters.officiatingSpecializations.length ? filters.officiatingSpecializations : undefined,
      p_nationality_country_ids: filters.nationalityCountryIds.length ? filters.nationalityCountryIds : undefined,
      p_eu_required: (filters.euOnly || euFilterActive) ? true : undefined,
      p_location_country_ids: filters.locationCountryIds.length ? filters.locationCountryIds : undefined,
      p_availability_open: filters.availability === 'open' ? true : undefined,
      p_brand_category: filters.brandCategory || undefined,
      p_open_opportunity_type: filters.clubOpportunityType ?? undefined,
      p_limit: 500,
    }
    const cacheKey = `community-members-${viewerScope}-${JSON.stringify(rpcParams)}`

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
          const { data, error } = await supabase.rpc('community_search_members', rpcParams)
          if (error) throw error
          const payload = (data ?? {}) as unknown as { results?: Profile[] }
          const members = payload.results ?? []

          // Resolve brand slugs + completion fields for brand cards
          const brandIds = members.filter(m => m.role === 'brand').map(m => m.id)
          if (brandIds.length > 0) {
            const { data: brands } = await supabase
              .from('brands')
              .select('profile_id, slug, category, country_id, bio, website_url, instagram_url, logo_url, follower_count, ambassador_count')
              .in('profile_id', brandIds)
            if (brands) {
              const brandMap = new Map(
                (brands as { profile_id: string; slug: string; category: string; country_id: number | null; bio: string | null; website_url: string | null; instagram_url: string | null; logo_url: string | null; follower_count: number | null; ambassador_count: number | null }[]).map(
                  (b) => [b.profile_id, b]
                )
              )
              members.forEach(m => {
                if (m.role === 'brand') {
                  const brand = brandMap.get(m.id)
                  m.brand_slug = brand?.slug || null
                  m.brand_category = brand?.category || null
                  // Brands store location on brands.country_id, not profiles.base_country_id.
                  // Map it across so the Location (country) filter works for brands too.
                  // Mirror the RPC's COALESCE(profile, brand) — profile location wins.
                  if (m.base_country_id == null && typeof brand?.country_id === 'number') m.base_country_id = brand.country_id
                  m.brand_bio = brand?.bio || null
                  m.brand_website_url = brand?.website_url || null
                  m.brand_instagram_url = brand?.instagram_url || null
                  m.brand_logo_url = brand?.logo_url || null
                  m.brand_follower_count = brand?.follower_count ?? null
                  m.brand_ambassador_count = brand?.ambassador_count ?? null
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
      // already warm). Includes the VIEWER's OWN club so Club Fit's
      // competition_proximity has the recruiter's league band to compare
      // against (without this the viewer band is null → that 40% component
      // scores 0 for every candidate).
      const worldClubIds = [
        ...members.map(m => m.current_world_club_id),
        useAuthStore.getState().profile?.current_world_club_id ?? null,
      ].filter((id): id is string => !!id)
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
  }, [viewerScope, filters.role, filters.position, filters.coachSpecializations, filters.categories,
      filters.officiatingSpecializations, filters.nationalityCountryIds, filters.euOnly,
      filters.locationCountryIds, filters.availability, filters.brandCategory, filters.clubOpportunityType, euFilterActive])

  // Role sync moved to CommunityPage (it owns the filter state now).

  // Initial load — gated on authLoading so we don't fire as 'anon'
  // and then immediately re-fire as 'std' once the profile resolves.
  // Anon viewers DO load (logged-out community browse): the fetch runs in
  // the 'anon' viewerScope and the anon RLS policy + column grants return
  // the public, neutral-ranked member set (no recruiter fit — viewerCtx is
  // only built when currentUserProfile is present).
  useEffect(() => {
    if (authLoading) {
      setIsLoading(false)
      return
    }
    fetchMembers()
  }, [authLoading, fetchMembers])

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
                .select('profile_id, slug, category, bio, website_url, instagram_url, logo_url, follower_count, ambassador_count')
                .in('profile_id', brandIds)
              if (brands) {
                const brandMap = new Map(
                  (brands as { profile_id: string; slug: string; category: string; bio: string | null; website_url: string | null; instagram_url: string | null; logo_url: string | null; follower_count: number | null; ambassador_count: number | null }[]).map(
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
                    m.brand_follower_count = brand?.follower_count ?? null
                    m.brand_ambassador_count = brand?.ambassador_count ?? null
                  }
                })
              }
            }

            return members
          },
          20000 // 20 second cache for searches
        )

        // Batch-prefetch world club logos BEFORE rendering (same pattern as
        // fetchMembers) — includes the viewer's own club for Club Fit proximity.
        const worldClubIds = [
          ...members.map(m => m.current_world_club_id),
          useAuthStore.getState().profile?.current_world_club_id ?? null,
        ].filter((id): id is string => !!id)
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
    if (filters.coachSpecializations.length > 0) {
      // Coach-role filter matches coach_specialization (NOT position — a coach
      // has no `position`, so the old position-based coaching filter dropped
      // every coach).
      result = result.filter(m =>
        m.role === 'coach' && !!m.coach_specialization &&
        filters.coachSpecializations.includes(m.coach_specialization)
      )
    }
    if (filters.categories.length > 0) {
      // Multi-select (any-of): player playing_category in set; coach/umpire
      // category arrays overlap the set (or the 'any' sentinel). Club + brand
      // have no category → excluded when a category filter is active.
      const targets = new Set<string>(filters.categories)
      result = result.filter((m) => {
        if (m.role === 'player') return !!m.playing_category && targets.has(m.playing_category)
        if (m.role === 'coach') {
          return isOpenToAny(m.coaching_categories) ||
            (Array.isArray(m.coaching_categories) && m.coaching_categories.some((c) => targets.has(c)))
        }
        if (m.role === 'umpire') {
          return isOpenToAny(m.umpiring_categories) ||
            (Array.isArray(m.umpiring_categories) && m.umpiring_categories.some((c) => targets.has(c)))
        }
        return false
      })
    }
    if (filters.officiatingSpecializations.length > 0) {
      result = result.filter(m =>
        m.role === 'umpire' && !!m.officiating_specialization &&
        filters.officiatingSpecializations.includes(m.officiating_specialization)
      )
    }
    if (filters.locationCountryIds.length > 0) {
      // Structured base_country_id match, OR (recall fallback) the country name
      // appearing in the free-text base_location — so legacy members whose
      // base_country_id was never set still surface when their location text
      // names the country (e.g. "Sydney, Australia").
      // Expand GB <-> England the same way the server RPC does
      // (expand_country_equivalents), so this defensive re-filter never drops
      // England-coded members when "United Kingdom" is selected (or vice versa).
      const locIds = expandCountryEquivalents(filters.locationCountryIds, countries)
      const idSet = new Set(locIds)
      // Use the stable `countries` list (not getCountryById, which is recreated
      // each render and would force this memo to recompute every render).
      const names = countries
        .filter((c) => idSet.has(c.id))
        .flatMap((c) => [c.name, c.common_name].filter((n): n is string => Boolean(n)))
        .map((n) => n.toLowerCase())
      result = result.filter(m =>
        (typeof m.base_country_id === 'number' && idSet.has(m.base_country_id)) ||
        (!!m.base_location && names.some((n) => m.base_location!.toLowerCase().includes(n)))
      )
    }
    if (filters.location.trim()) {
      const loc = filters.location.toLowerCase()
      result = result.filter(m => m.base_location?.toLowerCase().includes(loc))
    }
    if (filters.nationalityCountryIds.length > 0) {
      // Dual-aware: match EITHER primary or secondary nationality FK. The old
      // freetext demonym match was primary-only and missed every dual national.
      // Expand GB <-> England to match the server RPC (expand_country_equivalents).
      const natIds = expandCountryEquivalents(filters.nationalityCountryIds, countries)
      result = result.filter(m =>
        (typeof m.nationality_country_id === 'number' && natIds.includes(m.nationality_country_id)) ||
        (typeof m.nationality2_country_id === 'number' && natIds.includes(m.nationality2_country_id))
      )
    }
    if (filters.availability === 'open') {
      // Role-complete "open" filter — players (open_to_play), coaches
      // (open_to_coach), umpires (available_for_appointments), brands/clubs
      // (open_to_opportunities). Single source: availabilityLabel helper.
      result = result.filter(m => isOpenToAvailability(m.role, m))
    }

    // Phase 2D — EU eligibility HARD filter. When the active scope requires
    // an EU passport (eu_required, derived from the opportunity), drop
    // candidates whose declared nationality is verifiably non-EU. A
    // candidate is kept when EITHER nationality is an EU member state, OR
    // they have no nationality on file at all (incomplete profile is never
    // a reason to hide someone — mirrors opportunityEligibility.ts). Gated
    // on euFilterActive so it only bites in the focused scoped view.
    // EU eligibility — OR-combine the scope-driven hard filter (euFilterActive =
    // scopeReshaping && euRequired) with the user-facing "EU-eligible only"
    // toggle, so the toggle works WITH OR WITHOUT an active recruiter scope.
    // One implementation (isEuEligible) → the two can never disagree.
    if (euFilterActive || filters.euOnly) {
      result = result.filter((m) => isEuEligible(m.nationality_country_id, m.nationality2_country_id, euCountryIds))
    }
    if (filters.hasVideo) {
      result = result.filter(hasVideoMember)
    }
    if (filters.evidenceEnoughOnly) {
      // Opt-in narrow to Strong/Enough evidence (the existing weighted model).
      result = result.filter((m) => {
        const lvl = memberEvidence(m).level
        return lvl === 'strong' || lvl === 'moderate'
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
    if (sort === 'evidence') {
      // Strongest evidence first (the weighted Proven-lens score), with
      // completeness then id as stable tiebreakers.
      result = [...result].sort((a, b) => {
        const as = memberEvidence(a).score
        const bs = memberEvidence(b).score
        if (bs !== as) return bs - as
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
    // it. ANY active coach scope ranks coaches by Coach Fit (no specific role
    // required — computeCoachFit falls back to category + track record when
    // the scope names no specialization, mirroring the player path).
    const useCoachContextFit =
      applyContextFit && contextTargetRole === 'coach'
    if (sort === 'newest' && currentUserProfile && (useContextFit || useCoachContextFit)) {
      const viewerCtx = {
        role: currentUserProfile.role,
        womens_league_division: (currentUserProfile as { womens_league_division?: string | null }).womens_league_division ?? null,
        mens_league_division: (currentUserProfile as { mens_league_division?: string | null }).mens_league_division ?? null,
        current_world_club_id: currentUserProfile.current_world_club_id ?? null,
        // Viewer's own league band (scope-targeted) so competition_proximity can compare.
        competition_level_band: getClubLevelBand(currentUserProfile.current_world_club_id ?? null, contextTarget),
      }
      // In context-fit mode, pass the context target + role through so
      // the score (and the role gate that suppresses player-fit for
      // coach-seeking contexts) matches exactly what the Fit chips show.
      const fitOptions = useContextFit
        ? {
            overrideTarget: contextTarget,
            targetRole: contextTargetRole,
            targetPosition: contextTargetPosition,
            targetSpecialists: contextTargetSpecialists,
            positionRequired: contextMustHaves.position,
            specialistsRequired: contextMustHaves.specialists,
          }
        : undefined
      result = [...result]
        .map((m) => {
          // Coach candidates under a coach scope are ranked by Coach Fit;
          // everyone else by Club Fit (NOT_APPLICABLE → 0).
          let score: number
          if (useCoachContextFit && m.role === 'coach') {
            score = computeCoachFit(viewerCtx, {
              id: m.id,
              role: m.role,
              coach_specialization: m.coach_specialization ?? null,
              coaching_categories: m.coaching_categories ?? null,
            }, {
              overrideTarget: contextTarget,
              targetRole: contextTargetRole,
              targetSpecialization: contextTargetPosition,
            }).score
          } else {
            const fit = computeClubFit(viewerCtx, {
              id: m.id,
              role: m.role,
              playing_category: m.playing_category ?? null,
              current_world_club_id: m.current_world_club_id ?? null,
              // Resolve the candidate's league band too, so the SORT ranks on the
              // same Club Fit input the verdict card displays (matchById already does).
              competition_level_band: getClubLevelBand(m.current_world_club_id ?? null, categoryToBandTarget(m.playing_category ?? null)),
              open_to_play: m.open_to_play ?? null,
              open_to_coach: m.open_to_coach ?? null,
              open_to_opportunities: m.open_to_opportunities ?? null,
              last_active_at: m.last_active_at ?? null,
              position: m.position ?? null,
              secondary_position: m.secondary_position ?? null,
              specialist_skills: m.specialist_skills ?? null,
            }, fitOptions)
            // A must-have hard fail OR a confirmed soft mismatch (wrong
            // position/category) forces grey — "Out of scope" / "Lower fit" on
            // the card — but leaves the soft score high (gender/league/
            // availability still count). Demote BOTH so the ranking can't float
            // a doesn't-fit candidate above genuine in-scope ones: a hard fail to
            // the floor, a soft grey just below every non-grey fit. Keeps the
            // grid order consistent with its own verdict card (which caps a grey
            // fit at "Possible"). Without the grey demotion, the exact Arquera
            // bug recurs in the RANKING: a "Possible" wrong-position midfielder
            // (soft score still ~0.75) out-ranks the real goalkeeper the
            // recruiter wants. NOT_APPLICABLE (no signal, score 0) is left as-is —
            // only a CONFIRMED applicable mismatch is demoted.
            score = fit.hardFail
              ? -1
              : fit.isApplicable && fit.state === 'grey'
                ? fit.score - 1
                : fit.score
          }
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
  }, [allMembers, filters, sort, currentUserProfile, applyContextFit, contextTarget, contextTargetRole, contextTargetPosition, contextTargetSpecialists, contextMustHaves, euFilterActive, euCountryIds, countries])

  // Recruiter Match is "active" only while an active scope ranks PLAYERS by
  // fit — a coach scope ranks coaches, so the player match bar stays off.
  const playerMatchActive =
    applyContextFit && !!contextTarget && contextTargetRole !== 'coach'

  // Interested-lens scope options — shared by the player + coach verdict
  // builders. Identical to what useInterest injects, so the grid card's
  // verdict matches the profile's (ScoutingCard) exactly.
  const interestScopeOptions = useMemo(
    () => ({
      targetRole: contextTargetRole,
      targetLocationCountry: contextTargetLocation,
      targetStartDate: contextTargetStartDate,
      targetLevel: contextTargetLevel,
      targetCompensation: contextTargetCompensation,
      countryName: (id: number) => getCountryById(id)?.name,
      levelRequired: contextMustHaves.level,
      compensationRequired: contextMustHaves.compensation,
      locationRequired: contextMustHaves.location,
      availabilityRequired: contextMustHaves.availability,
    }),
    [contextTargetRole, contextTargetLocation, contextTargetStartDate, contextTargetLevel, contextTargetCompensation, contextMustHaves, getCountryById],
  )

  // The FULL recruiter verdict per scoped player — the same explanation-led
  // synthesis (Fit + Proven + Interested + recruitment problem) the profile's
  // RecruiterVerdictCard leads with. Computed once here from the already-
  // fetched row (pure, no extra fetch) so the grid card, the preview, and the
  // full profile all read the SAME tier — fixing the "Strong match 70%" on the
  // grid vs "Longshot" on the profile contradiction.
  const matchById = useMemo(() => {
    const map = new Map<string, { verdict: RecruiterVerdict }>()
    if (!playerMatchActive || !currentUserProfile) return map
    const viewerCtx = {
      role: currentUserProfile.role,
      womens_league_division: (currentUserProfile as { womens_league_division?: string | null }).womens_league_division ?? null,
      mens_league_division: (currentUserProfile as { mens_league_division?: string | null }).mens_league_division ?? null,
      current_world_club_id: currentUserProfile.current_world_club_id ?? null,
      // Viewer's own league band (scope-targeted) so competition_proximity can compare.
      competition_level_band: getClubLevelBand(currentUserProfile.current_world_club_id ?? null, contextTarget),
    }
    const fitOptions = {
      overrideTarget: contextTarget,
      targetRole: contextTargetRole,
      targetPosition: contextTargetPosition,
      targetSpecialists: contextTargetSpecialists,
      positionRequired: contextMustHaves.position,
      specialistsRequired: contextMustHaves.specialists,
    }
    filteredMembers
      .filter((m) => m.role === 'player')
      .forEach((m) => {
        const provenBand = getClubLevelBand(m.current_world_club_id ?? null, categoryToBandTarget(m.playing_category ?? null))
        const fit = computeClubFit(viewerCtx, {
          id: m.id,
          role: m.role,
          playing_category: m.playing_category ?? null,
          current_world_club_id: m.current_world_club_id ?? null,
          competition_level_band: provenBand,
          open_to_play: m.open_to_play ?? null,
          open_to_coach: m.open_to_coach ?? null,
          open_to_opportunities: m.open_to_opportunities ?? null,
          last_active_at: m.last_active_at ?? null,
          position: m.position ?? null,
          secondary_position: m.secondary_position ?? null,
          specialist_skills: m.specialist_skills ?? null,
        }, fitOptions)
        if (!fit.isApplicable) return
        const evidence = computeEvidence({
          role: m.role,
          highlight_video_url: m.highlight_video_url ?? null,
          full_game_video_count: m.full_game_video_count ?? null,
          accepted_reference_count: m.accepted_reference_count ?? null,
          is_verified: m.is_verified ?? null,
          current_world_club_id: m.current_world_club_id ?? null,
        })
        const interest = computeInterest({
          role: m.role,
          relocation_willingness: m.relocation_willingness ?? null,
          relocation_countries_open: m.relocation_countries_open ?? null,
          relocation_countries_excluded: m.relocation_countries_excluded ?? null,
          available_from: m.available_from ?? null,
          home_country_id: m.base_country_id ?? m.nationality_country_id ?? null,
          proven_level_band: provenBand,
          level_target: m.level_target ?? null,
          opportunity_preference: m.opportunity_preference ?? null,
        }, interestScopeOptions)
        const verdict = computeRecruiterVerdict({
          fit, evidence, interest,
          hasOpeningScope,
          problem: contextProblem,
          candidateRole: 'player',
        })
        if (verdict.isApplicable) map.set(m.id, { verdict })
      })
    return map
  }, [playerMatchActive, currentUserProfile, filteredMembers, contextTarget, contextTargetRole, contextTargetPosition, contextTargetSpecialists, contextMustHaves, interestScopeOptions, hasOpeningScope, contextProblem])

  // Coach equivalent of playerMatchActive — ANY active COACH scope ranks
  // coaches by Coach Fit, so the recruiter card renders for coaches just like
  // players. When the scope names a specific coaching role (target_position
  // carries the coach enum) it drives specialization match; when it doesn't,
  // computeCoachFit falls back to a neutral fit on category + track record so
  // coaches still get a verdict (no longer gated on a sought role).
  const coachMatchActive =
    applyContextFit && contextTargetRole === 'coach'

  // The FULL recruiter verdict per scoped coach — same synthesis as the
  // player path (Coach Fit + Proven evidence + Interested), so coach cards
  // read the SAME tier as the coach profile. evidence.ts + interestFit.ts
  // already adapt to coaches (no video; coach-appropriate intent).
  const coachMatchById = useMemo(() => {
    const map = new Map<string, { verdict: RecruiterVerdict }>()
    if (!coachMatchActive || !currentUserProfile) return map
    const viewerCtx = {
      role: currentUserProfile.role,
      womens_league_division: (currentUserProfile as { womens_league_division?: string | null }).womens_league_division ?? null,
      mens_league_division: (currentUserProfile as { mens_league_division?: string | null }).mens_league_division ?? null,
      current_world_club_id: currentUserProfile.current_world_club_id ?? null,
    }
    const fitOptions = {
      overrideTarget: contextTarget,
      targetRole: contextTargetRole,
      targetSpecialization: contextTargetPosition,
    }
    filteredMembers
      .filter((m) => m.role === 'coach')
      .forEach((m) => {
        const fit = computeCoachFit(viewerCtx, {
          id: m.id,
          role: m.role,
          coach_specialization: m.coach_specialization ?? null,
          coaching_categories: m.coaching_categories ?? null,
        }, fitOptions)
        if (!fit.isApplicable) return
        const evidence = computeEvidence({
          role: m.role,
          highlight_video_url: m.highlight_video_url ?? null,
          full_game_video_count: m.full_game_video_count ?? null,
          accepted_reference_count: m.accepted_reference_count ?? null,
          is_verified: m.is_verified ?? null,
          current_world_club_id: m.current_world_club_id ?? null,
        })
        const provenBand = getClubLevelBand(m.current_world_club_id ?? null, categoryToBandTarget(m.playing_category ?? null))
        const interest = computeInterest({
          role: m.role,
          relocation_willingness: m.relocation_willingness ?? null,
          relocation_countries_open: m.relocation_countries_open ?? null,
          relocation_countries_excluded: m.relocation_countries_excluded ?? null,
          available_from: m.available_from ?? null,
          home_country_id: m.base_country_id ?? m.nationality_country_id ?? null,
          proven_level_band: provenBand,
          level_target: m.level_target ?? null,
          opportunity_preference: m.opportunity_preference ?? null,
        }, interestScopeOptions)
        const verdict = computeRecruiterVerdict({
          fit, evidence, interest,
          hasOpeningScope,
          problem: contextProblem,
          candidateRole: 'coach',
        })
        if (verdict.isApplicable) map.set(m.id, { verdict })
      })
    return map
  }, [coachMatchActive, currentUserProfile, filteredMembers, contextTarget, contextTargetRole, contextTargetPosition, interestScopeOptions, hasOpeningScope, contextProblem])

  // Emit filtered count upward whenever it changes. Combined with the
  // total-count effect this lets the parent choose: total when not
  // narrowing, filtered when narrowing.
  useEffect(() => {
    onFilteredCountChange?.(filteredMembers.length)
  }, [filteredMembers.length, onFilteredCountChange])

  // Count of players-with-video in the current pool. filteredMembers.filter is
  // idempotent here: when the toggle is OFF it counts the video subset of the
  // (otherwise-filtered) results; when ON, filteredMembers is already the video
  // set, so the count equals what's shown — a stable "Has video (N)" either way.
  useEffect(() => {
    onVideoCountChange?.(filteredMembers.filter(hasVideoMember).length)
  }, [filteredMembers, onVideoCountChange])

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
          gender: filters.categories.length > 0 ? filters.categories.join(',') : null,
          location: filters.location.trim() || (filters.locationCountryIds.length > 0 ? filters.locationCountryIds.join(',') : null),
          nationality: filters.nationalityCountryIds.length > 0 ? filters.nationalityCountryIds.join(',') : null,
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

  // Logged-out browse: anon viewers see the SAME member grid (read-only).
  // Discovery is intentionally not blocked here — every ACTION (save,
  // message, friend, apply) is gated downstream by a SignInPromptModal.

  // Two distinct loading shapes:
  //   - First load (no cards yet)  → full skeleton grid. Unavoidable; there
  //     is genuinely nothing to show.
  //   - Reshape (cards already on screen, a scope/role/sort change is
  //     re-fetching) → keep the EXISTING cards mounted, gently dim them and
  //     float an "Updating matches…" pill. This is the fix for the choppy
  //     "page disappears and reappears" feel when applying a recruiting
  //     context: the grid never blanks to skeletons mid-interaction, it
  //     just crossfades to the re-ranked result.
  // "Busy" covers every transition (fetch, server search, auth settle) so the
  // "No members found" empty state only renders once genuinely settled — never
  // as a flash while a re-fetch is in flight (e.g. right after clearing a
  // recruiting scope, which re-fetches under a new role filter).
  const isBusy = isLoading || isSearching || authLoading
  const showSkeletons = isBusy && displayedMembers.length === 0
  const isReshaping = isLoading && displayedMembers.length > 0

  return (
    <div>
      {/* Subtle, fixed "Updating matches…" pill — visible during a reshape
          even if the user has scrolled. Auto-hides the instant new data
          lands. Replaces the old hard skeleton flash. */}
      {isReshaping && (
        <div className="pointer-events-none fixed left-1/2 top-20 z-30 -translate-x-1/2 animate-fade-in">
          <span className="inline-flex items-center gap-2 rounded-full border border-hockia-primary/20 bg-white/95 px-4 py-2 text-xs font-medium text-gray-700 shadow-lg backdrop-blur">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-hockia-primary" />
            Updating matches…
          </span>
        </div>
      )}
      {showSkeletons ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
          {[...Array(15)].map((_, i) => (
            <MemberTileSkeleton key={i} />
          ))}
        </div>
      ) : (!isBusy && displayedMembers.length === 0) ? (
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
              className="px-6 py-2 rounded-lg bg-gradient-to-r from-hockia-primary to-hockia-secondary text-white font-medium hover:opacity-90 transition-opacity"
            >
              Clear Filters
            </button>
          )}
        </div>
      ) : (
        <>
          <div className={[
            (playerMatchActive || coachMatchActive)
              ? 'grid grid-cols-2 auto-rows-fr gap-2.5 sm:gap-3 mb-6 sm:mb-8'
              // No-context grid: auto-rows-fr makes every tile in a row the
              // same length. The tile's key rows (avatar → name → role →
              // nationality) stay top-aligned and its footer is pinned to the
              // bottom (mt-auto), so cards match length AND line up.
              : 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 auto-rows-fr gap-3 sm:gap-4 mb-6 sm:mb-8',
            // Crossfade during a reshape: dim the outgoing cards while the
            // re-ranked set loads, then fade back to full opacity. No blank
            // skeleton swap, so the page never visually resets.
            'transition-opacity duration-300 ease-out',
            isReshaping ? 'opacity-40' : 'opacity-100',
          ].join(' ')}>
            {displayedMembers.map((member, i) => {
              // Scoped recruiter view → the premium evaluation card for the
              // candidates the active scope ranks (players under a player
              // scope, coaches under a coach scope); everyone else keeps the
              // compact tile. The card is role-agnostic; only the score
              // source differs (Club Fit vs Coach Fit).
              const md = matchById.get(member.id)
              if (playerMatchActive && member.role === 'player' && md) {
                return (
                  <RecruiterCandidateCard
                    key={member.id}
                    member={member}
                    verdict={md.verdict}
                    onPreview={() => setCandidatePreview({ member })}
                    priority={i < 4}
                  />
                )
              }
              const cmd = coachMatchById.get(member.id)
              if (coachMatchActive && member.role === 'coach' && cmd) {
                return (
                  <RecruiterCandidateCard
                    key={member.id}
                    member={member}
                    verdict={cmd.verdict}
                    onPreview={() => setCandidatePreview({ member })}
                    priority={i < 4}
                  />
                )
              }
              // NEUTRAL mode — the SAME unified card, no recruiting scope.
              // Opens the general member preview (the scoped branches above
              // open the recruiter CandidatePreviewSheet instead).
              return (
                <RecruiterCandidateCard
                  key={member.id}
                  member={member}
                  onPreview={() => setPreviewMember(member)}
                  priority={i < 4}
                />
              )
            })}
          </div>

          {/* Infinite scroll sentinel */}
          {hasMore && <div ref={sentinelRef} className="h-1" />}
          {hasMore && (
            <div className="flex justify-center py-6">
              <Loader2 className="w-6 h-6 text-hockia-primary animate-spin" />
            </div>
          )}
        </>
      )}

      <MemberPreviewModal
        member={previewMember}
        onClose={() => setPreviewMember(null)}
      />

      <CandidatePreviewSheet
        member={candidatePreview?.member ?? null}
        onClose={() => setCandidatePreview(null)}
      />
    </div>
  )
}
