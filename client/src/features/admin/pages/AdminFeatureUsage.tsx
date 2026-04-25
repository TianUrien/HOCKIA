/**
 * AdminFeatureUsage Page
 *
 * Feature usage analytics: profile views, event tracking, source attribution.
 */

import { useEffect, useState, useCallback } from 'react'
import {
  Eye,
  RefreshCw,
  Users,
  UserCheck,
  TrendingUp,
  AlertTriangle,
  BarChart3,
} from 'lucide-react'
import { StatCard } from '../components/StatCard'
import { DataTable } from '../components/DataTable'
import type { Column } from '../components/DataTable'
import { getFeatureUsageMetrics } from '../api/adminApi'
import type { FeatureUsageMetrics, MostViewedProfile, EventSummaryItem } from '../types'
import { logger } from '@/lib/logger'
import { formatAdminDate } from '../utils/formatDate'

type DaysFilter = 7 | 30 | 90

const ROLE_COLORS: Record<string, string> = {
  player: 'bg-[#2563EB]',
  coach: 'bg-[#0D9488]',
  club: 'bg-[#EA580C]',
  brand: 'bg-[#E11D48]',
}

const ROLE_BADGE_CLASSES: Record<string, string> = {
  player: 'bg-[#EFF6FF] text-[#2563EB]',
  coach: 'bg-[#F0FDFA] text-[#0D9488]',
  club: 'bg-[#FFF7ED] text-[#EA580C]',
  brand: 'bg-[#FFF1F2] text-[#E11D48]',
  umpire: 'bg-[#FEFCE8] text-[#A16207]',
}

const SOURCE_COLORS: Record<string, string> = {
  community: 'bg-purple-500',
  search: 'bg-blue-500',
  feed: 'bg-green-500',
  applicants: 'bg-amber-500',
  direct: 'bg-gray-400',
}

export function AdminFeatureUsage() {
  const [data, setData] = useState<FeatureUsageMetrics | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [daysFilter, setDaysFilter] = useState<DaysFilter>(30)

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const metrics = await getFeatureUsageMetrics(daysFilter)
      setData(metrics)
    } catch (err) {
      logger.error('[AdminFeatureUsage] Failed to fetch data:', err)
      setError(err instanceof Error ? err.message : 'Failed to load feature usage data')
    } finally {
      setIsLoading(false)
    }
  }, [daysFilter])

  useEffect(() => {
    document.title = 'Feature Usage | HOCKIA Admin'
    fetchData()
  }, [fetchData])

  // Derive top source from profile_views.by_source
  const topSource = data?.profile_views?.by_source
    ? Object.entries(data.profile_views.by_source).sort(([, a], [, b]) => b - a)[0]?.[0] ?? 'N/A'
    : 'N/A'

  // Bar chart helpers
  const viewTrend = data?.view_trend ?? []
  const maxViews = Math.max(...viewTrend.map(t => t.views), 1)

  // Horizontal bar data for by_source and by_viewed_role
  const bySource = data?.profile_views?.by_source ?? {}
  const byRole = data?.profile_views?.by_viewed_role ?? {}
  const maxSourceCount = Math.max(...Object.values(bySource), 1)
  const maxRoleCount = Math.max(...Object.values(byRole), 1)

  // Most viewed profiles table columns
  const profileColumns: Column<MostViewedProfile>[] = [
    {
      key: 'full_name',
      label: 'Profile',
      render: (_value, row) => (
        <div className="flex items-center gap-3">
          {row.avatar_url ? (
            <img src={row.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center">
              <Users className="w-4 h-4 text-purple-600" />
            </div>
          )}
          <div>
            <div className="font-medium text-gray-900">{row.full_name || 'Unknown'}</div>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
              ROLE_BADGE_CLASSES[row.role] || 'bg-gray-100 text-gray-600'
            }`}>
              {row.role}
            </span>
          </div>
        </div>
      ),
    },
    {
      key: 'view_count',
      label: 'Views',
      render: (_value, row) => (
        <span className="font-mono text-sm font-semibold">{row.view_count}</span>
      ),
    },
    {
      key: 'unique_viewers',
      label: 'Unique Viewers',
      render: (_value, row) => (
        <span className="font-mono text-sm">{row.unique_viewers}</span>
      ),
    },
  ]

  // Events summary table columns
  const eventColumns: Column<EventSummaryItem>[] = [
    {
      key: 'event_name',
      label: 'Event',
      render: (_value, row) => (
        <span className="font-mono text-sm bg-gray-100 px-2 py-0.5 rounded">
          {row.event_name}
        </span>
      ),
    },
    {
      key: 'count',
      label: 'Count',
      render: (_value, row) => (
        <span className="font-mono text-sm font-semibold">{row.count.toLocaleString()}</span>
      ),
    },
    {
      key: 'unique_users',
      label: 'Unique Users',
      render: (_value, row) => (
        <span className="font-mono text-sm">{row.unique_users}</span>
      ),
    },
  ]

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-3" />
        <h2 className="text-lg font-semibold text-red-800 mb-2">Failed to load feature usage data</h2>
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
          <h1 className="text-2xl font-bold text-gray-900">Feature Usage</h1>
          <p className="text-sm text-gray-500 mt-1">
            Profile views, feature adoption, and event tracking
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            id="feature-usage-period-filter"
            aria-label="Filter by time period"
            value={daysFilter}
            onChange={(e) => setDaysFilter(Number(e.target.value) as DaysFilter)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
          >
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
          <button
            onClick={fetchData}
            disabled={isLoading}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Profile Views"
          value={data?.profile_views?.total ?? 0}
          icon={Eye}
          color="purple"
          loading={isLoading}
        />
        <StatCard
          label="Profiles Viewed"
          value={data?.profile_views?.unique_profiles_viewed ?? 0}
          icon={UserCheck}
          color="blue"
          loading={isLoading}
        />
        <StatCard
          label="Unique Viewers"
          value={data?.profile_views?.unique_viewers ?? 0}
          icon={Users}
          color="green"
          loading={isLoading}
        />
        <StatCard
          label="Top Source"
          value={topSource}
          icon={TrendingUp}
          color="amber"
          loading={isLoading}
        />
      </div>

      {/* Horizontal Bars: By Source + By Role */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Views by Source */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Views by Source</h2>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />)}
            </div>
          ) : Object.keys(bySource).length === 0 ? (
            <p className="text-sm text-gray-500">No profile view data yet</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(bySource)
                .sort(([, a], [, b]) => b - a)
                .map(([source, count]) => (
                  <div key={source}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-gray-700 capitalize">{source}</span>
                      <span className="text-sm font-mono text-gray-600">{count}</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2.5">
                      <div
                        className={`h-2.5 rounded-full ${SOURCE_COLORS[source] || 'bg-gray-400'}`}
                        style={{ width: `${(count / maxSourceCount) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* Views by Role */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Views by Role</h2>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />)}
            </div>
          ) : Object.keys(byRole).length === 0 ? (
            <p className="text-sm text-gray-500">No profile view data yet</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(byRole)
                .sort(([, a], [, b]) => b - a)
                .map(([role, count]) => (
                  <div key={role}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-gray-700 capitalize">{role}</span>
                      <span className="text-sm font-mono text-gray-600">{count}</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2.5">
                      <div
                        className={`h-2.5 rounded-full ${ROLE_COLORS[role] || 'bg-gray-400'}`}
                        style={{ width: `${(count / maxRoleCount) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>

      {/* Daily View Trend */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Daily Profile Views</h2>

        {isLoading ? (
          <div className="h-40 bg-gray-100 rounded-lg animate-pulse" />
        ) : viewTrend.length === 0 ? (
          <div className="h-40 flex items-center justify-center text-sm text-gray-500">
            No profile view data yet. Views will appear here once users start browsing profiles.
          </div>
        ) : (
          <div className="h-40 flex items-end gap-1">
            {viewTrend.map((day, index) => {
              const height = (day.views / maxViews) * 100
              const isToday = index === viewTrend.length - 1
              const barStyle = { height: `${Math.max(height, 2)}%` }

              return (
                <div
                  key={day.date}
                  className="flex-1 group relative"
                  title={`${day.date}: ${day.views} views`}
                >
                  <div
                    className={`w-full rounded-t transition-all ${
                      isToday ? 'bg-purple-600' : 'bg-purple-300 hover:bg-purple-400'
                    }`}
                    style={barStyle}
                  />
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-10">
                    <div className="bg-gray-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
                      <div>{formatAdminDate(day.date)}</div>
                      <div>{day.views} views</div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {viewTrend.length > 0 && (
          <div className="flex justify-between mt-2 text-xs text-gray-500">
            <span>{viewTrend[0]?.date ? formatAdminDate(viewTrend[0].date) : ''}</span>
            <span>Today</span>
          </div>
        )}
      </div>

      {/* Most Viewed Profiles */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Most Viewed Profiles</h2>
          <p className="text-sm text-gray-500">Top 20 profiles by view count in the selected period</p>
        </div>

        <DataTable
          data={data?.most_viewed_profiles ?? []}
          columns={profileColumns}
          keyField="profile_id"
          loading={isLoading}
          emptyMessage="No profile views recorded yet"
        />
      </div>

      {/* All Events Summary */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="p-4 border-b border-gray-200 flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-gray-400" />
          <div>
            <h2 className="text-lg font-semibold text-gray-900">All Tracked Events</h2>
            <p className="text-sm text-gray-500">Every event flowing through the database events table</p>
          </div>
        </div>

        <DataTable
          data={data?.event_summary ?? []}
          columns={eventColumns}
          keyField="event_name"
          loading={isLoading}
          emptyMessage="No events recorded yet. Events will appear as users interact with the platform."
        />
      </div>

      {/* Info note */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <h3 className="text-sm font-medium text-blue-900 mb-1">How is feature usage tracked?</h3>
        <p className="text-sm text-blue-700">
          Events are recorded when users view profiles, search, apply to opportunities, and send messages.
          Source attribution tracks where profile views originated from (community directory, search, feed,
          applicant list, or direct links). Data shown excludes test accounts.
        </p>
      </div>
    </div>
  )
}
