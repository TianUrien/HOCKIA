/**
 * BrandListView
 *
 * Brand directory for the Community page Brands tab.
 * Extracted from BrandsPage.tsx BrandDirectory component.
 */

import { useRef, useEffect } from 'react'
import { Search, Store, Loader2 } from 'lucide-react'
import { BrandCardSkeleton } from '@/components/Skeleton'
import { BrandCard, BrandCategoryFilter } from '@/components/brands'
import { useBrands, type BrandCategory } from '@/hooks/useBrands'
import { usePageState } from '@/hooks/usePageState'
import { useScrollRestore } from '@/hooks/useScrollRestore'

export function BrandListView() {
  const [category, setCategory] = usePageState<BrandCategory | null>('brand-category', null)
  const [search, setSearch] = usePageState('brand-search', '')
  const [searchInput, setSearchInput] = usePageState('brand-searchInput', '')

  const sentinelRef = useRef<HTMLDivElement>(null)

  const { brands, isLoading, error, total, hasMore, loadMore } = useBrands({
    category,
    search: search || null,
  })

  useScrollRestore(!isLoading || brands.length > 0)

  // Infinite scroll via IntersectionObserver
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasMore && !isLoading) {
          loadMore()
        }
      },
      { rootMargin: '200px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMore, isLoading, loadMore])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setSearch(searchInput)
  }

  return (
    <>
      {/* Search */}
      <form onSubmit={handleSearch} className="mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="search"
            data-keyboard-shortcut="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search brands..."
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            autoComplete="off"
            enterKeyHint="search"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>
      </form>

      {/* Category Filter */}
      <div className="mb-6">
        <BrandCategoryFilter value={category} onChange={setCategory} />
      </div>

      {/* Results Count */}
      {!isLoading && (
        <p className="text-sm text-gray-500 mb-4">
          {total} {total === 1 ? 'brand' : 'brands'} found
        </p>
      )}

      {/* Error State */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-600">
          {error}
        </div>
      )}

      {/* Loading State */}
      {isLoading && brands.length === 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
          {Array.from({ length: 8 }, (_, i) => (
            <BrandCardSkeleton key={i} />
          ))}
        </div>
      )}

      {/* Empty State */}
      {!isLoading && brands.length === 0 && !error && (
        <div className="text-center py-12">
          <Store className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            No brands found
          </h3>
          <p className="text-gray-500">
            {search
              ? 'Try adjusting your search terms'
              : 'Be the first to register your brand!'}
          </p>
        </div>
      )}

      {/* Brands Grid */}
      {brands.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
          {brands.map((brand) => (
            <BrandCard key={brand.id} brand={brand} />
          ))}
        </div>
      )}

      {/* Infinite scroll sentinel */}
      {hasMore && <div ref={sentinelRef} className="h-1" />}
      {hasMore && (
        <div className="mt-6 flex items-center justify-center">
          <Loader2 className="w-6 h-6 text-hockia-primary animate-spin" />
        </div>
      )}
    </>
  )
}
