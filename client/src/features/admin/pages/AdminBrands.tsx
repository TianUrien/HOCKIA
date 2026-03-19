/**
 * AdminBrands Page
 *
 * Brand analytics dashboard showing brand activity and performance.
 */

import { useEffect, useState, useCallback } from 'react'
import { formatAdminDate } from '../utils/formatDate'
import {
  Store,
  RefreshCw,
  Package,
  FileText,
  BadgeCheck,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react'
import { StatCard } from '../components/StatCard'
import { DataTable } from '../components/DataTable'
import type { Column } from '../components/DataTable'
import { getBrandActivity, getBrandSummary } from '../api/adminApi'
import type { BrandActivity, BrandSummary } from '../types'
import { logger } from '@/lib/logger'

type DaysFilter = 7 | 30 | 90 | null

export function AdminBrands() {
  const [brands, setBrands] = useState<BrandActivity[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [summary, setSummary] = useState<BrandSummary | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [daysFilter, setDaysFilter] = useState<DaysFilter>(30)
  const [page, setPage] = useState(0)
  const pageSize = 20

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const [brandData, summaryData] = await Promise.all([
        getBrandActivity(daysFilter ?? undefined, pageSize, page * pageSize),
        getBrandSummary(),
      ])

      setBrands(brandData.brands)
      setTotalCount(brandData.totalCount)
      setSummary(summaryData)
    } catch (err) {
      logger.error('[AdminBrands] Failed to fetch data:', err)
      setError(err instanceof Error ? err.message : 'Failed to load brand data')
    } finally {
      setIsLoading(false)
    }
  }, [daysFilter, page])

  useEffect(() => {
    document.title = 'Brand Analytics | HOCKIA Admin'
    fetchData()
  }, [fetchData])

  const columns: Column<BrandActivity>[] = [
    {
      key: 'brand_name',
      label: 'Brand',
      render: (_, row) => (
        <div className="flex items-center gap-3">
          {row.logo_url ? (
            <img
              src={row.logo_url}
              alt=""
              className="w-8 h-8 rounded-full object-cover"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
              <Store className="w-4 h-4 text-gray-400" />
            </div>
          )}
          <div>
            <p className="font-medium text-gray-900">{row.brand_name || 'Unknown'}</p>
            <span className="inline-flex px-1.5 py-0.5 text-xs rounded bg-gray-100 text-gray-600 capitalize">
              {row.category}
            </span>
          </div>
        </div>
      ),
    },
    {
      key: 'product_count',
      label: 'Products',
      render: (value) => (
        <span className="text-sm font-medium text-gray-900">{Number(value)}</span>
      ),
    },
    {
      key: 'post_count',
      label: 'Posts',
      render: (value) => (
        <span className="text-sm font-medium text-gray-900">{Number(value)}</span>
      ),
    },
    {
      key: 'is_verified',
      label: 'Verified',
      render: (value) =>
        value ? (
          <span className="text-green-600 text-sm">Yes</span>
        ) : (
          <span className="text-gray-400 text-sm">No</span>
        ),
    },
    {
      key: 'created_at',
      label: 'Created',
      render: (value) => (
        <span className="text-sm text-gray-600">
          {formatAdminDate(value as string)}
        </span>
      ),
    },
    {
      key: 'last_activity_at',
      label: 'Last Activity',
      render: (value) => (
        <span className="text-sm text-gray-600">
          {formatAdminDate(value as string)}
        </span>
      ),
    },
    {
      key: 'slug',
      label: '',
      render: (_, row) => (
        <a
          href={`/brands/${row.slug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors inline-flex"
        >
          <ExternalLink className="w-4 h-4 text-gray-400" />
        </a>
      ),
    },
  ]

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-3" />
        <h2 className="text-lg font-semibold text-red-800 mb-2">Failed to load brand data</h2>
        <p className="text-sm text-red-600 mb-4">{error}</p>
        <button
          onClick={fetchData}
          className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
        >
          Try Again
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Brand Analytics</h1>
          <p className="text-sm text-gray-500 mt-1">
            Monitor brand activity, products, and posts
          </p>
        </div>
        <button
          onClick={fetchData}
          disabled={isLoading}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Brands"
          value={summary?.total_brands ?? 0}
          icon={Store}
          color="purple"
          loading={isLoading}
        />
        <StatCard
          label="With Products"
          value={summary?.brands_with_products ?? 0}
          icon={Package}
          color="blue"
          loading={isLoading}
        />
        <StatCard
          label="Verified"
          value={summary?.verified_brands ?? 0}
          icon={BadgeCheck}
          color="green"
          loading={isLoading}
        />
        <StatCard
          label="Total Content"
          value={(summary?.total_products ?? 0) + (summary?.total_posts ?? 0)}
          icon={FileText}
          color="amber"
          loading={isLoading}
        />
      </div>

      {/* Activity Timeline */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-medium text-gray-500 mb-2">Last 7 Days</h3>
          <p className="text-3xl font-bold text-gray-900">{summary?.brands_7d ?? 0}</p>
          <p className="text-xs text-gray-500 mt-1">new brands created</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-medium text-gray-500 mb-2">Last 30 Days</h3>
          <p className="text-3xl font-bold text-gray-900">{summary?.brands_30d ?? 0}</p>
          <p className="text-xs text-gray-500 mt-1">new brands created</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-medium text-gray-500 mb-2">Content Split</h3>
          <div className="flex items-baseline gap-4">
            <div>
              <p className="text-3xl font-bold text-gray-900">{summary?.total_products ?? 0}</p>
              <p className="text-xs text-gray-500 mt-1">products</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-gray-900">{summary?.total_posts ?? 0}</p>
              <p className="text-xs text-gray-500 mt-1">posts</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 bg-white p-4 rounded-xl border border-gray-200">
        <label htmlFor="brands-period-filter" className="text-sm text-gray-600">Show brands created in:</label>
        <select
          id="brands-period-filter"
          aria-label="Filter by creation period"
          value={daysFilter ?? 'all'}
          onChange={(e) => {
            const val = e.target.value
            setDaysFilter(val === 'all' ? null : Number(val) as DaysFilter)
            setPage(0)
          }}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-500"
        >
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
          <option value="all">All time</option>
        </select>
      </div>

      {/* Brand Activity Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 className="font-semibold text-gray-900">
            Brand Activity ({totalCount})
          </h2>
        </div>

        <DataTable
          data={brands}
          columns={columns}
          keyField="brand_id"
          loading={isLoading}
          emptyMessage="No brands found in this period"
        />

        {/* Pagination */}
        {totalCount > pageSize && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
            <p className="text-sm text-gray-600">
              Showing {page * pageSize + 1} - {Math.min((page + 1) * pageSize, totalCount)} of {totalCount}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-50 hover:bg-gray-50"
              >
                Previous
              </button>
              <button
                onClick={() => setPage(p => p + 1)}
                disabled={(page + 1) * pageSize >= totalCount}
                className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg disabled:opacity-50 hover:bg-gray-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
