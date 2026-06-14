/**
 * CommunityPage
 *
 * Container page for the Community section with two tabs:
 * - Members: Unified directory of players, coaches, clubs, umpires,
 *   and brands. (Brands re-introduced as a role filter in the May 2026
 *   QA pass; /marketplace still exists for the products + featured-
 *   brand surface, but the directory filter view lives here.)
 * - Questions: Q&A for sharing knowledge
 *
 * The May 2026 layout pass moved the search bar and quick filters
 * ABOVE the Top Community Members carousel so they're a primary
 * action. Filter state is owned here (lifted out of PeopleListView)
 * so the carousel can react to narrowing and the search/drawer can
 * sit above it cleanly.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { Search, Filter, Loader2, Sparkles } from 'lucide-react'
import { Header } from '@/components'
import { PullToRefresh } from '@/components/PullToRefresh'
import {
  CommunityTabSwitcher,
  CommunityRoleChips,
  PeopleListView,
  QuestionsListView,
} from '@/components/community'
import { TopCommunityMembersCarousel } from '@/components/community/TopCommunityMembersCarousel'
import { CommunityFiltersDrawer } from '@/components/community/CommunityFiltersDrawer'
import {
  useCommunityFiltersState,
  type SortOption,
} from '@/components/community/communityFilters'
import type { CommunityTab } from '@/components/community'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useAuthStore } from '@/lib/auth'
import {
  deriveTargetCategory,
  playingCategoriesForTarget,
} from '@/lib/recruitingContext'
import { useActiveRecruitingTarget, useActiveRecruitingTargetRole } from '@/hooks/useRecruitingContext'
import ContextSwitcher from '@/components/recruiting/ContextSwitcher'
import CoachContextNudge from '@/components/recruiting/CoachContextNudge'

const VALID_TABS: CommunityTab[] = ['all', 'players', 'coaches', 'clubs', 'umpires', 'brands', 'questions']

const TITLE_BY_TAB: Record<CommunityTab, string> = {
  all: 'Community',
  players: 'Players',
  coaches: 'Coaches',
  clubs: 'Clubs',
  umpires: 'Umpires',
  brands: 'Brands',
  questions: 'Questions',
}

const ROLE_FILTER_BY_TAB: Record<Exclude<CommunityTab, 'questions' | 'all'>, 'player' | 'coach' | 'club' | 'umpire' | 'brand'> = {
  players: 'player',
  coaches: 'coach',
  clubs: 'club',
  umpires: 'umpire',
  brands: 'brand',
}

export default function CommunityPage() {
  const { tab } = useParams<{ tab?: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [refreshKey, setRefreshKey] = useState(0)
  // Viewer role drives the lane order on the All tab (Slice B+):
  // a player wants to see "Featured clubs" first because that's
  // actionable for them; a club wants "Featured players" first
  // because that's their recruitment surface. The viewer's own role
  // goes LAST in their stack — they've already seen themselves.
  const { profile: viewerProfile } = useAuthStore()
  // Sprint 2 recruiting context: the active ContextSwitcher target
  // overrides the implicit profile-derived target. So a multi-team
  // Mixed club can scope Fit + carousel filters to "Women" without
  // touching their profile. Falls back to profile derivation when
  // no context is active (anon/non-club viewers always see null
  // here — useActiveRecruitingTarget gates on role).
  const activeRecruitingTarget = useActiveRecruitingTarget()
  // The sought ROLE of the active scope ('player' | 'coach' | null),
  // server-derived from the linked opportunity's opportunity_type. This is
  // the primary axis for reshaping Community: a coach-scope should surface
  // COACHES, a player-scope should surface PLAYERS.
  const activeRecruitingRole = useActiveRecruitingTargetRole()
  const isRecruiterViewer = viewerProfile?.role === 'club' || viewerProfile?.role === 'coach'
  // A scope "reshapes" Community only when: viewer is a recruiter, a scope
  // is active, AND it carries a role we can filter on. (target_role is only
  // 'player' or 'coach' today; category-only/custom scopes don't hard-filter
  // by role.)
  const scopedRole: 'player' | 'coach' | null =
    isRecruiterViewer && (activeRecruitingRole === 'player' || activeRecruitingRole === 'coach')
      ? activeRecruitingRole
      : null
  // "Show everyone" escape — the recruiter can widen past the auto role
  // filter without clearing the scope (Fit ranking + category still apply).
  // Reset whenever the scoped role changes so a new scope re-focuses.
  const [showEveryone, setShowEveryone] = useState(false)
  useEffect(() => { setShowEveryone(false) }, [scopedRole])
  // The scope is actively reshaping the page (role filter applied) when a
  // scopedRole exists and the user hasn't widened to everyone.
  const scopeReshaping = scopedRole !== null && !showEveryone

  // Scroll restoration between Members ↔ Questions toggle (and across
  // role chips). React Router's default scrolls to top on route change;
  // we save per-pathname and restore so the user keeps their place.
  const scrollMemoRef = useRef<Map<string, number>>(new Map())
  const currentPathnameRef = useRef(location.pathname)
  useEffect(() => {
    currentPathnameRef.current = location.pathname
  }, [location.pathname])
  useEffect(() => {
    const onScroll = () => {
      scrollMemoRef.current.set(currentPathnameRef.current, window.scrollY)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  useEffect(() => {
    const saved = scrollMemoRef.current.get(location.pathname)
    if (saved !== undefined) {
      // rAF so the content for the new pathname has rendered enough to
      // accept the scrollY. Fallback to a 200ms settle pass for async
      // content like PeopleListView's fetch. behavior: 'instant'
      // overrides the global `scroll-smooth` CSS so tab switches don't
      // visibly animate the restore.
      requestAnimationFrame(() => window.scrollTo({ top: saved, left: 0, behavior: 'instant' }))
      const t = window.setTimeout(() => window.scrollTo({ top: saved, left: 0, behavior: 'instant' }), 200)
      return () => window.clearTimeout(t)
    }
  }, [location.pathname])
  const [totalCount, setTotalCount] = useState<number | null>(null)
  const [filteredCount, setFilteredCount] = useState<number | null>(null)
  const [searchLoading] = useState(false)

  // Determine active tab from URL param — default to 'all' (open ecosystem view)
  const activeTab: CommunityTab =
    tab && VALID_TABS.includes(tab as CommunityTab)
      ? (tab as CommunityTab)
      : 'all'

  // Unknown /community/<garbage> redirects to /community instead of
  // silently rendering the All grid under a stale URL. QA flagged
  // /community/foobar → still 'All' grid + wrong URL.
  useEffect(() => {
    if (tab && !VALID_TABS.includes(tab as CommunityTab)) {
      navigate('/community', { replace: true })
    }
  }, [tab, navigate])

  useDocumentTitle(TITLE_BY_TAB[activeTab])

  const isMembers = activeTab !== 'questions'

  // Map the chip tab id → role filter for both the PeopleListView and
  // the carousel. 'all' → undefined: the grid loads every role; the
  // carousel returns top across non-brand roles.
  const chipRoleFilter: 'player' | 'coach' | 'club' | 'umpire' | 'brand' | undefined =
    isMembers && activeTab !== 'all' ? ROLE_FILTER_BY_TAB[activeTab as keyof typeof ROLE_FILTER_BY_TAB] : undefined
  // When a scope is actively reshaping the page, the sought role becomes a
  // HARD filter on both the carousel and All Members — overriding the chip
  // default — so a coach-scope shows coaches, a player-scope shows players.
  // "Show everyone" clears this back to the chip-driven filter.
  const memberRoleFilter: 'player' | 'coach' | 'club' | 'umpire' | 'brand' | undefined =
    scopeReshaping ? scopedRole! : chipRoleFilter

  // ── Featured carousel inputs (memoized) ─────────────────────────
  // These used to be computed inside the JSX IIFE, which produced a
  // brand-new `filterPlayingCategories` array reference on every
  // render. TopCommunityMembersCarousel's effect depends on that
  // array, so each parent render re-fired its fetch — a single cold
  // /community load saw 3–5 RPC calls to get_top_community_members.
  // Hoisting + useMemo keeps the array reference stable across
  // renders that don't actually change the inputs.
  const themeIndex = useMemo(() => {
    const themeOverride = searchParams.get('theme')
    return themeOverride !== null && /^[0-3]$/.test(themeOverride)
      ? Number(themeOverride)
      : currentWeekThemeIndex()
  }, [searchParams])

  const featured = useMemo(
    () => featuredForTheme(
      themeIndex,
      viewerProfile?.role,
      viewerProfile?.coach_recruits_for_team,
    ),
    [themeIndex, viewerProfile?.role, viewerProfile?.coach_recruits_for_team],
  )

  // viewerTarget — primitives only (string | null), so memoization
  // is on the underlying profile fields the resolver actually reads.
  // The ESLint rule wants the whole `viewerProfile` object, but
  // depending on a new profile reference every render would defeat
  // the point of this memo (which is what produced the carousel
  // double-fetch in the first place — see CommunityPage's filter
  // hoisting comment above).
  const viewerTarget = useMemo(
    () => activeRecruitingTarget ?? deriveTargetCategory(viewerProfile),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      activeRecruitingTarget,
      viewerProfile?.role,
      viewerProfile?.womens_league_division,
      viewerProfile?.mens_league_division,
    ],
  )

  // The single source of truth for the carousel's category whitelist
  // prop. Stable array reference: only changes when the underlying
  // lane (featured.lane or memberRoleFilter, depending on which tab
  // is active) or viewerTarget actually changes.
  const filterPlayingCategories = useMemo(() => {
    if (activeTab === 'all') {
      return featured.lane === 'player' && viewerTarget
        ? playingCategoriesForTarget(viewerTarget)
        : undefined
    }
    return memberRoleFilter === 'player' && viewerTarget
      ? playingCategoriesForTarget(viewerTarget)
      : undefined
  }, [activeTab, featured.lane, memberRoleFilter, viewerTarget])

  // Lifted filter state. searchQuery is seeded from the URL ?q= param
  // on first mount via the hook's initial value; the sync effects
  // below keep them aligned afterwards.
  const filtersState = useCommunityFiltersState(memberRoleFilter, searchParams.get('q') ?? '')
  const { searchQuery, setSearchQuery, filters, updateFilter, hasActiveFilters, isNarrowed, sort, setSort, showFilters, setShowFilters, setApplyContextFit } = filtersState

  // Auto-apply context-fit ranking whenever a scope is active (the opt-in
  // "Best matches first" toggle is gone — a scope now reshapes by default).
  // Player-scope → players ranked best-fit-first; for non-player scopes the
  // role filter is the primary effect (no coach-fit math yet — Phase 2).
  useEffect(() => {
    setApplyContextFit(Boolean(scopedRole))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedRole])

  // Input → URL: write searchQuery to the URL ?q= param.
  //
  // No "skip first render" guard here — we read the live URL inside
  // the effect (window.location.search, not the captured searchParams
  // ref) and compare to the current searchQuery. If they're already
  // aligned (which they are on mount thanks to the hook initialising
  // from the URL), this is a no-op. That's StrictMode-safe: the
  // double-invoke just runs two no-ops on first mount.
  //
  // Reading from window.location.search rather than the captured
  // `searchParams` ref makes the comparison robust against stale
  // closures across StrictMode reruns.
  useEffect(() => {
    const trimmed = searchQuery.trim()
    const liveParams = new URLSearchParams(window.location.search)
    const current = liveParams.get('q') ?? ''
    if (trimmed === current) return
    if (trimmed) liveParams.set('q', trimmed)
    else liveParams.delete('q')
    setSearchParams(liveParams, { replace: true })
  }, [searchQuery, setSearchParams])

  // URL → input: handle URL changes (browser back/forward, external
  // navigation). Deps are JUST [searchParams] — including searchQuery
  // would create a ping-pong loop in reverse.
  useEffect(() => {
    const urlQ = searchParams.get('q') ?? ''
    if (urlQ !== searchQuery) {
      setSearchQuery(urlQ)
    }
  }, [searchParams]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync filters.role with the URL-driven chip AND clear everything
  // else. QA flagged that search + Open-to-Opportunities + drawer
  // filters silently carried over across chip clicks — producing
  // "0 visible / 13 in count" mismatches. Tapping a chip is a
  // "start over with this role" action.
  //
  // Uses a previous-value ref (not an "isFirstRun" ref) so the
  // detection is StrictMode-safe. The "isFirstRun" pattern fails
  // because React StrictMode runs effects twice in dev: the first
  // run flips the ref, the second run then sees the flipped ref and
  // runs the clearing path with no actual chip change — which then
  // called setSearchQuery('') and silently wiped a deep-linked ?q=
  // from the URL. (QA-flagged "hard reload strips q" bug.) Comparing
  // prev → current memberRoleFilter on a real value, with a separate
  // "has initialised" flag, is idempotent under StrictMode AND
  // correctly detects real chip transitions including
  // undefined → 'player'.
  const hasInitializedRoleRef = useRef(false)
  const prevRoleFilterRef = useRef<typeof memberRoleFilter>(memberRoleFilter)
  useEffect(() => {
    if (!hasInitializedRoleRef.current) {
      hasInitializedRoleRef.current = true
      prevRoleFilterRef.current = memberRoleFilter
      updateFilter('role', memberRoleFilter ?? 'all')
      return
    }

    if (prevRoleFilterRef.current === memberRoleFilter) {
      // StrictMode's second invocation OR a re-render without a real
      // chip change. Nothing to do.
      return
    }

    prevRoleFilterRef.current = memberRoleFilter

    // Real chip change — clear everything, then set role.
    setSearchQuery('')
    updateFilter('availability', 'all')
    updateFilter('position', [])
    updateFilter('category', 'all')
    updateFilter('location', '')
    updateFilter('nationality', '')
    updateFilter('brandCategory', null)
    updateFilter('role', memberRoleFilter ?? 'all')
  }, [memberRoleFilter, updateFilter, setSearchQuery])

  // Escape the scope's hard role filter when the user explicitly taps a role
  // tab that differs from the sought role — and RE-focus when they tap back to
  // it. This MUST be its own effect, NOT folded into the role-sync effect
  // above: while scoped, `memberRoleFilter` is pinned to `scopedRole`, so
  // tapping a different chip changes `chipRoleFilter` but NOT
  // `memberRoleFilter` — the role-sync effect's "did the filter change?" guard
  // early-returns and would never flip showEveryone (the original QA bug). We
  // watch chipRoleFilter ↔ scopedRole directly. The 'all' tab (chipRoleFilter
  // undefined) is intentionally left alone so a freshly-scoped recruiter
  // landing on /community still gets the focused "Top … for your search" view
  // instead of auto-escaping to everyone.
  useEffect(() => {
    if (scopedRole === null) return
    if (chipRoleFilter && chipRoleFilter !== scopedRole && !showEveryone) {
      setShowEveryone(true)
    } else if (chipRoleFilter === scopedRole && showEveryone) {
      setShowEveryone(false)
    }
  }, [scopedRole, chipRoleFilter, showEveryone])

  const handleRefresh = useCallback(async () => {
    setRefreshKey(k => k + 1)
  }, [])

  const handleViewAllScroll = useCallback(() => {
    const el = document.getElementById('community-all-members')
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  return (
    <div className="min-h-screen bg-gray-50 overflow-x-hidden">
      <Header />

      <PullToRefresh onRefresh={handleRefresh}>
        <main className="max-w-7xl mx-auto px-4 md:px-6 pt-20 pb-12">
          {/* Page intro (title + subtitle) removed 2026-05-29 — the
              Community label was redundant with the bottom-nav active
              state, and the description added vertical noise above
              the actual interactive surface. Recruiter-only
              ContextSwitcher self-hides for players, brands, umpires,
              and anon viewers; when hidden, the page starts directly
              with the Members / Questions segmented control below. */}
          <ContextSwitcher className="mb-4" />

          {/* Educational hint — Recruiter Match needs a real recruiting
              context. Without one we never show fit/match language, so tell
              the recruiter how to turn it on. Recruiter-only, no-context. */}
          {isRecruiterViewer && !scopedRole && (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-[#8026FA]/15 bg-[#8026FA]/[0.04] px-3.5 py-2.5 text-xs leading-snug text-gray-600">
              <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#8026FA]" aria-hidden="true" />
              <span>
                Add a recruiting context to see <span className="font-semibold text-gray-800">Recruiter Match</span> ranking.
                Until then, profiles are shown by completeness and activity.
              </span>
            </div>
          )}

          {/* Members / Questions segmented control */}
          <div className="mb-4">
            <CommunityTabSwitcher activeTab={activeTab} />
          </div>

          {isMembers ? (
            <>
              {/* Coach-only discoverability banner — surfaces only when
                  a coach has no active recruiting context. Sets the
                  expectation that Club Fit needs a scope before it
                  appears on player cards. Self-hides once context is
                  set or the user dismisses. */}
              <div className="mb-3">
                <CoachContextNudge />
              </div>

              {/* Search bar */}
              <div className="relative mb-3">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 z-10" />
                <input
                  type="search"
                  data-keyboard-shortcut="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by name, location, position, or club"
                  className="w-full pl-12 pr-10 py-3 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm sm:text-base bg-white"
                  autoComplete="off"
                  enterKeyHint="search"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    aria-label="Clear search"
                    className="absolute right-1 top-1/2 -translate-y-1/2 min-w-[44px] min-h-[44px] inline-flex items-center justify-center text-gray-400 hover:text-gray-600 text-lg"
                  >
                    ×
                  </button>
                )}
                {searchLoading && (
                  <div className="absolute right-10 top-1/2 -translate-y-1/2">
                    <Loader2 className="w-4 h-4 text-purple-500 animate-spin" />
                  </div>
                )}
              </div>

              {/* Quick filters row: Open to Opportunities + Filters */}
              <div className="flex items-center justify-center gap-2 mb-4">
                <button
                  type="button"
                  onClick={() => updateFilter('availability', filters.availability === 'open' ? 'all' : 'open')}
                  aria-pressed={filters.availability === 'open'}
                  className={`whitespace-nowrap px-4 min-h-[44px] rounded-full text-sm font-medium transition-all flex items-center gap-1.5 flex-shrink-0 ${
                    filters.availability === 'open'
                      ? 'bg-emerald-500 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-current flex-shrink-0" />
                  Open to opportunities
                </button>
                <button
                  type="button"
                  onClick={() => setShowFilters(!showFilters)}
                  aria-expanded={showFilters}
                  className="flex items-center gap-1.5 whitespace-nowrap px-4 min-h-[44px] text-sm font-medium text-gray-700 bg-gray-100 rounded-full hover:bg-gray-200 active:bg-gray-300 transition-colors flex-shrink-0"
                >
                  <Filter className="w-4 h-4" />
                  Filters
                  {hasActiveFilters && <span className="w-2 h-2 bg-[#8026FA] rounded-full" />}
                </button>
              </div>

              {/* Filters drawer (mobile) / panel (desktop) */}
              <CommunityFiltersDrawer state={filtersState} />

              {/* Role chips */}
              <div className="mb-4 sm:mb-5">
                <CommunityRoleChips activeTab={activeTab} />
              </div>

              {/* "Featured this week" carousel — hidden when narrowing.
                  Slice C (2026-05-27) collapsed three stacked lanes
                  down to a SINGLE viewer-targeted carousel to reduce
                  visual noise and shorten the path to the All members
                  grid:
                    - 'all' tab renders one carousel whose role +
                      criterion are driven by the viewer's own role
                      (see featuredLaneForViewer). Players see clubs;
                      clubs / recruiter-coaches see players; etc.
                    - Specific role tabs (/community/players, etc.)
                      still render a single carousel scoped to that
                      tab's role with the role-appropriate criterion.

                  Weekly theme rotation is intentionally NOT implemented
                  yet — it would need additional sort criteria in the
                  get_top_community_members RPC ("recently joined",
                  "open to opportunities", etc.). Marked as a follow-up
                  slice; for now the lane is fixed per role. */}
              {/* When a scope is reshaping the page, the carousel is driven
                  by the SOUGHT ROLE (coach-scope → featured coaches,
                  player-scope → featured players) — matching All Members.
                  Otherwise the existing theme/role-tab behaviour applies. */}
              {/* Featured ↔ scoped carousel swap. Wrapped + keyed so the new
                  lane FADES IN on a context/tab change instead of hard-cutting
                  (Phase 3). The wrapper key excludes refreshKey so a pull-to-
                  refresh doesn't re-fade; the inner carousels keep their own
                  keys for fetch/refresh remounts. The carousel's own mb-6
                  margin collapses through the (border/padding-free) wrapper, so
                  spacing to "All members" is unchanged. animate-fade-in is
                  opacity-only and already collapses to ~0ms under
                  prefers-reduced-motion. */}
              <div
                key={
                  isNarrowed
                    ? 'carousel-narrowed'
                    : scopeReshaping
                      ? `carousel-scoped-${scopedRole}`
                      : activeTab === 'all'
                        ? `carousel-featured-${themeIndex}`
                        : `carousel-top-${activeTab}`
                }
                className="animate-fade-in"
              >
                {!isNarrowed && scopeReshaping && (
                  <TopCommunityMembersCarousel
                    key={`scoped-${scopedRole}-${refreshKey}`}
                    roleFilter={scopedRole!}
                    sortCriterion={scopedRole === 'player' ? 'availability_activity' : 'completeness'}
                    title={scopedRole === 'coach' ? 'Top coaches for your search' : 'Top players for your search'}
                    subtitle="Ranked for your active recruiting scope"
                    filterPlayingCategories={filterPlayingCategories}
                    onViewAll={handleViewAllScroll}
                    showEvidence
                    // Tapping a candidate whose role matches the scope opens the
                    // rich recruiter evaluation sheet (player OR coach), mirroring
                    // the All-Members grid.
                    scopedRecruiterRole={scopedRole}
                  />
                )}
                {!isNarrowed && !scopeReshaping && activeTab === 'all' && (
                  <TopCommunityMembersCarousel
                    key={`featured-${themeIndex}-${refreshKey}`}
                    roleFilter={featured.lane}
                    sortCriterion={featured.criterion}
                    onlyOpen={featured.onlyOpen}
                    title={featured.title}
                    subtitle={featured.subtitle}
                    filterPlayingCategories={filterPlayingCategories}
                    onViewAll={handleViewAllScroll}
                  />
                )}
                {!isNarrowed && !scopeReshaping && activeTab !== 'all' && memberRoleFilter && (
                  <TopCommunityMembersCarousel
                    key={`top-${activeTab}-${refreshKey}`}
                    roleFilter={memberRoleFilter}
                    sortCriterion={memberRoleFilter === 'player' ? 'availability_activity' : 'completeness'}
                    filterPlayingCategories={filterPlayingCategories}
                    onViewAll={handleViewAllScroll}
                  />
                )}
              </div>

              {/* All Members section header. Count = filtered list size
                  when narrowing (search/OTO/drawer active), total
                  otherwise. Fixes the QA-flagged "badge says 13 but
                  grid shows 1" desync. Shown to logged-out viewers too —
                  anon now browses the community, so the count resolves. */}
              <section id="community-all-members" className="scroll-mt-20 mb-3 flex items-end justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <h2 className="text-lg font-bold text-gray-900 whitespace-nowrap">All members</h2>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {(() => {
                      const displayed = isNarrowed ? filteredCount : totalCount
                      if (displayed === null) return 'Loading…'
                      if (isNarrowed && displayed === 0) return 'No matching members'
                      const noun = displayed === 1 ? 'member' : 'members'
                      return `${displayed.toLocaleString()} ${noun}${isNarrowed ? ' match' : ''}`
                    })()}
                  </p>
                </div>
                <label className="text-xs text-gray-500 flex items-center gap-1.5 flex-shrink-0">
                  Sort by:
                  <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value as SortOption)}
                    title={sort === 'newest' ? 'Sorted by most-recent join date' : 'Sorted by profile completeness, highest first'}
                    className="text-xs font-semibold text-[#8026FA] bg-transparent border-0 focus:outline-none focus:ring-0 pr-1 cursor-pointer"
                  >
                    <option value="newest">Newest members</option>
                    <option value="completeness">Profile completeness</option>
                  </select>
                </label>
              </section>

              {/* Scoped-state banner — when a scope reshapes the page, make
                  it explicit that results are role-filtered + ranked for
                  the active recruiting search, with a one-tap escape to
                  widen back to everyone (without clearing the scope). */}
              {scopedRole && (
                <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-[#8026FA]/20 bg-[#8026FA]/[0.04] px-4 py-2.5">
                  <p className="min-w-0 text-xs text-gray-700">
                    {/* Keyed so the banner copy crossfades when toggling between
                        scoped and everyone, instead of snapping. */}
                    <span key={scopeReshaping ? 'scoped' : 'everyone'} className="inline-block animate-fade-in">
                      {scopeReshaping ? (
                        <>
                          Showing <span className="font-semibold">{scopedRole === 'coach' ? 'coaches' : 'players'}</span> ranked for your recruiting scope.
                        </>
                      ) : (
                        <>Showing everyone — your scope still personalises ranking.</>
                      )}
                    </span>
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowEveryone((v) => !v)}
                    className="flex-shrink-0 whitespace-nowrap text-xs font-semibold text-[#8026FA] transition active:scale-95 hover:underline"
                  >
                    {scopeReshaping ? 'Show everyone' : `Show ${scopedRole === 'coach' ? 'coaches' : 'players'} only`}
                  </button>
                </div>
              )}

              {/* All Members grid */}
              <div key={`${activeTab}-${refreshKey}`} className="animate-fade-in">
                <PeopleListView
                  roleFilter={memberRoleFilter}
                  state={filtersState}
                  onTotalCountChange={setTotalCount}
                  onFilteredCountChange={setFilteredCount}
                  scopeReshaping={scopeReshaping}
                />
              </div>
            </>
          ) : (
            <div className="animate-fade-in">
              <QuestionsListView />
            </div>
          )}
        </main>
      </PullToRefresh>
    </div>
  )
}

// ── Weekly theme rotation for the Featured carousel ──────────────────
// One carousel renders on the All tab; its theme rotates weekly so
// the page feels fresh week-over-week. Theme index (0–3) cycles
// through 4 themes:
//
//   THEME 0 — Role-targeted: viewer-aware (Featured Clubs for player
//     viewers; Featured Players for club / recruiter-coach viewers;
//     etc). Uses the existing role/criterion mapping.
//   THEME 1 — New on HOCKIA: cross-role, ranked by created_at DESC.
//   THEME 2 — Most complete profiles: cross-role, ranked by
//     completeness (the original ranking for the carousel — still
//     useful as a periodic surface for clubs / coaches looking for
//     polished candidates).
//   THEME 3 — Open to opportunities: cross-role, only profiles with
//     an open-to-X flag set, ranked by availability_activity.
//
// Dev override: ?theme=0|1|2|3 in the URL forces a specific theme,
// useful for QA + product review without waiting a week.
type CarouselLane = 'player' | 'club' | 'coach' | undefined
type CarouselCriterion = 'completeness' | 'availability_activity' | 'recently_joined'

interface FeaturedConfig {
  lane: CarouselLane
  criterion: CarouselCriterion
  onlyOpen: boolean
  title: string
  subtitle: string
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
// Fixed reference epoch so the week index is stable across timezones
// and doesn't shift mid-week. 2026-01-05 is a Monday — week boundary
// rotates on Monday UTC across the platform.
const WEEK_EPOCH_MS = Date.UTC(2026, 0, 5)
const THEME_COUNT = 4

/** Current theme index 0..3 based on weeks since the epoch. */
function currentWeekThemeIndex(): number {
  const idx = Math.floor((Date.now() - WEEK_EPOCH_MS) / WEEK_MS)
  return ((idx % THEME_COUNT) + THEME_COUNT) % THEME_COUNT
}

/** Theme 0 only — viewer-aware role-targeted lane chooser. */
function roleTargetedConfig(
  role: string | null | undefined,
  recruiterFlag: boolean | null | undefined,
): { lane: 'player' | 'club'; criterion: 'completeness' | 'availability_activity'; title: string; subtitle: string } {
  const wantsPlayers =
    role === 'club' ||
    role === 'brand' ||
    (role === 'coach' && Boolean(recruiterFlag)) ||
    role === undefined ||
    role === null
  if (wantsPlayers) {
    return {
      lane: 'player',
      criterion: 'availability_activity',
      title: 'Featured players',
      subtitle: 'Open to opportunities and recently active.',
    }
  }
  // Players, non-recruiter coaches, umpires → Featured clubs.
  return {
    lane: 'club',
    criterion: 'completeness',
    title: 'Featured clubs',
    subtitle: 'Most complete profiles on HOCKIA.',
  }
}

/** Resolve the FeaturedConfig for a given theme index + viewer context. */
function featuredForTheme(
  themeIndex: number,
  role: string | null | undefined,
  recruiterFlag: boolean | null | undefined,
): FeaturedConfig {
  switch (themeIndex) {
    case 1:
      return {
        lane: undefined, // cross-role
        criterion: 'recently_joined',
        onlyOpen: false,
        title: 'New on HOCKIA',
        subtitle: 'Recently joined members across the platform.',
      }
    case 2:
      return {
        lane: undefined, // cross-role
        criterion: 'completeness',
        onlyOpen: false,
        title: 'Most complete profiles',
        subtitle: 'Polished profiles worth a closer look.',
      }
    case 3:
      return {
        lane: undefined, // cross-role
        criterion: 'availability_activity',
        onlyOpen: true,
        title: 'Open to opportunities',
        subtitle: 'Members accepting recruitment contact this month.',
      }
    case 0:
    default: {
      const targeted = roleTargetedConfig(role, recruiterFlag)
      return {
        ...targeted,
        onlyOpen: false,
      }
    }
  }
}
