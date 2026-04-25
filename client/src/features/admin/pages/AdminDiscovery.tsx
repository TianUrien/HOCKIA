/**
 * AdminDiscovery Page
 *
 * Discovery (AI) analytics: query tracking, intent breakdown, filter frequency,
 * top users, zero-result queries, and daily trends.
 */

import { useEffect, useState, useCallback } from 'react'
import {
  Search,
  Users,
  BarChart3,
  Zap,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Sparkles,
  MessageSquare,
  BookOpen,
} from 'lucide-react'
import { StatCard } from '../components/StatCard'
import { DataTable } from '../components/DataTable'
import type { Column } from '../components/DataTable'
import { getDiscoveryAnalytics } from '../api/adminApi'
import type {
  DiscoveryAnalyticsData,
  DiscoveryRecentQuery,
  DiscoveryTopUser,
  DiscoveryZeroResultQuery,
  DiscoveryFilterFrequency,
} from '../types'
import { logger } from '@/lib/logger'
import { reportSupabaseError } from '@/lib/sentryHelpers'
import { formatAdminDate } from '../utils/formatDate'

type DaysFilter = 7 | 30 | 90

const ROLE_BADGE_CLASSES: Record<string, string> = {
  player: 'bg-[#EFF6FF] text-[#2563EB]',
  coach: 'bg-[#F0FDFA] text-[#0D9488]',
  club: 'bg-[#FFF7ED] text-[#EA580C]',
  brand: 'bg-[#FFF1F2] text-[#E11D48]',
  umpire: 'bg-[#FEFCE8] text-[#A16207]',
}

const INTENT_BADGE_CLASSES: Record<string, string> = {
  search: 'bg-purple-100 text-purple-700',
  conversation: 'bg-blue-100 text-blue-700',
  knowledge: 'bg-green-100 text-green-700',
  error: 'bg-red-100 text-red-700',
}

const INTENT_ICONS: Record<string, typeof Search> = {
  search: Search,
  conversation: MessageSquare,
  knowledge: BookOpen,
  error: XCircle,
}

const FILTER_COLORS: Record<string, string> = {
  roles: 'bg-blue-500',
  positions: 'bg-purple-500',
  gender: 'bg-gray-500',
  age: 'bg-amber-500',
  nationalities: 'bg-green-500',
  locations: 'bg-cyan-500',
  leagues: 'bg-yellow-500',
  countries: 'bg-sky-500',
  eu_passport: 'bg-indigo-500',
  availability: 'bg-emerald-500',
  references: 'bg-violet-500',
  career_entries: 'bg-rose-500',
  text_query: 'bg-gray-400',
}

export function AdminDiscovery() {
  const [data, setData] = useState<DiscoveryAnalyticsData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [daysFilter, setDaysFilter] = useState<DaysFilter>(30)
  const [activeTab, setActiveTab] = useState<'queries' | 'users' | 'zero'>('queries')

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const analytics = await getDiscoveryAnalytics(daysFilter)
      setData(analytics)
    } catch (err) {
      logger.error('[AdminDiscovery] Failed to fetch data:', err)
      reportSupabaseError('admin.discovery', err, { daysFilter })
      setError(err instanceof Error ? err.message : 'Failed to load discovery analytics')
    } finally {
      setIsLoading(false)
    }
  }, [daysFilter])

  useEffect(() => {
    document.title = 'Discovery Analytics | HOCKIA Admin'
    fetchData()
  }, [fetchData])

  const summary = data?.summary
  const intentBreakdown = data?.intent_breakdown ?? []
  const filterFrequency = data?.filter_frequency ?? []
  const dailyTrend = data?.daily_trend ?? []
  const maxQueries = Math.max(...dailyTrend.map(t => t.queries), 1)
  const maxFilterCount = Math.max(...filterFrequency.map(f => f.count), 1)

  // ── Table columns ───────────────────────────────────────────────────

  const queryColumns: Column<DiscoveryRecentQuery>[] = [
    {
      key: 'display_name',
      label: 'User',
      render: (_value, row) => (
        <div>
          <div className="font-medium text-gray-900 text-sm">{row.display_name || 'Unknown'}</div>
          <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium ${
            ROLE_BADGE_CLASSES[row.role] || 'bg-gray-100 text-gray-600'
          }`}>
            {row.role}
          </span>
        </div>
      ),
    },
    {
      key: 'query_text',
      label: 'Query',
      render: (_value, row) => (
        <span
          className="text-sm text-gray-700 max-w-xs truncate block"
          title={row.query_text}
        >
          {row.query_text.length > 60 ? `${row.query_text.slice(0, 60)}...` : row.query_text}
        </span>
      ),
    },
    {
      key: 'intent',
      label: 'Intent',
      render: (_value, row) => {
        const IntentIcon = INTENT_ICONS[row.intent] || Search
        return (
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
            INTENT_BADGE_CLASSES[row.intent] || 'bg-gray-100 text-gray-600'
          }`}>
            <IntentIcon className="w-3 h-3" />
            {row.intent}
          </span>
        )
      },
    },
    {
      key: 'result_count',
      label: 'Results',
      render: (_value, row) => (
        <span className={`font-mono text-sm ${row.result_count === 0 && row.intent === 'search' ? 'text-red-600 font-semibold' : ''}`}>
          {row.result_count}
        </span>
      ),
    },
    {
      key: 'response_time_ms',
      label: 'Time',
      render: (_value, row) => (
        <span className="font-mono text-sm text-gray-500">
          {row.response_time_ms != null ? `${row.response_time_ms}ms` : '-'}
        </span>
      ),
    },
    {
      key: 'created_at',
      label: 'Date',
      render: (_value, row) => (
        <span className="text-sm text-gray-500">{formatAdminDate(row.created_at)}</span>
      ),
    },
  ]

  const topUserColumns: Column<DiscoveryTopUser>[] = [
    {
      key: 'display_name',
      label: 'User',
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
            <div className="font-medium text-gray-900">{row.display_name || 'Unknown'}</div>
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
          ROLE_BADGE_CLASSES[row.role] || 'bg-gray-100 text-gray-600'
        }`}>
          {row.role}
        </span>
      ),
    },
    {
      key: 'query_count',
      label: 'Queries',
      render: (_value, row) => (
        <span className="font-mono text-sm font-semibold">{row.query_count}</span>
      ),
    },
    {
      key: 'last_query_at',
      label: 'Last Query',
      render: (_value, row) => (
        <span className="text-sm text-gray-500">{formatAdminDate(row.last_query_at)}</span>
      ),
    },
  ]

  const zeroResultColumns: Column<DiscoveryZeroResultQuery>[] = [
    {
      key: 'display_name',
      label: 'User',
      render: (_value, row) => (
        <span className="text-sm font-medium text-gray-900">{row.display_name || 'Unknown'}</span>
      ),
    },
    {
      key: 'query_text',
      label: 'Query',
      render: (_value, row) => (
        <span className="text-sm text-gray-700">{row.query_text}</span>
      ),
    },
    {
      key: 'parsed_filters',
      label: 'Filters Used',
      render: (_value, row) => {
        if (!row.parsed_filters) return <span className="text-gray-400 text-sm">-</span>
        const activeFilters = Object.entries(row.parsed_filters)
          .filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0) && v !== false)
          .map(([k]) => k)
        if (activeFilters.length === 0) return <span className="text-gray-400 text-sm">-</span>
        return (
          <div className="flex flex-wrap gap-1">
            {activeFilters.slice(0, 4).map(f => (
              <span key={f} className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">{f}</span>
            ))}
            {activeFilters.length > 4 && (
              <span className="text-xs text-gray-400">+{activeFilters.length - 4}</span>
            )}
          </div>
        )
      },
    },
    {
      key: 'created_at',
      label: 'Date',
      render: (_value, row) => (
        <span className="text-sm text-gray-500">{formatAdminDate(row.created_at)}</span>
      ),
    },
  ]

  // ── Error state ─────────────────────────────────────────────────────

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-3" />
        <h2 className="text-lg font-semibold text-red-800 mb-2">Failed to load discovery analytics</h2>
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
          <div className="flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-purple-600" />
            <h1 className="text-2xl font-bold text-gray-900">Discovery Analytics</h1>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            AI-powered search queries, intents, and filter usage
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            id="discovery-period-filter"
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
          label="Total Queries"
          value={summary?.total_queries ?? 0}
          icon={Search}
          color="purple"
          loading={isLoading}
        />
        <StatCard
          label="Unique Users"
          value={summary?.unique_users ?? 0}
          icon={Users}
          color="blue"
          loading={isLoading}
        />
        <StatCard
          label="Avg Results"
          value={summary?.avg_result_count ?? 0}
          icon={BarChart3}
          color="green"
          loading={isLoading}
        />
        <StatCard
          label="Avg Response"
          value={summary?.avg_response_time_ms ? `${summary.avg_response_time_ms}ms` : '0ms'}
          icon={Zap}
          color="amber"
          loading={isLoading}
        />
      </div>

      {/* Secondary Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          label="Zero Results"
          value={summary?.zero_result_queries ?? 0}
          icon={AlertTriangle}
          color="red"
          loading={isLoading}
        />
        <StatCard
          label="Errors"
          value={summary?.error_count ?? 0}
          icon={XCircle}
          color="red"
          loading={isLoading}
        />
        <StatCard
          label="Search Queries"
          value={intentBreakdown.find(i => i.intent === 'search')?.count ?? 0}
          icon={Search}
          color="purple"
          loading={isLoading}
        />
      </div>

      {/* Intent Breakdown + Filter Frequency */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Intent Breakdown */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Intent Breakdown</h2>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />)}
            </div>
          ) : intentBreakdown.length === 0 ? (
            <p className="text-sm text-gray-500">No discovery data yet</p>
          ) : (
            <div className="space-y-4">
              {intentBreakdown.map((item) => {
                const IntentIcon = INTENT_ICONS[item.intent] || Search
                const barColor = item.intent === 'search' ? 'bg-purple-500'
                  : item.intent === 'conversation' ? 'bg-blue-500'
                  : item.intent === 'knowledge' ? 'bg-green-500'
                  : 'bg-red-500'
                return (
                  <div key={item.intent}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <IntentIcon className="w-4 h-4 text-gray-500" />
                        <span className="text-sm font-medium text-gray-700 capitalize">{item.intent}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-mono text-gray-600">{item.count}</span>
                        <span className="text-xs text-gray-400">({item.percentage}%)</span>
                      </div>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2.5">
                      <div
                        className={`h-2.5 rounded-full ${barColor}`}
                        style={{ width: `${item.percentage}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Filter Frequency */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Filter Frequency</h2>
          <p className="text-xs text-gray-400 mb-3">Which filters users specify most often in search queries</p>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map(i => <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />)}
            </div>
          ) : filterFrequency.length === 0 ? (
            <p className="text-sm text-gray-500">No search filter data yet</p>
          ) : (
            <div className="space-y-3">
              {filterFrequency.slice(0, 10).map((item: DiscoveryFilterFrequency) => (
                <div key={item.filter_name}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-700">{item.filter_name}</span>
                    <span className="text-sm font-mono text-gray-600">{item.count}</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full ${FILTER_COLORS[item.filter_name] || 'bg-purple-500'}`}
                      style={{ width: `${(item.count / maxFilterCount) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Daily Trend */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Daily Discovery Queries</h2>

        {isLoading ? (
          <div className="h-40 bg-gray-100 rounded-lg animate-pulse" />
        ) : dailyTrend.length === 0 ? (
          <div className="h-40 flex items-center justify-center text-sm text-gray-500">
            No discovery data yet. Queries will appear here once users start using Discovery.
          </div>
        ) : (
          <div className="h-40 flex items-end gap-1">
            {dailyTrend.map((day, index) => {
              const height = (day.queries / maxQueries) * 100
              const isToday = index === dailyTrend.length - 1
              const barStyle = { height: `${Math.max(height, 2)}%` }

              return (
                <div
                  key={day.date}
                  className="flex-1 group relative"
                  title={`${day.date}: ${day.queries} queries, ${day.unique_users} users`}
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
                      <div>{day.queries} queries</div>
                      <div>{day.unique_users} users</div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {dailyTrend.length > 0 && (
          <div className="flex justify-between mt-2 text-xs text-gray-500">
            <span>{dailyTrend[0]?.date ? formatAdminDate(dailyTrend[0].date) : ''}</span>
            <span>Today</span>
          </div>
        )}
      </div>

      {/* Tab Navigation */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="border-b border-gray-200">
          <div className="flex">
            {[
              { key: 'queries' as const, label: 'Recent Queries', count: data?.recent_queries?.length },
              { key: 'users' as const, label: 'Top Users', count: data?.top_users?.length },
              { key: 'zero' as const, label: 'Zero Results', count: data?.zero_result_queries?.length },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.key
                    ? 'border-purple-600 text-purple-700'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.label}
                {tab.count != null && (
                  <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs">
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Content */}
        {activeTab === 'queries' && (
          <DataTable
            data={data?.recent_queries ?? []}
            columns={queryColumns}
            keyField="id"
            loading={isLoading}
            emptyMessage="No discovery queries yet. Queries will appear here once users start using Discovery."
          />
        )}

        {activeTab === 'users' && (
          <DataTable
            data={data?.top_users ?? []}
            columns={topUserColumns}
            keyField="user_id"
            loading={isLoading}
            emptyMessage="No users have used Discovery yet."
          />
        )}

        {activeTab === 'zero' && (
          <DataTable
            data={data?.zero_result_queries ?? []}
            columns={zeroResultColumns}
            keyField="id"
            loading={isLoading}
            emptyMessage="No zero-result queries found. This is a good sign!"
          />
        )}
      </div>

      {/* Info note */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <h3 className="text-sm font-medium text-blue-900 mb-1">How is Discovery tracked?</h3>
        <p className="text-sm text-blue-700">
          Every AI Discovery query is logged server-side in the edge function, capturing the query text,
          parsed intent (search, conversation, knowledge), extracted filters, result count, and response time.
          Data shown excludes test accounts. Zero-result queries help identify gaps in the platform's data coverage.
        </p>
      </div>
    </div>
  )
}
