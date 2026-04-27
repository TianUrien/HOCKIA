/**
 * BrandsPage — rendered at /marketplace.
 *
 * Canonical brand-discovery surface for HOCKIA. Two tabs:
 *   1. Global Feed — reverse-chronological feed of products and posts from all brands
 *   2. Brand Directory — structured browse/search by category
 *
 * Mounted at /marketplace; legacy /brands and /community/brands redirect here.
 * Filename kept as BrandsPage for git continuity (the export name is what
 * matters for routing). A future product-grid-first redesign may rename and
 * restructure this file.
 */

import { useState } from 'react'
import { Search, Store, Loader2, Rss, Grid3X3 } from 'lucide-react'
import { BrandCardSkeleton } from '@/components/Skeleton'
import { useSearchParams } from 'react-router-dom'
import { Header, Layout } from '@/components'
import { BrandCard, BrandCategoryFilter, GlobalBrandFeed } from '@/components/brands'
import { useBrands, type BrandCategory } from '@/hooks/useBrands'

type PageTab = 'feed' | 'directory'

export default function BrandsPage() {
  const [searchParams, setSearchParams] = useSearchParams()

  const [activeTab, setActiveTab] = useState<PageTab>(() => {
    const param = searchParams.get('view')
    return param === 'directory' ? 'directory' : 'feed'
  })

  const handleTabChange = (tab: PageTab) => {
    setActiveTab(tab)
    const next = new URLSearchParams(searchParams)
    if (tab === 'feed') {
      next.delete('view')
    } else {
      next.set('view', tab)
    }
    setSearchParams(next, { replace: true })
  }

  return (
    <Layout>
      <Header />

      <div className="flex-1">
        <div className="max-w-6xl mx-auto px-4 pt-24 pb-12">
          {/* Page Header */}
          <div className="mb-6">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
              Marketplace
            </h1>
            <p className="text-gray-600 mt-1">
              Discover hockey gear, products, and services from brands on HOCKIA
            </p>
          </div>

          {/* Tab Switcher */}
          <div className="flex gap-1 p-1 bg-gray-100 rounded-lg mb-6 w-fit">
            <button
              onClick={() => handleTabChange('feed')}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'feed'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <Rss className="w-4 h-4" />
              Feed
            </button>
            <button
              onClick={() => handleTabChange('directory')}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === 'directory'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <Grid3X3 className="w-4 h-4" />
              Directory
            </button>
          </div>

          {/* Tab Content */}
          {activeTab === 'feed' && (
            <div className="max-w-2xl mx-auto">
              <GlobalBrandFeed />
            </div>
          )}

          {activeTab === 'directory' && (
            <BrandDirectory />
          )}
        </div>
      </div>
    </Layout>
  )
}

/**
 * BrandDirectory
 *
 * The original brand directory (search + category filter + grid).
 * Extracted as a sub-component to keep state isolated per tab.
 */
function BrandDirectory() {
  const [category, setCategory] = useState<BrandCategory | null>(null)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')

  const { brands, isLoading, error, total, hasMore, loadMore } = useBrands({
    category,
    search: search || null,
  })

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

      {/* Load More */}
      {hasMore && !isLoading && (
        <div className="mt-8 text-center">
          <button
            onClick={loadMore}
            className="px-6 py-2 bg-white border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Load more
          </button>
        </div>
      )}

      {/* Loading More */}
      {isLoading && brands.length > 0 && (
        <div className="mt-8 flex items-center justify-center">
          <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
        </div>
      )}
    </>
  )
}
