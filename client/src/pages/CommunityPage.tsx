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
import { Search, Filter, Loader2 } from 'lucide-react'
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
      // content like PeopleListView's fetch.
      requestAnimationFrame(() => window.scrollTo(0, saved))
      const t = window.setTimeout(() => window.scrollTo(0, saved), 200)
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
  const memberRoleFilter: 'player' | 'coach' | 'club' | 'umpire' | 'brand' | undefined =
    isMembers && activeTab !== 'all' ? ROLE_FILTER_BY_TAB[activeTab as keyof typeof ROLE_FILTER_BY_TAB] : undefined

  // Lifted filter state. searchQuery is seeded from the URL ?q= param
  // on first mount via the hook's initial value; the sync effects
  // below keep them aligned afterwards.
  const filtersState = useCommunityFiltersState(memberRoleFilter, searchParams.get('q') ?? '')
  const { searchQuery, setSearchQuery, filters, updateFilter, hasActiveFilters, isNarrowed, sort, setSort, showFilters, setShowFilters } = filtersState

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
          {/* Page title + subtitle */}
          <header className="mb-4">
            <h1 className="text-2xl sm:text-3xl font-bold">
              <span className="bg-gradient-to-r from-[#8026FA] to-[#924CEC] text-transparent bg-clip-text italic">
                Community
              </span>
            </h1>
            <p className="mt-1 text-sm text-gray-600">
              Connect with field hockey players, coaches, clubs and organisations around the world.
            </p>
          </header>

          {/* Members / Questions segmented control */}
          <div className="mb-4">
            <CommunityTabSwitcher activeTab={activeTab} />
          </div>

          {isMembers ? (
            <>
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
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-lg"
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
                  aria-pressed={filters.availability === 'open' ? 'true' : 'false'}
                  className={`whitespace-nowrap px-4 py-2 rounded-full text-sm font-medium transition-all flex items-center gap-1.5 flex-shrink-0 ${
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
                  aria-expanded={showFilters ? 'true' : 'false'}
                  className="flex items-center gap-1.5 whitespace-nowrap px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-full hover:bg-gray-200 active:bg-gray-300 transition-colors flex-shrink-0"
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

              {/* Top community members carousel — hidden when narrowing */}
              {!isNarrowed && (
                <TopCommunityMembersCarousel
                  key={`top-${activeTab}-${refreshKey}`}
                  roleFilter={memberRoleFilter}
                  onViewAll={handleViewAllScroll}
                />
              )}

              {/* All Members section header. Count = filtered list size
                  when narrowing (search/OTO/drawer active), total
                  otherwise. Fixes the QA-flagged "badge says 13 but
                  grid shows 1" desync. */}
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

              {/* All Members grid */}
              <div key={`${activeTab}-${refreshKey}`} className="animate-fade-in">
                <PeopleListView
                  roleFilter={memberRoleFilter}
                  state={filtersState}
                  onTotalCountChange={setTotalCount}
                  onFilteredCountChange={setFilteredCount}
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
