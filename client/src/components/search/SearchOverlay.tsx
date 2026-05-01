/**
 * SearchOverlay
 *
 * Three-state search experience for the Home page:
 *   RESTING  → tappable pill that triggers the overlay
 *   FOCUSED  → full-screen overlay with recent searches
 *   RESULTS  → live results streaming as the user types
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Search, ArrowLeft, X, Clock, Loader2, SearchX, Shield, ChevronRight, Briefcase, MapPin } from 'lucide-react'
import { Avatar, RoleBadge } from '@/components'
import { useSearch } from '@/hooks/useSearch'
import { useRecentSearches } from '@/hooks/useRecentSearches'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import type { SearchResult, SearchPostResult, SearchPersonResult, SearchClubResult, SearchOpportunityResult as SearchOpportunityResultType } from '@/hooks/useSearch'

type TabType = 'all' | 'posts' | 'people' | 'clubs' | 'opportunities'

const TABS: { key: TabType; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'people', label: 'People' },
  { key: 'clubs', label: 'Clubs' },
  { key: 'posts', label: 'Posts' },
  { key: 'opportunities', label: 'Opps' },
]

function getFlagUrl(countryCode: string): string {
  return `https://flagcdn.com/w40/${countryCode.toLowerCase()}.png`
}

// ── Compact result renderers ──────────────────────────────────────────

function CompactPersonRow({ result, onSelect }: { result: SearchPersonResult; onSelect: () => void }) {
  const subtitle = [result.position, result.base_location, result.current_club]
    .filter(Boolean)
    .join(' · ')

  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex items-center gap-3 w-full px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors text-left"
    >
      <Avatar
        src={result.avatar_url}
        initials={result.full_name?.slice(0, 2) || '?'}
        size="sm"
        role={result.role}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-900 truncate">
            {result.full_name || 'Unknown'}
          </span>
          <RoleBadge role={result.role as 'player' | 'coach' | 'club' | 'brand' | 'umpire'} />
        </div>
        {subtitle && (
          <p className="text-xs text-gray-500 truncate">{subtitle}</p>
        )}
      </div>
      <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
    </button>
  )
}

function CompactClubRow({ result, onSelect }: { result: SearchClubResult; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex items-center gap-3 w-full px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors text-left"
    >
      <div className="w-8 h-8 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center overflow-hidden flex-shrink-0">
        {result.avatar_url ? (
          <img src={result.avatar_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <Shield className="w-4 h-4 text-gray-400" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900 truncate">{result.club_name}</p>
        <div className="flex items-center gap-1.5">
          <img
            src={getFlagUrl(result.country_code)}
            alt=""
            className="w-3.5 h-2.5 object-cover rounded-sm"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
          <span className="text-xs text-gray-500">{result.country_name}</span>
        </div>
      </div>
      {result.is_claimed && (
        <span className="text-[10px] font-medium text-[#8026FA] bg-[#8026FA]/10 px-2 py-0.5 rounded-full flex-shrink-0">
          On HOCKIA
        </span>
      )}
      <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
    </button>
  )
}

function CompactPostRow({ result, onSelect }: { result: SearchPostResult; onSelect: () => void }) {
  const preview = result.content.length > 80
    ? result.content.slice(0, 80) + '...'
    : result.content

  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex items-center gap-3 w-full px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors text-left"
    >
      <Avatar
        src={result.author_avatar}
        initials={result.author_name?.slice(0, 2) || '?'}
        size="sm"
        role={result.author_role}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-900 truncate">
            {result.author_name || 'Unknown'}
          </span>
          <RoleBadge role={result.author_role as 'player' | 'coach' | 'club' | 'brand' | 'umpire'} />
        </div>
        <p className="text-xs text-gray-500 truncate">{preview}</p>
      </div>
      <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
    </button>
  )
}

function CompactOpportunityRow({ result, onSelect }: { result: SearchOpportunityResultType; onSelect: () => void }) {
  const location = [result.location_city, result.location_country].filter(Boolean).join(', ')

  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex items-center gap-3 w-full px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors text-left"
    >
      <div className="w-8 h-8 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center overflow-hidden flex-shrink-0">
        {result.club_avatar_url ? (
          <img src={result.club_avatar_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <Briefcase className="w-4 h-4 text-gray-400" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900 truncate">{result.title}</p>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-500 truncate">{result.club_name}</span>
          {location && (
            <>
              <span className="text-xs text-gray-300">&middot;</span>
              <span className="text-xs text-gray-400 truncate flex items-center gap-0.5">
                <MapPin className="w-3 h-3" />
                {location}
              </span>
            </>
          )}
        </div>
      </div>
      <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
    </button>
  )
}

// ── Main overlay component ────────────────────────────────────────────

export function SearchOverlay() {
  const navigate = useNavigate()
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [activeTab, setActiveTab] = useState<TabType>('all')

  const overlayRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { recentSearches, addSearch, clearAll } = useRecentSearches()

  // Focus trap
  useFocusTrap({ containerRef: overlayRef, isActive: isOpen, initialFocusRef: inputRef })

  // Debounce query → debouncedQuery
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(query)
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query])

  // Search hook (only fires when debouncedQuery ≥ 2 chars)
  const rpcType = activeTab === 'all' ? null : activeTab
  const { data, isLoading } = useSearch(debouncedQuery, rpcType)

  const results: SearchResult[] = data?.pages.flatMap((page) => page.results) ?? []
  const typeCounts = data?.pages[0]?.type_counts

  // Scroll lock + escape key
  useEffect(() => {
    if (!isOpen) return

    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = originalOverflow
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  // Global `/` shortcut to open overlay
  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !isOpen) {
        const tag = (e.target as HTMLElement).tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return
        e.preventDefault()
        setIsOpen(true)
      }
    }
    document.addEventListener('keydown', handleGlobalKey)
    return () => document.removeEventListener('keydown', handleGlobalKey)
  }, [isOpen])

  const handleClose = useCallback(() => {
    setIsOpen(false)
    setQuery('')
    setDebouncedQuery('')
    setActiveTab('all')
  }, [])

  const handleClear = useCallback(() => {
    setQuery('')
    setDebouncedQuery('')
    inputRef.current?.focus()
  }, [])

  const handleSelectRecentSearch = useCallback((term: string) => {
    setQuery(term)
    setDebouncedQuery(term)
  }, [])

  const navigateToResult = useCallback((path: string) => {
    if (query.trim().length >= 2) {
      addSearch(query.trim())
    }
    handleClose()
    navigate(path)
  }, [query, addSearch, handleClose, navigate])

  const handleResultClick = useCallback((result: SearchResult) => {
    switch (result.result_type) {
      case 'person': {
        const path = result.role === 'club'
          ? `/clubs/id/${result.profile_id}?ref=search`
          : result.role === 'brand'
            ? `/brands/${result.profile_id}?ref=search`
            : result.role === 'umpire'
              ? `/umpires/id/${result.profile_id}?ref=search`
              : `/players/id/${result.profile_id}?ref=search`
        navigateToResult(path)
        break
      }
      case 'club': {
        if (result.claimed_profile_id) {
          navigateToResult(`/clubs/id/${result.claimed_profile_id}?ref=search`)
        }
        break
      }
      case 'post': {
        // Navigate to the post author's profile
        const authorPath = result.author_role === 'club'
          ? `/clubs/id/${result.author_id}`
          : result.author_role === 'brand'
            ? `/brands/${result.author_id}`
            : result.author_role === 'umpire'
              ? `/umpires/id/${result.author_id}`
              : `/players/id/${result.author_id}`
        navigateToResult(authorPath)
        break
      }
      case 'opportunity': {
        navigateToResult(`/opportunities/${result.opportunity_id}`)
        break
      }
    }
  }, [navigateToResult])

  const handleSeeAllResults = useCallback(() => {
    if (query.trim().length >= 2) {
      addSearch(query.trim())
    }
    handleClose()
    navigate(`/search?q=${encodeURIComponent(query.trim())}`)
  }, [query, addSearch, handleClose, navigate])

  const renderResult = (result: SearchResult, index: number) => {
    const onSelect = () => handleResultClick(result)

    switch (result.result_type) {
      case 'person':
        return <CompactPersonRow key={`person-${result.profile_id}-${index}`} result={result} onSelect={onSelect} />
      case 'club':
        return <CompactClubRow key={`club-${result.world_club_id}-${index}`} result={result} onSelect={onSelect} />
      case 'post':
        return <CompactPostRow key={`post-${result.post_id}-${index}`} result={result} onSelect={onSelect} />
      case 'opportunity':
        return <CompactOpportunityRow key={`opp-${result.opportunity_id}-${index}`} result={result} onSelect={onSelect} />
      default:
        return null
    }
  }

  const hasQuery = debouncedQuery.length >= 2

  // ── RESTING state: search pill ──────────────────────────────────────

  const pill = (
    <button
      type="button"
      onClick={() => setIsOpen(true)}
      className="w-full flex items-center gap-2.5 px-4 py-2.5 bg-gray-100 border border-gray-200 rounded-full text-sm text-gray-500 hover:bg-gray-50 hover:border-gray-300 transition-colors"
    >
      <Search className="w-4 h-4 text-gray-400" />
      <span>Search players, clubs, posts...</span>
    </button>
  )

  // ── FOCUSED + RESULTS state: overlay ────────────────────────────────

  const overlay = isOpen
    ? createPortal(
        <div
          ref={overlayRef}
          className="fixed inset-0 z-50 bg-white flex flex-col animate-fade-in"
          role="dialog"
          aria-modal="true"
          aria-label="Search"
          tabIndex={-1}
        >
          {/* Header bar */}
          <div className="flex items-center gap-2 px-3 py-3 border-b border-gray-200 flex-shrink-0">
            <button
              type="button"
              onClick={handleClose}
              className="p-1.5 text-gray-500 hover:text-gray-700 transition-colors rounded-full hover:bg-gray-100"
              aria-label="Close search"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>

            <form onSubmit={(e) => { e.preventDefault(); if (query.trim().length >= 2) handleSeeAllResults(); else inputRef.current?.blur() }} className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              <input
                ref={inputRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search players, clubs, posts..."
                className="w-full pl-9 pr-9 py-2 text-sm bg-gray-100 rounded-full focus:outline-none focus:ring-2 focus:ring-[#8026FA]/30 focus:bg-white focus:border-[#8026FA] border border-transparent transition-colors"
                autoComplete="off"
                autoFocus
                enterKeyHint="search"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
              {query && (
                <button
                  type="button"
                  onClick={handleClear}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-600 transition-colors"
                  aria-label="Clear search"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </form>
          </div>

          {/* Tab bar (visible when searching) */}
          {hasQuery && (
            <div className="flex gap-1 px-4 py-2 border-b border-gray-100 overflow-x-auto flex-shrink-0">
              {TABS.map((tab) => {
                const count = typeCounts
                  ? tab.key === 'all'
                    ? typeCounts.posts + typeCounts.people + typeCounts.clubs + (typeCounts.opportunities ?? 0)
                    : typeCounts[tab.key as keyof typeof typeCounts]
                  : null

                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveTab(tab.key)}
                    className={`px-3.5 py-1.5 text-xs font-medium rounded-full whitespace-nowrap transition-colors ${
                      activeTab === tab.key
                        ? 'bg-[#8026FA] text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {tab.label}
                    {count != null && count > 0 && (
                      <span className={`ml-1 ${activeTab === tab.key ? 'text-white/70' : 'text-gray-400'}`}>
                        {count}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )}

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto">
            {hasQuery ? (
              // ── RESULTS state ──
              isLoading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-6 h-6 animate-spin text-[#8026FA]" />
                </div>
              ) : results.length === 0 ? (
                <div className="text-center py-16 text-gray-500">
                  <SearchX className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                  <p className="text-sm font-medium">No results found</p>
                  <p className="text-xs mt-1 text-gray-400">Try different keywords or check the spelling</p>
                </div>
              ) : (
                <>
                  {results.map((result, i) => renderResult(result, i))}

                  {/* See all results */}
                  <button
                    type="button"
                    onClick={handleSeeAllResults}
                    className="w-full px-4 py-3.5 text-sm font-medium text-[#8026FA] hover:bg-gray-50 transition-colors text-center"
                  >
                    See all results for &ldquo;{debouncedQuery}&rdquo;
                  </button>
                </>
              )
            ) : (
              // ── FOCUSED state (discovery) ──
              <div className="px-4 pt-4">
                {recentSearches.length > 0 ? (
                  <>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500 uppercase tracking-wide">
                        <Clock className="w-3.5 h-3.5" />
                        Recent searches
                      </div>
                      <button
                        type="button"
                        onClick={clearAll}
                        className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                      >
                        Clear
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {recentSearches.map((term) => (
                        <button
                          key={term}
                          type="button"
                          onClick={() => handleSelectRecentSearch(term)}
                          className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-full hover:bg-gray-200 transition-colors"
                        >
                          {term}
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="text-center py-12 text-gray-400">
                    <Search className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                    <p className="text-sm">Start typing to search players, clubs, and posts</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>,
        document.body,
      )
    : null

  return (
    <>
      {pill}
      {overlay}
    </>
  )
}
