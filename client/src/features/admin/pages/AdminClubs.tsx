/**
 * AdminClubs Page
 * 
 * Club analytics dashboard showing posting activity and performance.
 */

import { useEffect, useState, useCallback } from 'react'
import { formatAdminDate } from '../utils/formatDate'
import { Link } from 'react-router-dom'
import {
  Building2,
  RefreshCw,
  Briefcase,
  Users,
  TrendingUp,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react'
import { StatCard } from '../components/StatCard'
import { DataTable } from '../components/DataTable'
import type { Column } from '../components/DataTable'
import { getClubActivity, getClubSummary } from '../api/adminApi'
import type { ClubActivity, ClubSummary } from '../types'
import { logger } from '@/lib/logger'

type DaysFilter = 7 | 30 | 90 | null

export function AdminClubs() {
  const [clubs, setClubs] = useState<ClubActivity[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [summary, setSummary] = useState<ClubSummary | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [daysFilter, setDaysFilter] = useState<DaysFilter>(30)
  const [page, setPage] = useState(0)
  const pageSize = 20

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    
    try {
      const [clubData, summaryData] = await Promise.all([
        getClubActivity(daysFilter ?? undefined, pageSize, page * pageSize),
        getClubSummary(),
      ])
      
      setClubs(clubData.clubs)
      setTotalCount(clubData.totalCount)
      setSummary(summaryData)
    } catch (err) {
      logger.error('[AdminClubs] Failed to fetch data:', err)
      setError(err instanceof Error ? err.message : 'Failed to load club data')
    } finally {
      setIsLoading(false)
    }
  }, [daysFilter, page])

  useEffect(() => {
    document.title = 'Club Analytics | HOCKIA Admin'
    fetchData()
  }, [fetchData])

  const columns: Column<ClubActivity>[] = [
    {
      key: 'club_name',
      label: 'Club',
      render: (_, row) => (
        <div className="flex items-center gap-3">
          {row.avatar_url ? (
            <img
              src={row.avatar_url}
              alt=""
              className="w-8 h-8 rounded-full object-cover"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
              <Building2 className="w-4 h-4 text-gray-400" />
            </div>
          )}
          <div>
            <p className="font-medium text-gray-900">{row.club_name || 'Unknown'}</p>
            <p className="text-xs text-gray-500">{row.base_location || 'No location'}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'vacancy_count',
      label: 'Vacancies',
      render: (_, row) => (
        <div className="text-sm">
          <span className="font-medium text-gray-900">{row.vacancy_count}</span>
          {row.open_vacancy_count > 0 && (
            <span className="text-xs text-green-600 ml-1">({row.open_vacancy_count} open)</span>
          )}
        </div>
      ),
    },
    {
      key: 'total_applications',
      label: 'Applications',
      render: (value) => (
        <span className="text-sm font-medium text-gray-900">{Number(value)}</span>
      ),
    },
    {
      key: 'avg_apps_per_vacancy',
      label: 'Avg Apps/Vacancy',
      render: (value) => (
        <span className="text-sm text-gray-600">
          {value ? Number(value).toFixed(1) : '—'}
        </span>
      ),
    },
    {
      key: 'last_posted_at',
      label: 'Last Posted',
      render: (value) => (
        <span className="text-sm text-gray-600">
          {formatAdminDate(value as string)}
        </span>
      ),
    },
    {
      key: 'onboarding_completed',
      label: 'Onboarded',
      render: (value) =>
        value ? (
          <span className="text-green-600 text-sm">Yes</span>
        ) : (
          <span className="text-gray-400 text-sm">No</span>
        ),
    },
    {
      key: 'club_id',
      label: '',
      render: (_, row) => (
        <Link
          to={`/admin/directory?id=${row.club_id}`}
          className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors inline-flex"
        >
          <ExternalLink className="w-4 h-4 text-gray-400" />
        </Link>
      ),
    },
  ]

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-3" />
        <h2 className="text-lg font-semibold text-red-800 mb-2">Failed to load club data</h2>
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
          <h1 className="text-2xl font-bold text-gray-900">Club Analytics</h1>
          <p className="text-sm text-gray-500 mt-1">
            Monitor club posting activity and engagement
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
          label="Total Clubs"
          value={summary?.total_clubs ?? 0}
          icon={Building2}
          color="purple"
          loading={isLoading}
        />
        <StatCard
          label="Clubs with Vacancies"
          value={summary?.clubs_with_vacancies ?? 0}
          icon={Briefcase}
          color="blue"
          loading={isLoading}
        />
        <StatCard
          label="Active (30d)"
          value={summary?.active_clubs_30d ?? 0}
          icon={TrendingUp}
          color="green"
          loading={isLoading}
        />
        <StatCard
          label="Avg Vacancies/Club"
          value={summary?.avg_vacancies_per_active_club ?? 0}
          icon={Users}
          color="amber"
          loading={isLoading}
        />
      </div>

      {/* Activity Timeline */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-medium text-gray-500 mb-2">Last 7 Days</h3>
          <p className="text-3xl font-bold text-gray-900">{summary?.active_clubs_7d ?? 0}</p>
          <p className="text-xs text-gray-500 mt-1">clubs posted vacancies</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-medium text-gray-500 mb-2">Last 30 Days</h3>
          <p className="text-3xl font-bold text-gray-900">{summary?.active_clubs_30d ?? 0}</p>
          <p className="text-xs text-gray-500 mt-1">clubs posted vacancies</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-medium text-gray-500 mb-2">Last 90 Days</h3>
          <p className="text-3xl font-bold text-gray-900">{summary?.active_clubs_90d ?? 0}</p>
          <p className="text-xs text-gray-500 mt-1">clubs posted vacancies</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 bg-white p-4 rounded-xl border border-gray-200">
        <label htmlFor="clubs-period-filter" className="text-sm text-gray-600">Show clubs active in:</label>
        <select
          id="clubs-period-filter"
          aria-label="Filter by activity period"
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

      {/* Club Activity Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 className="font-semibold text-gray-900">
            Top Posting Clubs ({totalCount})
          </h2>
        </div>
        
        <DataTable
          data={clubs}
          columns={columns}
          keyField="club_id"
          loading={isLoading}
          emptyMessage="No active clubs found in this period"
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
