/**
 * AdminVacancies Page
 * 
 * Vacancy management dashboard with filtering, stats, and drill-down.
 */

import { useEffect, useState, useCallback } from 'react'
import { formatAdminDate } from '../utils/formatDate'
import { Link } from 'react-router-dom'
import {
  Briefcase,
  RefreshCw,
  ChevronRight,
  Filter,
  Building2,
  Users,
  Clock,
  AlertTriangle,
} from 'lucide-react'
import { StatCard } from '../components/StatCard'
import { DataTable } from '../components/DataTable'
import type { Column } from '../components/DataTable'
import { getVacancies, getExtendedDashboardStats } from '../api/adminApi'
import type { VacancyListItem, ExtendedDashboardStats, VacancySearchParams } from '../types'
import { logger } from '@/lib/logger'

type StatusFilter = 'all' | 'draft' | 'open' | 'closed'
type DaysFilter = 7 | 30 | 90 | null

export function AdminOpportunities() {
  const [vacancies, setVacancies] = useState<VacancyListItem[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [stats, setStats] = useState<ExtendedDashboardStats | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // Filters
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [daysFilter, setDaysFilter] = useState<DaysFilter>(30)
  const [page, setPage] = useState(0)
  const pageSize = 20

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    
    try {
      const params: VacancySearchParams = {
        status: statusFilter === 'all' ? undefined : statusFilter,
        days: daysFilter ?? undefined,
        limit: pageSize,
        offset: page * pageSize,
      }
      
      const [vacancyData, statsData] = await Promise.all([
        getVacancies(params),
        getExtendedDashboardStats(),
      ])
      
      setVacancies(vacancyData.vacancies)
      setTotalCount(vacancyData.totalCount)
      setStats(statsData)
    } catch (err) {
      logger.error('[AdminVacancies] Failed to fetch data:', err)
      setError(err instanceof Error ? err.message : 'Failed to load vacancies')
    } finally {
      setIsLoading(false)
    }
  }, [statusFilter, daysFilter, page])

  useEffect(() => {
    document.title = 'Vacancies | HOCKIA Admin'
    fetchData()
  }, [fetchData])

  const columns: Column<VacancyListItem>[] = [
    {
      key: 'title',
      label: 'Vacancy',
      render: (_, row) => (
        <div className="flex items-center gap-3">
          {row.club_avatar_url ? (
            <img
              src={row.club_avatar_url}
              alt=""
              className="w-8 h-8 rounded-full object-cover"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
              <Building2 className="w-4 h-4 text-gray-400" />
            </div>
          )}
          <div>
            <p className="font-medium text-gray-900">{row.title}</p>
            <p className="text-xs text-gray-500">{row.club_name}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (value) => {
        const statusStyles = {
          draft: 'bg-gray-100 text-gray-700',
          open: 'bg-green-100 text-green-700',
          closed: 'bg-red-100 text-red-700',
        }
        return (
          <span className={`px-2 py-1 text-xs font-medium rounded-full capitalize ${statusStyles[value as keyof typeof statusStyles]}`}>
            {String(value)}
          </span>
        )
      },
    },
    {
      key: 'location_country',
      label: 'Location',
      render: (_, row) => (
        <span className="text-sm text-gray-600">
          {row.location_city ? `${row.location_city}, ` : ''}{row.location_country}
        </span>
      ),
    },
    {
      key: 'application_count',
      label: 'Applications',
      render: (_, row) => (
        <div className="text-sm">
          <span className="font-medium text-gray-900">{row.application_count}</span>
          {row.pending_count > 0 && (
            <span className="text-xs text-amber-600 ml-1">({row.pending_count} pending)</span>
          )}
        </div>
      ),
    },
    {
      key: 'time_to_first_app_minutes',
      label: 'Time to 1st App',
      render: (value) => {
        if (!value) return <span className="text-gray-400">—</span>
        const mins = Number(value)
        if (mins < 60) return <span className="text-sm">{mins}m</span>
        if (mins < 1440) return <span className="text-sm">{Math.round(mins / 60)}h</span>
        return <span className="text-sm">{Math.round(mins / 1440)}d</span>
      },
    },
    {
      key: 'created_at',
      label: 'Created',
      render: (value) => (
        <span className="text-sm text-gray-600">
          {formatAdminDate(String(value))}
        </span>
      ),
    },
    {
      key: 'id',
      label: '',
      render: (_, row) => (
        <Link
          to={`/admin/opportunities/${row.id}`}
          className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors inline-flex"
        >
          <ChevronRight className="w-4 h-4 text-gray-400" />
        </Link>
      ),
    },
  ]

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-3" />
        <h2 className="text-lg font-semibold text-red-800 mb-2">Failed to load vacancies</h2>
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
          <h1 className="text-2xl font-bold text-gray-900">Vacancy Management</h1>
          <p className="text-sm text-gray-500 mt-1">
            Monitor vacancies, applications, and club activity
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

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Vacancies"
          value={totalCount}
          icon={Briefcase}
          color="purple"
          loading={isLoading}
        />
        <StatCard
          label="Avg Apps/Vacancy"
          value={stats?.avg_apps_per_vacancy ?? 0}
          icon={Users}
          color="blue"
          loading={isLoading}
        />
        <StatCard
          label="Active Clubs (30d)"
          value={stats?.active_clubs_30d ?? 0}
          icon={Building2}
          color="green"
          loading={isLoading}
        />
        <StatCard
          label="Fill Rate"
          value={`${stats?.vacancy_fill_rate ?? 0}%`}
          icon={Clock}
          color="amber"
          loading={isLoading}
        />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 bg-white p-4 rounded-xl border border-gray-200">
        <Filter className="w-4 h-4 text-gray-400" />
        
        <div className="flex items-center gap-2">
          <label htmlFor="status-filter" className="text-sm text-gray-600">Status:</label>
          <select
            id="status-filter"
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as StatusFilter)
              setPage(0)
            }}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-500"
          >
            <option value="all">All</option>
            <option value="draft">Draft</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="period-filter" className="text-sm text-gray-600">Period:</label>
          <select
            id="period-filter"
            aria-label="Filter by period"
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

        {(statusFilter !== 'all' || daysFilter !== 30) && (
          <button
            onClick={() => {
              setStatusFilter('all')
              setDaysFilter(30)
              setPage(0)
            }}
            className="text-sm text-purple-600 hover:text-purple-700"
          >
            Reset filters
          </button>
        )}
      </div>

      {/* Vacancies Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <DataTable
          data={vacancies}
          columns={columns}
          keyField="id"
          loading={isLoading}
          emptyMessage="No vacancies found"
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
