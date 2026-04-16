import { useState, useCallback, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Loader2, SearchX } from 'lucide-react'
import { Header } from '@/components'
import { SearchBar } from '@/components/search/SearchBar'
import { SearchPostResult } from '@/components/search/SearchPostResult'
import { SearchPersonResult } from '@/components/search/SearchPersonResult'
import { SearchClubResult } from '@/components/search/SearchClubResult'
import { SearchBrandResult } from '@/components/search/SearchBrandResult'
import { SearchOpportunityResult } from '@/components/search/SearchOpportunityResult'
import { useSearch } from '@/hooks/useSearch'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { trackSearch } from '@/lib/analytics'
import type { SearchResult } from '@/hooks/useSearch'

type TabType = 'all' | 'posts' | 'people' | 'clubs' | 'brands' | 'opportunities'

const TABS: { key: TabType; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'posts', label: 'Posts' },
  { key: 'people', label: 'People' },
  { key: 'clubs', label: 'Clubs' },
  { key: 'brands', label: 'Brands' },
  { key: 'opportunities', label: 'Opportunities' },
]

export default function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialQuery = searchParams.get('q') || ''
  const initialType = (searchParams.get('type') as TabType) || 'all'

  const [query, setQuery] = useState(initialQuery)
  const [activeTab, setActiveTab] = useState<TabType>(initialType)

  const rpcType = activeTab === 'all' ? null : activeTab
  const {
    data,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useSearch(query, rpcType)

  // Update URL params when query or tab changes
  useEffect(() => {
    const params: Record<string, string> = {}
    if (query) params.q = query
    if (activeTab !== 'all') params.type = activeTab
    setSearchParams(params, { replace: true })
  }, [query, activeTab, setSearchParams])

  const handleQueryChange = useCallback((newQuery: string) => {
    setQuery(newQuery)
  }, [])

  const handleTabChange = useCallback((tab: TabType) => {
    setActiveTab(tab)
  }, [])

  // Track search when first page of results arrives for a query
  const lastTrackedQuery = useRef('')
  useEffect(() => {
    if (!data?.pages?.[0] || !query || query === lastTrackedQuery.current) return
    lastTrackedQuery.current = query
    trackDbEvent('search', undefined, undefined, {
      search_type: activeTab,
      search_term: query,
      result_count: data.pages[0].total,
    })
    trackSearch(activeTab, query)
  }, [data?.pages, query, activeTab])

  // Flatten all pages' results
  const results: SearchResult[] = data?.pages.flatMap((page) => page.results) ?? []
  const typeCounts = data?.pages[0]?.type_counts

  const trackResultClick = useCallback((result: SearchResult, index: number) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accessing subtype-specific properties
    const r = result as any
    const entityId = r.profile_id || r.post_id || r.world_club_id || r.brand_id || r.opportunity_id
    trackDbEvent('search_result_click', result.result_type, entityId ?? undefined, {
      query,
      position: index,
      result_type: result.result_type,
    })
  }, [query])

  const renderResult = (result: SearchResult, index: number) => {
    const handleClick = () => trackResultClick(result, index)
    switch (result.result_type) {
      case 'post':
        return <div key={`post-${result.post_id}-${index}`} onClick={handleClick}><SearchPostResult result={result} /></div>
      case 'person':
        return <div key={`person-${result.profile_id}-${index}`} onClick={handleClick}><SearchPersonResult result={result} /></div>
      case 'club':
        return <div key={`club-${result.world_club_id}-${index}`} onClick={handleClick}><SearchClubResult result={result} /></div>
      case 'brand':
        return <div key={`brand-${result.brand_id}-${index}`} onClick={handleClick}><SearchBrandResult result={result} /></div>
      case 'opportunity':
        return <div key={`opp-${result.opportunity_id}-${index}`} onClick={handleClick}><SearchOpportunityResult result={result} /></div>
      default:
        return null
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />

      <main className="max-w-2xl mx-auto px-4 md:px-6 pt-24 pb-24">
        {/* Search bar */}
        <div className="mb-4">
          <SearchBar
            autoFocus
            initialQuery={query}
            onQueryChange={handleQueryChange}
          />
        </div>

        {/* Tab filters */}
        {query.length >= 2 && (
          <div className="flex gap-1 mb-4 overflow-x-auto pb-1">
            {TABS.map((tab) => {
              const count = typeCounts
                ? tab.key === 'all'
                  ? typeCounts.posts + typeCounts.people + typeCounts.clubs + (typeCounts.brands ?? 0) + (typeCounts.opportunities ?? 0)
                  : typeCounts[tab.key as keyof typeof typeCounts]
                : null

              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => handleTabChange(tab.key)}
                  className={`px-4 py-1.5 text-sm font-medium rounded-full whitespace-nowrap transition-colors ${
                    activeTab === tab.key
                      ? 'bg-[#8026FA] text-white'
                      : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {tab.label}
                  {count != null && count > 0 && (
                    <span className={`ml-1.5 text-xs ${activeTab === tab.key ? 'text-white/70' : 'text-gray-400'}`}>
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}

        {/* Results */}
        {query.length < 2 ? (
          <div className="text-center py-16 text-gray-500">
            <SearchX className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p className="text-sm">Enter at least 2 characters to search</p>
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-[#8026FA]" />
          </div>
        ) : results.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <SearchX className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p className="text-sm font-medium">No results found</p>
            <p className="text-xs mt-1">Try different keywords or check the spelling</p>
          </div>
        ) : (
          <div className="space-y-3">
            {results.map((result, i) => renderResult(result, i))}

            {/* Load more */}
            {hasNextPage && (
              <div className="flex justify-center pt-2">
                <button
                  type="button"
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                  className="px-6 py-2 text-sm font-medium text-[#8026FA] bg-white border border-gray-200 rounded-full hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  {isFetchingNextPage ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    'Load more'
                  )}
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
