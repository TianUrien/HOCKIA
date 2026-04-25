/**
 * AdminEngagement Page
 * 
 * User engagement analytics dashboard showing time-in-app, sessions, and activity.
 */

import { useEffect, useState, useCallback } from 'react'
import { formatAdminDate } from '../utils/formatDate'
import { Link } from 'react-router-dom'
import {
  Clock,
  RefreshCw,
  Users,
  Calendar,
  Activity,
  TrendingUp,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react'
import { StatCard } from '../components/StatCard'
import { DataTable } from '../components/DataTable'
import type { Column } from '../components/DataTable'
import {
  getEngagementSummary,
  getUserEngagement,
  getEngagementTrends,
} from '../api/adminApi'
import type {
  EngagementSummary,
  UserEngagementItem,
  EngagementTrend,
  UserEngagementSearchParams,
} from '../types'
import { logger } from '@/lib/logger'

type DaysFilter = 7 | 30 | 90
type SortField = 'total_time' | 'active_days' | 'sessions' | 'last_active'

const PAGE_SIZE = 20

export function AdminEngagement() {
  const [summary, setSummary] = useState<EngagementSummary | null>(null)
  const [users, setUsers] = useState<UserEngagementItem[]>([])
  const [trends, setTrends] = useState<EngagementTrend[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // Filters and sorting
  const [daysFilter, setDaysFilter] = useState<DaysFilter>(30)
  const [sortField] = useState<SortField>('total_time')
  const [sortDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    
    try {
      const params: UserEngagementSearchParams = {
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
        sort_by: sortField,
        sort_dir: sortDir,
        days: daysFilter,
      }
      
      const [summaryData, usersData, trendsData] = await Promise.all([
        getEngagementSummary(),
        getUserEngagement(params),
        getEngagementTrends(daysFilter),
      ])
      
      setSummary(summaryData)
      setUsers(usersData.users)
      setTotalCount(usersData.totalCount)
      setTrends(trendsData)
    } catch (err) {
      logger.error('[AdminEngagement] Failed to fetch data:', err)
      setError(err instanceof Error ? err.message : 'Failed to load engagement data')
    } finally {
      setIsLoading(false)
    }
  }, [daysFilter, sortField, sortDir, page])

  useEffect(() => {
    document.title = 'User Engagement | HOCKIA Admin'
    fetchData()
  }, [fetchData])

  const formatTime = (minutes: number): string => {
    if (minutes < 60) return `${Math.round(minutes)}m`
    const hours = Math.floor(minutes / 60)
    const mins = Math.round(minutes % 60)
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
  }

  const formatDate = (dateStr: string | null): string => {
    if (!dateStr) return 'Never'
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
    
    if (diffDays === 0) return 'Today'
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return `${diffDays} days ago`
    return formatAdminDate(date)
  }

  // Table columns
  const columns: Column<UserEngagementItem>[] = [
    {
      key: 'display_name',
      label: 'User',
      render: (_value, row) => (
        <div className="flex items-center gap-3">
          {row.avatar_url ? (
            <img
              src={row.avatar_url}
              alt=""
              className="w-8 h-8 rounded-full object-cover"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center">
              <Users className="w-4 h-4 text-purple-600" />
            </div>
          )}
          <div>
            <div className="font-medium text-gray-900">{row.display_name}</div>
            <div className="text-xs text-gray-500">{row.email}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      label: 'Role',
      render: (_value, row) => (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
          row.role === 'player' ? 'bg-[#EFF6FF] text-[#2563EB]' :
          row.role === 'coach' ? 'bg-[#F0FDFA] text-[#0D9488]' :
          row.role === 'club' ? 'bg-[#FFF7ED] text-[#EA580C]' :
          row.role === 'brand' ? 'bg-[#FFF1F2] text-[#E11D48]' :
          row.role === 'umpire' ? 'bg-[#FEFCE8] text-[#A16207]' :
          'bg-gray-100 text-gray-600'
        }`}>
          {row.role}
        </span>
      ),
    },
    {
      key: 'total_time_minutes',
      label: 'Time in App',
      render: (_value, row) => (
        <span className="font-mono text-sm">{formatTime(row.total_time_minutes)}</span>
      ),
    },
    {
      key: 'active_days',
      label: 'Active Days',
      render: (_value, row) => (
        <span className="font-mono text-sm">{row.active_days}</span>
      ),
    },
    {
      key: 'total_sessions',
      label: 'Sessions',
      render: (_value, row) => (
        <span className="font-mono text-sm">{row.total_sessions}</span>
      ),
    },
    {
      key: 'avg_session_minutes',
      label: 'Avg Session',
      render: (_value, row) => (
        <span className="font-mono text-sm">{formatTime(row.avg_session_minutes)}</span>
      ),
    },
    {
      key: 'last_active_at',
      label: 'Last Active',
      render: (_value, row) => (
        <span className="text-sm text-gray-600">{formatDate(row.last_active_at)}</span>
      ),
    },
    {
      key: 'actions',
      label: '',
      render: (_value, row) => (
        <Link
          to={`/admin/directory?search=${encodeURIComponent(row.email)}`}
          className="text-purple-600 hover:text-purple-800"
          title="View user details"
        >
          <ExternalLink className="w-4 h-4" />
        </Link>
      ),
    },
  ]

  // Calculate trend chart data
  const maxActiveUsers = Math.max(...trends.map(t => t.active_users), 1)

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-3" />
        <h2 className="text-lg font-semibold text-red-800 mb-2">Failed to load engagement data</h2>
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
          <h1 className="text-2xl font-bold text-gray-900">User Engagement</h1>
          <p className="text-sm text-gray-500 mt-1">
            Track time-in-app, sessions, and user activity patterns
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
          label="Active Users (7d)"
          value={summary?.total_active_users_7d ?? 0}
          icon={Users}
          color="purple"
          loading={isLoading}
        />
        <StatCard
          label="Total Time (7d)"
          value={formatTime(summary?.total_time_minutes_7d ?? 0)}
          icon={Clock}
          color="blue"
          loading={isLoading}
        />
        <StatCard
          label="Sessions (7d)"
          value={summary?.total_sessions_7d ?? 0}
          icon={Activity}
          color="green"
          loading={isLoading}
        />
        <StatCard
          label="Avg Session Length"
          value={formatTime(summary?.avg_session_minutes ?? 0)}
          icon={TrendingUp}
          color="amber"
          loading={isLoading}
        />
      </div>

      {/* 30-day stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Active Users (30d)"
          value={summary?.total_active_users_30d ?? 0}
          icon={Users}
          color="purple"
          loading={isLoading}
        />
        <StatCard
          label="Total Time (30d)"
          value={formatTime(summary?.total_time_minutes_30d ?? 0)}
          icon={Clock}
          color="blue"
          loading={isLoading}
        />
        <StatCard
          label="Sessions (30d)"
          value={summary?.total_sessions_30d ?? 0}
          icon={Activity}
          color="green"
          loading={isLoading}
        />
        <StatCard
          label="Avg Daily Active Users"
          value={summary?.avg_daily_active_users ?? 0}
          icon={Calendar}
          color="amber"
          loading={isLoading}
        />
      </div>

      {/* Activity Trend Chart */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Daily Active Users</h2>
        
        {isLoading ? (
          <div className="h-40 bg-gray-100 rounded-lg animate-pulse" />
        ) : (
          <div className="h-40 flex items-end gap-1">
            {trends.map((day, index) => {
              const height = (day.active_users / maxActiveUsers) * 100
              const isToday = index === trends.length - 1
              // Calculate bar height as percentage - inline style needed for dynamic data visualization
              const barStyle = { height: `${Math.max(height, 2)}%` }
              
              return (
                <div
                  key={day.date}
                  className="flex-1 group relative"
                  title={`${day.date}: ${day.active_users} users, ${formatTime(day.total_minutes)}`}
                >
                  <div
                    className={`w-full rounded-t transition-all ${
                      isToday ? 'bg-purple-600' : 'bg-purple-300 hover:bg-purple-400'
                    }`}
                    style={barStyle}
                  />
                  {/* Tooltip on hover */}
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-10">
                    <div className="bg-gray-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
                      <div>{formatAdminDate(day.date)}</div>
                      <div>{day.active_users} users</div>
                      <div>{formatTime(day.total_minutes)}</div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        
        <div className="flex justify-between mt-2 text-xs text-gray-500">
          <span>{trends[0]?.date ? formatAdminDate(trends[0].date) : ''}</span>
          <span>Today</span>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 bg-white p-4 rounded-xl border border-gray-200">
        <label className="text-sm text-gray-600">Time period:</label>
        <select
          id="engagement-period-filter"
          aria-label="Filter engagement by time period"
          value={daysFilter}
          onChange={(e) => {
            setDaysFilter(Number(e.target.value) as DaysFilter)
            setPage(1)
          }}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-500"
        >
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>
      </div>

      {/* User Engagement Table */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Per-User Engagement</h2>
          <p className="text-sm text-gray-500">
            {totalCount.toLocaleString()} users in the selected period
          </p>
        </div>
        
        <DataTable
          data={users}
          columns={columns}
          keyField="user_id"
          loading={isLoading}
          emptyMessage="No engagement data found for this period"
        />
        
        {/* Pagination */}
        {totalCount > PAGE_SIZE && (
          <div className="flex items-center justify-between p-4 border-t border-gray-200">
            <div className="text-sm text-gray-500">
              Showing {((page - 1) * PAGE_SIZE) + 1} - {Math.min(page * PAGE_SIZE, totalCount)} of {totalCount}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1 || isLoading}
                className="px-3 py-1 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <span className="text-sm text-gray-600">Page {page}</span>
              <button
                onClick={() => setPage(p => p + 1)}
                disabled={page * PAGE_SIZE >= totalCount || isLoading}
                className="px-3 py-1 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Note about tracking */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <h3 className="text-sm font-medium text-blue-900 mb-1">How is engagement tracked?</h3>
        <p className="text-sm text-blue-700">
          Engagement is measured via heartbeat pings sent every 30 seconds while the browser tab is 
          active and the user is not idle. Time tracking pauses when the tab is hidden or after 
          2 minutes of inactivity. This provides an accurate measure of actual time spent using the platform.
        </p>
      </div>
    </div>
  )
}
