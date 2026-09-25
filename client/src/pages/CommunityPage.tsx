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

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { Search, SlidersHorizontal, Loader2, Sparkles, X, ChevronDown } from 'lucide-react'
import { Header } from '@/components'
import { PullToRefresh } from '@/components/PullToRefresh'
import {
  CommunitySegments,
  PeopleListView,
  QuestionsListView,
} from '@/components/community'
import { CommunityFiltersDrawer } from '@/components/community/CommunityFiltersDrawer'
import {
  useCommunityFiltersState,
  roleToPath,
  type SortOption,
} from '@/components/community/communityFilters'
import type { CommunityTab } from '@/components/community'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useAuthStore } from '@/lib/auth'
import { useCountries } from '@/hooks/useCountries'
import { getActiveFilterChips } from '@/lib/communityActiveFilters'
import { isRecruitingViewer } from '@/lib/recruiterAccess'
import { useActiveRecruitingTargetRole } from '@/hooks/useRecruitingContext'
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
  const { profile: viewerProfile, loading: authLoading } = useAuthStore()
  // Evidence sort + "Enough evidence+" are recruiter tools: clubs and coaches
  // who recruit for a team only (founder 2026-09-26).
  const canUseEvidence = isRecruitingViewer(viewerProfile)
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
  const [videoCount, setVideoCount] = useState<number | null>(null)
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

  // Lifted filter state. searchQuery is seeded from the URL ?q= param
  // on first mount via the hook's initial value; the sync effects
  // below keep them aligned afterwards.
  const filtersState = useCommunityFiltersState(memberRoleFilter, searchParams.get('q') ?? '')
  const { searchQuery, setSearchQuery, filters, updateFilter, clearFilters, isNarrowed, sort, setSort, showFilters, setShowFilters, setApplyContextFit } = filtersState
  const { countries } = useCountries()
  // Removable active-filter chips shown below the search bar; its length is also
  // the "Filters · N" badge count. Role is intentionally excluded (the chip row
  // already shows it). Rebuilt each render so onRemove closes over current state.
  const activeFilterChips = getActiveFilterChips(filters, countries, updateFilter, { canUseEvidence })

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

  // Sync filters.role with the URL-driven member type. Both the visible role
  // chips AND the drawer's "Member type" section navigate the same
  // /community/<role> URL → memberRoleFilter → filters.role is the ONE source of
  // truth. On a real role change we do a SELECTIVE reset (below): updateFilter(
  // 'role') clears only the role-INCOMPATIBLE fields; shared facets (search,
  // location, nationality, EU, availability) carry across. The old "clear
  // everything" was blunt-but-safe; relaxed now that active filters are visible
  // + individually removable below the search bar.
  //
  // Uses a previous-value ref (not an "isFirstRun" ref) so detection is
  // StrictMode-safe: StrictMode double-invokes effects in dev, and an
  // "isFirstRun" flag would run the reset path on the second invocation with no
  // real change. Comparing prev → current memberRoleFilter with a separate
  // "has initialised" flag is idempotent under StrictMode and still catches real
  // transitions (including undefined → 'player').
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

    // Real role change — SELECTIVE reset. updateFilter('role') clears the role-
    // incompatible fields (position/coachSpecializations/categories/officiating/
    // brandCategory — feeding them to an incompatible role silently empties the
    // grid); shared facets (search/location/nationality/EU/availability)
    // deliberately persist, so a recruiter keeps "France + Open-to" while
    // flipping Players↔Coaches.
    updateFilter('role', memberRoleFilter ?? 'all')
  }, [memberRoleFilter, updateFilter])

  // Evidence sort only applies to player/coach (orgs have no evidence model).
  // Snap back to "newest" when the role changes to one that can't support it,
  // so the sort <select> value always matches a rendered option.
  // Non-recruiters never get it either: a sort/filter carried in session
  // state falls back to the default (waits for auth so a recruiter's state
  // isn't wiped before their profile loads).
  useEffect(() => {
    if (sort === 'evidence' && filters.role !== 'player' && filters.role !== 'coach') {
      setSort('newest')
    } else if (sort === 'evidence' && !authLoading && !canUseEvidence) {
      setSort('newest')
    }
  }, [sort, filters.role, setSort, authLoading, canUseEvidence])
  useEffect(() => {
    if (filters.evidenceEnoughOnly && !authLoading && !canUseEvidence) {
      updateFilter('evidenceEnoughOnly', false)
    }
  }, [filters.evidenceEnoughOnly, authLoading, canUseEvidence, updateFilter])

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

  return (
    <div className="min-h-screen overflow-x-hidden bg-white lg:bg-[#F4F4F6]">
      {/* No app header on mobile (UI redesign 2026-09-19) — the screen
          opens on its own title row, like Profile. Desktop keeps it. */}
      <Header mobileHidden />

      <PullToRefresh onRefresh={handleRefresh}>
        <main className="max-w-7xl mx-auto px-4 md:px-6 pt-[max(env(safe-area-inset-top),0.75rem)] lg:pt-24 pb-12">
          {/* Title row: "Community" + the filters button (members only).
              The badge shows how many filters are narrowing the grid. */}
          <div className="mb-2 flex items-center justify-between lg:mb-3">
            <h1 className="text-large-title text-ink-1 lg:text-[22px] lg:leading-7">Community</h1>
            {isMembers && (
              <button
                type="button"
                onClick={() => setShowFilters(!showFilters)}
                aria-expanded={showFilters}
                aria-label={activeFilterChips.length > 0 ? `Filters, ${activeFilterChips.length} active` : 'Filters'}
                className="relative -mr-2 flex h-11 w-11 items-center justify-center rounded-full text-ink-1 transition-colors hover:bg-gray-200/60"
              >
                <SlidersHorizontal className="h-6 w-6" strokeWidth={1.8} />
                {activeFilterChips.length > 0 && (
                  <span aria-hidden="true" className="absolute right-2 top-2 h-2 w-2 rounded-full bg-hockia-primary ring-2 ring-white" />
                )}
              </button>
            )}
          </div>

          {/* Recruiter-only ContextSwitcher self-hides for everyone else. */}
          <ContextSwitcher className="mb-3" />

          {/* Educational hint — Recruiter Match needs a real recruiting
              context. Without one we never show fit/match language, so tell
              the recruiter how to turn it on. Recruiter-only, no-context. */}
          {isRecruiterViewer && !scopedRole && (
            <div className="mb-4 flex items-start gap-2 rounded-xl border border-hockia-primary/15 bg-hockia-primary/[0.04] px-3.5 py-2.5 text-xs leading-snug text-gray-600">
              <Sparkles className="mt-0.5 h-4 w-4 flex-shrink-0 text-hockia-primary" aria-hidden="true" />
              <span>
                Add a recruiting context to see <span className="font-semibold text-gray-800">Recruiter Match</span> ranking.
                Until then, profiles are shown by completeness and activity.
              </span>
            </div>
          )}

          {isMembers ? (
            <>
              {/* Coach-only discoverability banner — self-hides once a
                  context is set or the user dismisses. */}
              <div className="mb-3">
                <CoachContextNudge />
              </div>

              {/* Search */}
              <div className="relative mb-3">
                <Search className="absolute left-4 top-1/2 z-10 h-[18px] w-[18px] -translate-y-1/2 text-gray-400" />
                <input
                  type="search"
                  data-keyboard-shortcut="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search players, coaches, clubs"
                  className="min-h-[44px] w-full rounded-[12px] border-0 bg-surface-grouped py-2.5 pl-11 pr-10 text-body text-ink-1 placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-hockia-primary/30"
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
                    className="absolute right-1 top-1/2 inline-flex min-h-[44px] min-w-[44px] -translate-y-1/2 items-center justify-center text-lg text-gray-400 hover:text-gray-600"
                  >
                    ×
                  </button>
                )}
                {searchLoading && (
                  <div className="absolute right-10 top-1/2 -translate-y-1/2">
                    <Loader2 className="h-4 w-4 animate-spin text-hockia-primary" />
                  </div>
                )}
              </div>

              {/* Filters drawer (mobile) / panel (desktop) — opened from the
                  title-row button; "Open to opportunities" lives inside it. */}
              <CommunityFiltersDrawer
                state={filtersState}
                resultCount={isNarrowed ? filteredCount : totalCount}
                videoCount={videoCount}
                onSelectRole={(role) => navigate(roleToPath(role))}
              />

              {/* All · Players · Coaches · Clubs · Brands · Umpires */}
              <div className="mb-4">
                <CommunitySegments activeTab={activeTab} />
              </div>

              {/* Active filter chips — removable narrowing summary (role excluded;
                  the chip row above already shows it). Count mirrors "Filters · N". */}
              {activeFilterChips.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 mb-4">
                  {activeFilterChips.map((chip) => (
                    <button
                      key={chip.id}
                      type="button"
                      onClick={chip.onRemove}
                      aria-label={`Remove filter ${chip.label}`}
                      className="inline-flex items-center gap-1 pl-3 pr-2 py-1 rounded-full text-xs font-medium bg-purple-50 text-[#6B20D4] border border-purple-200 hover:bg-purple-100 transition-colors"
                    >
                      {chip.label}
                      <X className="w-3 h-3" />
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="text-xs text-gray-500 hover:text-gray-700 font-medium underline underline-offset-2 ml-0.5"
                  >
                    Clear all
                  </button>
                </div>
              )}

              {/* "All members · N" + sort. Count = filtered list size when
                  narrowing (search/drawer active), total otherwise. The
                  featured carousel that sat here was removed in the
                  2026-09-19 redesign ("more simple"). */}
              <section id="community-all-members" className="scroll-mt-20 mb-3 flex items-center justify-between gap-3">
                <h2 className="min-w-0 truncate text-[17px] font-bold text-gray-900">
                  {isNarrowed ? 'Matching members' : 'All members'}
                  {(() => {
                    const displayed = isNarrowed ? filteredCount : totalCount
                    if (displayed === null) return null
                    return <span className="font-semibold text-gray-500"> · {displayed.toLocaleString()}</span>
                  })()}
                </h2>
                <label className="relative flex flex-shrink-0 items-center text-[13px] font-semibold text-hockia-primary">
                  <span className="sr-only">Sort by</span>
                  <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value as SortOption)}
                    title={sort === 'newest' ? 'Sorted by most-recent join date' : sort === 'evidence' ? 'Sorted by strongest verifiable evidence first' : 'Sorted by profile completeness, highest first'}
                    className="min-h-[36px] cursor-pointer appearance-none border-0 bg-transparent py-0 pl-1 pr-6 text-[13px] font-semibold text-hockia-primary focus:outline-none focus:ring-0"
                  >
                    <option value="newest">Newest</option>
                    <option value="completeness">Most complete</option>
                    {canUseEvidence && (filters.role === 'player' || filters.role === 'coach') && (
                      <option value="evidence">Strongest evidence</option>
                    )}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-1 h-4 w-4" aria-hidden="true" />
                </label>
              </section>

              {/* Scoped-state banner — when a scope reshapes the page, make
                  it explicit that results are role-filtered + ranked for
                  the active recruiting search, with a one-tap escape to
                  widen back to everyone (without clearing the scope). */}
              {scopedRole && (
                <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-hockia-primary/20 bg-hockia-primary/[0.04] px-4 py-2.5">
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
                    className="flex-shrink-0 whitespace-nowrap text-xs font-semibold text-hockia-primary transition active:scale-95 hover:underline"
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
                  onVideoCountChange={setVideoCount}
                  scopeReshaping={scopeReshaping}
                />
              </div>
            </>
          ) : (
            <>
              <div className="mb-4">
                <CommunitySegments activeTab={activeTab} />
              </div>
              <div className="animate-fade-in">
                <QuestionsListView />
              </div>
            </>
          )}
        </main>
      </PullToRefresh>
    </div>
  )
}
