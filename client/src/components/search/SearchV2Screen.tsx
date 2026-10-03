import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronRight, Clock, Search, Sparkles, X } from 'lucide-react'
import Flag from '@/components/Flag'
import RoleBadge from '@/components/RoleBadge'
import Skeleton from '@/components/Skeleton'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useMemberFlags } from '@/hooks/useMemberFlags'
import { useRecentSearches } from '@/hooks/useRecentSearches'
import { useSearch, type SearchPersonResult } from '@/hooks/useSearch'
import { trackSearch } from '@/lib/analytics'
import { getImageUrl } from '@/lib/imageUrl'
import { trackDbEvent } from '@/lib/trackDbEvent'
import {
  MAX_ROWS,
  MIN_QUERY_LENGTH,
  SEARCH_PLACEHOLDER,
  SEARCH_SCOPE_LINE,
  askAiLabel,
  communityPathFor,
  discoverPathFor,
  memberMetaLine,
  memberProfilePath,
  noMembersLabel,
  seeAllMembersLabel,
} from '@/lib/searchV2'

/**
 * Search v2, phone (Figma "New-Hockia" Search v2 42:195; founder rulings
 * 2026-10-03). Nav: the query in a text field + Cancel. With a query: an
 * "Ask Hockia AI about …" row on top, then one flat ranked list of members
 * (every role together) with a role pill on each row, and a "See all N
 * members" footer into Community. Empty query: recent searches. Rows show
 * name and "position · club · flag" only — never fit, level, score, counts
 * or reply times. Desktop keeps the v1 results page (pages/SearchPage.tsx).
 */
export function SearchV2Screen() {
  useDocumentTitle('Search')
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [query, setQuery] = useState(searchParams.get('q') ?? '')
  const [debounced, setDebounced] = useState(query)
  const inputRef = useRef<HTMLInputElement>(null)
  const { recentSearches, addSearch, clearAll } = useRecentSearches()

  // Typing → results after 300 ms; the URL mirrors the settled query so back
  // from a profile, Community or Hockia AI lands on the same list.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300)
    return () => clearTimeout(t)
  }, [query])
  useEffect(() => {
    const trimmed = debounced.trim()
    if ((searchParams.get('q') ?? '') === trimmed) return
    const next = new URLSearchParams(searchParams)
    if (trimmed) next.set('q', trimmed)
    else next.delete('q')
    setSearchParams(next, { replace: true })
  }, [debounced, searchParams, setSearchParams])

  const settled = debounced.trim()
  const hasQuery = settled.length >= MIN_QUERY_LENGTH
  const { data, isLoading } = useSearch(settled, 'people')
  const members = (data?.pages[0]?.results ?? []).filter(
    (r): r is SearchPersonResult => r.result_type === 'person',
  )
  const rows = members.slice(0, MAX_ROWS)
  const total = data?.pages[0]?.type_counts.people ?? members.length
  const flags = useMemberFlags(rows.map((r) => r.profile_id))

  // One analytics event per settled query, once its first page is in.
  const lastTracked = useRef('')
  useEffect(() => {
    if (!data?.pages[0] || !hasQuery || lastTracked.current === settled) return
    lastTracked.current = settled
    trackDbEvent('search', undefined, undefined, { search_type: 'members', search_term: settled, result_count: total })
    trackSearch('members', settled)
  }, [data?.pages, hasQuery, settled, total])

  const remember = useCallback(() => {
    if (settled.length >= MIN_QUERY_LENGTH) addSearch(settled)
  }, [settled, addSearch])

  const cancel = useCallback(() => {
    if (window.history.length > 1) navigate(-1)
    else navigate('/home')
  }, [navigate])

  const askAi = useCallback(() => {
    remember()
    navigate(discoverPathFor(query), { state: { from: '/search' } })
  }, [navigate, query, remember])

  const seeAll = useCallback(() => {
    remember()
    navigate(communityPathFor(settled), { state: { from: '/search' } })
  }, [navigate, settled, remember])

  const openMember = useCallback((row: SearchPersonResult, index: number) => {
    remember()
    trackDbEvent('search_result_click', 'person', row.profile_id, { query: settled, position: index, result_type: 'person' })
    navigate(memberProfilePath(row.role, row.profile_id), { state: { from: '/search' } })
  }, [navigate, remember, settled])

  const showAiRow = query.trim().length > 0

  return (
    <div className="min-h-screen bg-white pb-24">
      {/* Nav bar: text field + Cancel (Figma Nav bar, "Cancel" style) */}
      <div className="sticky top-0 z-10 bg-white pt-[env(safe-area-inset-top)]">
        <form
          role="search"
          className="flex items-center gap-3 px-4 py-2"
          onSubmit={(e) => {
            e.preventDefault()
            setDebounced(query)
            remember()
            inputRef.current?.blur()
          }}
        >
          <label className="relative flex h-10 min-w-0 flex-1 items-center">
            <span className="sr-only">Search members</span>
            <Search className="pointer-events-none absolute left-3 h-[18px] w-[18px] text-ink-4" strokeWidth={2} aria-hidden="true" />
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={SEARCH_PLACEHOLDER}
              autoFocus
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="search"
              // Text field (Figma 472:243): muted fill at rest, white with the
              // brand border on focus — that border is the focus state, so the
              // global focus-visible outline is switched off here.
              className="h-10 w-full rounded-[10px] border border-transparent bg-surface-muted pl-10 pr-10 text-body text-ink-1 placeholder:text-ink-3 outline-none transition-colors focus:border-hockia-primary focus:bg-white focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden"
              data-testid="search-v2-input"
            />
            {query && (
              <button
                type="button"
                onClick={() => { setQuery(''); setDebounced(''); inputRef.current?.focus() }}
                aria-label="Clear search"
                className="absolute right-1 flex h-9 w-9 items-center justify-center rounded-full text-ink-4"
              >
                <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-ink-4 text-white">
                  <X className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
                </span>
              </button>
            )}
          </label>
          <button type="button" onClick={cancel} className="h-11 shrink-0 text-body text-hockia-primary">
            Cancel
          </button>
        </form>
      </div>

      {showAiRow && (
        <button
          type="button"
          onClick={askAi}
          className="flex w-full items-center gap-3 bg-brand-soft px-4 py-3 text-left active:bg-brand-soft-pressed"
          data-testid="search-v2-ask-ai"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-brand-soft-pressed text-hockia-primary">
            <Sparkles className="h-6 w-6" strokeWidth={1.75} aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-body font-semibold text-ink-1">{askAiLabel(query)}</span>
            {/* Caption size so the whole scope line fits beside the tile at 390px. */}
            <span className="block truncate text-caption text-ink-2">{SEARCH_SCOPE_LINE}</span>
          </span>
          <ChevronRight className="h-5 w-5 shrink-0 text-ink-4" strokeWidth={1.75} aria-hidden="true" />
        </button>
      )}

      {!hasQuery ? (
        <div className="px-4 pt-3">
          {!showAiRow && <p className="pb-4 text-secondary text-ink-3">{SEARCH_SCOPE_LINE}</p>}
          {recentSearches.length > 0 && (
            <section aria-label="Recent searches">
              <div className="flex items-center justify-between pb-1">
                <h2 className="flex items-center gap-1.5 text-caption font-semibold uppercase tracking-wide text-ink-3">
                  <Clock className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                  Recent
                </h2>
                <button type="button" onClick={clearAll} className="h-11 px-2 text-secondary font-medium text-hockia-primary">
                  Clear
                </button>
              </div>
              <ul className="divide-y divide-line">
                {recentSearches.map((term) => (
                  <li key={term}>
                    <button
                      type="button"
                      onClick={() => { setQuery(term); setDebounced(term) }}
                      className="flex h-11 w-full items-center gap-3 text-left text-body text-ink-1"
                    >
                      <Search className="h-[18px] w-[18px] shrink-0 text-ink-4" strokeWidth={2} aria-hidden="true" />
                      <span className="truncate">{term}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      ) : isLoading ? (
        <ul aria-busy="true" aria-label="Loading results" data-testid="search-v2-skeleton">
          {Array.from({ length: 5 }, (_, i) => (
            <li key={i} className="flex items-center gap-3 px-4 py-2.5">
              <Skeleton variant="circular" width={48} height={48} />
              <div className="flex-1 space-y-2">
                <Skeleton width="45%" height={16} />
                <Skeleton width="70%" height={13} />
              </div>
              <Skeleton width={52} height={22} className="rounded-full" />
            </li>
          ))}
        </ul>
      ) : rows.length === 0 ? (
        <p className="px-4 py-10 text-center text-row text-ink-2" data-testid="search-v2-empty">
          {noMembersLabel(settled)}
        </p>
      ) : (
        <>
          {/* Inset dividers start at the text (16 + 48 + 12 = 76px). */}
          <ul
            className="divide-y divide-line [&>li+li]:ml-[76px] [&>li+li>button]:-ml-[76px] [&>li+li>button]:w-[calc(100%+76px)]"
            data-testid="search-v2-results"
          >
            {rows.map((row, i) => {
              const country = flags[row.profile_id]
              const meta = memberMetaLine({ role: row.role, position: row.position, currentClub: row.current_club, baseLocation: row.base_location })
              const avatar = getImageUrl(row.avatar_url, 'avatar-sm') ?? row.avatar_url
              return (
                <li key={row.profile_id}>
                  <button
                    type="button"
                    onClick={() => openMember(row, i)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-surface-muted"
                    data-testid="search-v2-row"
                  >
                    <EntityAvatar src={avatar} name={row.full_name} role={row.role} size={48} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body font-semibold text-ink-1">{row.full_name || 'Member'}</span>
                      {(meta || country) && (
                        <span className="flex items-center gap-1.5 text-secondary text-ink-2">
                          {meta && <span className="truncate">{meta}</span>}
                          {country && (
                            <>
                              {meta && <span aria-hidden="true">·</span>}
                              <Flag code={country.code} countryName={country.name} fallbackEmoji={country.flag_emoji} size="sm" className="shrink-0" />
                            </>
                          )}
                        </span>
                      )}
                    </span>
                    <RoleBadge role={row.role} className="shrink-0" />
                  </button>
                </li>
              )
            })}
          </ul>
          <button
            type="button"
            onClick={seeAll}
            className="flex h-12 w-full items-center justify-center text-row font-semibold text-hockia-primary"
            data-testid="search-v2-see-all"
          >
            {seeAllMembersLabel(total)}
          </button>
        </>
      )}
    </div>
  )
}
