import { useCallback, useMemo, useState } from 'react'
import { usePageState } from '@/hooks/usePageState'
import type { PlayingCategory } from '@/lib/hockeyCategories'

/**
 * Shared community-filter state extracted from PeopleListView so the
 * search bar, quick filters, and filters drawer can live ABOVE the
 * Top Community Members carousel in CommunityPage (May 2026 redesign).
 * Both surfaces consume the same hook return value via prop drilling,
 * not by both calling the hook independently — that way there's one
 * source of truth and React's render cycle stays clean.
 */

export type RoleFilter = 'all' | 'player' | 'coach' | 'club' | 'brand' | 'umpire'

/**
 * Member-type options — the single source of truth for both the visible role
 * chips and the "Member type" section inside the Filters drawer. Both write the
 * SAME state by navigating to the role's URL (the URL → filters.role is the one
 * source of truth), so the two affordances can never diverge.
 */
export const MEMBER_TYPES: { role: RoleFilter; label: string; path: string }[] = [
  { role: 'all', label: 'All', path: '/community' },
  { role: 'player', label: 'Players', path: '/community/players' },
  { role: 'coach', label: 'Coaches', path: '/community/coaches' },
  { role: 'club', label: 'Clubs', path: '/community/clubs' },
  { role: 'umpire', label: 'Umpires', path: '/community/umpires' },
  { role: 'brand', label: 'Brands', path: '/community/brands' },
]

export function roleToPath(role: RoleFilter): string {
  return MEMBER_TYPES.find((m) => m.role === role)?.path ?? '/community'
}

export type AvailabilityFilter = 'all' | 'open'

export type SortOption = 'newest' | 'completeness' | 'evidence'

export interface CommunityFilters {
  role: RoleFilter
  position: string[]
  /** Coach specialization filter (coach role only) — matches coach_specialization.
   * Distinct from `position`: the old drawer matched coaching role against the
   * player `position` column, which a coach never has → it filtered everyone out. */
  coachSpecializations: string[]
  /** Hockey category filter (multi-select; empty = all). Routed to
   * playing_category for player rows (any-of), and array-overlap (or 'any'
   * sentinel) for coach + umpire rows. Skipped entirely for club + brand.
   * Player UI is single-select (writes a 1-element array); coach/umpire UI is
   * multi-select chips (their categories are arrays — a coach can hold several). */
  categories: PlayingCategory[]
  /** Umpire officiating type — matches officiating_specialization (outdoor /
   * indoor / both). Umpire role only. */
  officiatingSpecializations: string[]
  /** Free-text city/region match on base_location (kept as a secondary narrower). */
  location: string
  /** Structured location match on base_country_id (the "country" half of the
   * old "City or country" placeholder, which the freetext never honoured). */
  locationCountryIds: number[]
  /** Dual-aware nationality match on nationality_country_id OR
   * nationality2_country_id. Replaces the old freetext demonym substring, which
   * was primary-only and FK-blind (missed every secondary nationality). */
  nationalityCountryIds: number[]
  /** User-facing "EU-eligible only" — keeps members with >=1 EU nationality
   * (derived, dual-aware, keep-unknown via isEuEligible). OR-combines with the
   * scope-driven EU hard-filter; works with or without an active recruiter scope. */
  euOnly: boolean
  /** Player-only "Has video" narrow — highlight_video_url OR full_game_video_count>0.
   * Coverage is thin, so the drawer ships it default-off + count-labelled. */
  hasVideo: boolean
  /** Player/coach "Enough evidence or more" — opt-in narrow to candidates whose
   * weighted evidence (lib/evidence.ts computeEvidence) is Strong or Enough.
   * Reuses the existing Proven-lens model; never the default (keep-unknown). */
  evidenceEnoughOnly: boolean
  availability: AvailabilityFilter
  brandCategory: string | null
}

export const defaultFilters = (role: RoleFilter = 'all'): CommunityFilters => ({
  role,
  position: [],
  coachSpecializations: [],
  categories: [],
  officiatingSpecializations: [],
  location: '',
  locationCountryIds: [],
  nationalityCountryIds: [],
  euOnly: false,
  hasVideo: false,
  evidenceEnoughOnly: false,
  availability: 'all',
  brandCategory: null,
})

export interface CommunityFiltersState {
  searchQuery: string
  setSearchQuery: (value: string) => void
  filters: CommunityFilters
  updateFilter: <K extends keyof CommunityFilters>(key: K, value: CommunityFilters[K]) => void
  clearFilters: () => void
  togglePosition: (position: string) => void
  showFilters: boolean
  setShowFilters: (open: boolean) => void
  sort: SortOption
  setSort: (value: SortOption) => void
  /** Explicit opt-in: when ON and the recruiter has an active recruiting
   *  context, the members grid is sorted best-fit-first FOR THAT CONTEXT
   *  (everyone stays visible — sort, never hide). Off by default so a
   *  context never silently re-orders the grid. */
  applyContextFit: boolean
  setApplyContextFit: (value: boolean) => void
  /** Has the user narrowed beyond the chip-driven role? */
  hasActiveFilters: boolean
  /** Search query OR any active filter — drives the carousel hide. */
  isNarrowed: boolean
}

export function useCommunityFiltersState(
  roleFilter: RoleFilter | undefined,
  initialSearchQuery = '',
): CommunityFiltersState {
  // searchQuery uses plain useState (not usePageState) because the URL
  // ?q= param is now the source of truth — CommunityPage wires the URL
  // ↔ input sync. Two sources of truth (sessionStorage + URL) racing
  // on first mount was the QA-flagged "?q= deep-link doesn't hydrate"
  // bug. The initial value comes from the URL via the caller; later
  // changes propagate to the URL via CommunityPage's sync effect.
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery)
  const [filters, setFilters] = usePageState<CommunityFilters>(
    'community-filters',
    defaultFilters(roleFilter ?? 'all'),
  )
  // showFilters + sort use plain useState (not usePageState) so they
  // persist across chip-driven route changes within the same Community
  // session. usePageState is keyed by location.key — a user who picks
  // "Profile completeness" sort would otherwise see it reset to
  // "Newest" the moment they tap a chip. Both reset on full page
  // reload, which is acceptable.
  const [showFilters, setShowFilters] = useState(false)
  const [sort, setSort] = useState<SortOption>('newest')
  // Off by default — context-fit re-ordering is strictly opt-in (the
  // recruiter ticks "Apply context to this list"). Plain useState so it
  // survives chip-driven route changes within a session, same rationale
  // as sort/showFilters above.
  const [applyContextFit, setApplyContextFit] = useState(false)

  const updateFilter = useCallback(<K extends keyof CommunityFilters>(key: K, value: CommunityFilters[K]) => {
    setFilters((prev) => {
      const next = { ...prev, [key]: value }
      if (key === 'role') {
        next.position = []
        next.coachSpecializations = []
        next.categories = []
        next.officiatingSpecializations = []
        next.hasVideo = false
        next.evidenceEnoughOnly = false
        if (value !== 'brand') next.brandCategory = null
      }
      return next
    })
  }, [setFilters])

  const togglePosition = useCallback((position: string) => {
    setFilters((prev) => ({
      ...prev,
      position: prev.position.includes(position)
        ? prev.position.filter((p) => p !== position)
        : [...prev.position, position],
    }))
  }, [setFilters])

  const clearFilters = useCallback(() => {
    setFilters(defaultFilters(roleFilter ?? 'all'))
    setSearchQuery('')
  }, [roleFilter, setFilters, setSearchQuery])

  const hasActiveFilters = useMemo(() => {
    const expectedRole = roleFilter ?? 'all'
    return (
      filters.role !== expectedRole ||
      filters.brandCategory !== null ||
      filters.position.length > 0 ||
      filters.coachSpecializations.length > 0 ||
      filters.categories.length > 0 ||
      filters.officiatingSpecializations.length > 0 ||
      filters.location.trim() !== '' ||
      filters.locationCountryIds.length > 0 ||
      filters.nationalityCountryIds.length > 0 ||
      filters.euOnly ||
      filters.hasVideo ||
      filters.evidenceEnoughOnly ||
      filters.availability !== 'all'
    )
  }, [filters, roleFilter])

  const isNarrowed = useMemo(
    () => searchQuery.trim().length > 0 || hasActiveFilters,
    [searchQuery, hasActiveFilters],
  )

  return {
    searchQuery,
    setSearchQuery,
    filters,
    updateFilter,
    clearFilters,
    togglePosition,
    showFilters,
    setShowFilters,
    sort,
    setSort,
    applyContextFit,
    setApplyContextFit,
    hasActiveFilters,
    isNarrowed,
  }
}
