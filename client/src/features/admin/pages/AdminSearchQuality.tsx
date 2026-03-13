/**
 * AdminSearchQuality Page
 *
 * Search quality analytics dashboard showing search effectiveness,
 * click-through rates, and query analysis across traditional search
 * and AI discovery.
 */

import { useState, useCallback, useEffect } from 'react'
import {
  Search,
  MousePointerClick,
  XCircle,
  Users,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react'
import { StatCard } from '../components/StatCard'
import { getSearchQuality } from '../api/analyticsApi'
import { formatAdminDate } from '../utils/formatDate'
import { logger } from '@/lib/logger'

type DaysFilter = 7 | 30 | 90

export function AdminSearchQuality() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [data, setData] = useState<any | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [daysFilter, setDaysFilter] = useState<DaysFilter>(30)

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const result = await getSearchQuality(daysFilter)
      setData(result)
    } catch (err) {
      logger.error('[AdminSearchQuality] Failed to fetch data:', err)
      setError(err instanceof Error ? err.message : 'Failed to load search quality analytics')
    } finally {
      setIsLoading(false)
    }
  }, [daysFilter])

  useEffect(() => {
    document.title = 'Search Quality | PLAYR Admin'
    fetchData()
  }, [fetchData])

  // Chart calculations
  const dailyTrend = data?.daily_trend ?? []
  const maxDailyValue = dailyTrend.length > 0
    ? Math.max(
        ...dailyTrend.map((d: { traditional_searches: number; ai_searches: number }) =>
          d.traditional_searches + d.ai_searches,
        ),
        1,
      )
    : 1

  // Top queries
  const topQueries = data?.top_queries ?? []

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-3" />
        <h2 className="text-lg font-semibold text-red-800 mb-2">Failed to load search quality analytics</h2>
        <p className="text-sm text-red-600 mb-4">{error}</p>
        <button
          type="button"
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
          <h1 className="text-2xl font-bold text-gray-900">Search Quality</h1>
          <p className="text-sm text-gray-500 mt-1">
            Search effectiveness, click-through rates, and query analysis
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1">
            {([7, 30, 90] as DaysFilter[]).map((d) => (
              <button
                type="button"
                key={d}
                onClick={() => setDaysFilter(d)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  daysFilter === d
                    ? 'bg-purple-600 text-white'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
          <button
            type="button"
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
          label="Total Searches"
          value={
            data
              ? (data.traditional?.total_searches ?? 0) + (data.ai_discovery?.total_queries ?? 0)
              : 0
          }
          icon={Search}
          color="purple"
          loading={isLoading}
        />
        <StatCard
          label="Click-Through Rate"
          value={data ? `${data.click_through_rate ?? 0}%` : '0%'}
          icon={MousePointerClick}
          color="green"
          loading={isLoading}
        />
        <StatCard
          label="Zero-Click Rate"
          value={data ? `${data.zero_click_rate ?? 0}%` : '0%'}
          icon={XCircle}
          color="amber"
          loading={isLoading}
        />
        <StatCard
          label="Unique Searchers"
          value={
            data
              ? (data.traditional?.unique_searchers ?? 0) + (data.ai_discovery?.unique_users ?? 0)
              : 0
          }
          icon={Users}
          color="blue"
          loading={isLoading}
        />
      </div>

      {/* Traditional vs AI Comparison */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Traditional Search vs AI Discovery</h2>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-10 bg-gray-100 rounded animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-2 font-medium text-gray-500">Metric</th>
                  <th className="text-right py-3 px-2 font-medium text-gray-500">Traditional</th>
                  <th className="text-right py-3 px-2 font-medium text-gray-500">AI Discovery</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-gray-100">
                  <td className="py-3 px-2 text-gray-700">Searches</td>
                  <td className="py-3 px-2 text-right font-mono text-gray-900">
                    {(data?.traditional?.total_searches ?? 0).toLocaleString()}
                  </td>
                  <td className="py-3 px-2 text-right font-mono text-gray-900">
                    {(data?.ai_discovery?.total_queries ?? 0).toLocaleString()}
                  </td>
                </tr>
                <tr className="border-b border-gray-100">
                  <td className="py-3 px-2 text-gray-700">Unique Users</td>
                  <td className="py-3 px-2 text-right font-mono text-gray-900">
                    {(data?.traditional?.unique_searchers ?? 0).toLocaleString()}
                  </td>
                  <td className="py-3 px-2 text-right font-mono text-gray-900">
                    {(data?.ai_discovery?.unique_users ?? 0).toLocaleString()}
                  </td>
                </tr>
                <tr className="border-b border-gray-100">
                  <td className="py-3 px-2 text-gray-700">Zero Results</td>
                  <td className="py-3 px-2 text-right font-mono text-gray-900">
                    {(data?.traditional?.zero_result_searches ?? 0).toLocaleString()}
                  </td>
                  <td className="py-3 px-2 text-right font-mono text-gray-900">
                    {(data?.ai_discovery?.zero_result_queries ?? 0).toLocaleString()}
                  </td>
                </tr>
                <tr className="border-b border-gray-100">
                  <td className="py-3 px-2 text-gray-700">Avg Results</td>
                  <td className="py-3 px-2 text-right font-mono text-gray-900">
                    {data?.traditional?.avg_result_count ?? 0}
                  </td>
                  <td className="py-3 px-2 text-right font-mono text-gray-900">
                    {data?.ai_discovery?.avg_result_count ?? 0}
                  </td>
                </tr>
                <tr className="border-b border-gray-100">
                  <td className="py-3 px-2 text-gray-700">Avg Response Time</td>
                  <td className="py-3 px-2 text-right font-mono text-gray-400">--</td>
                  <td className="py-3 px-2 text-right font-mono text-gray-900">
                    {data?.ai_discovery?.avg_response_time_ms ?? 0}ms
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Two-column section: Daily Trend + Click Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Daily Search Volume Chart */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Daily Search Volume</h2>
          <div className="flex items-center gap-4 mb-4">
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <span className="w-2.5 h-2.5 rounded-sm bg-purple-500 inline-block" /> Traditional
            </div>
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <span className="w-2.5 h-2.5 rounded-sm bg-blue-400 inline-block" /> AI Discovery
            </div>
          </div>

          {isLoading ? (
            <div className="h-48 bg-gray-100 rounded-lg animate-pulse" />
          ) : dailyTrend.length === 0 ? (
            <div className="h-48 flex items-center justify-center">
              <p className="text-sm text-gray-400">No search data yet</p>
            </div>
          ) : (
            <div className="h-48 flex items-end gap-0.5">
              {dailyTrend.map(
                (
                  day: { date: string; traditional_searches: number; ai_searches: number },
                  index: number,
                ) => {
                  const traditionalHeight =
                    (day.traditional_searches / maxDailyValue) * 100
                  const aiHeight = (day.ai_searches / maxDailyValue) * 100
                  const isToday = index === dailyTrend.length - 1

                  return (
                    <div
                      key={day.date}
                      className="flex-1 group relative flex flex-col items-stretch justify-end"
                      title={`${day.date}: ${day.traditional_searches} traditional, ${day.ai_searches} AI`}
                    >
                      <div className="flex items-end gap-px flex-1">
                        <div
                          className={`flex-1 rounded-t transition-all ${
                            isToday ? 'bg-purple-600' : 'bg-purple-400 hover:bg-purple-500'
                          }`}
                          style={{
                            height: `${Math.max(traditionalHeight, 2)}%`,
                          }}
                        />
                        <div
                          className="flex-1 rounded-t bg-blue-300 hover:bg-blue-400 transition-all"
                          style={{
                            height: `${Math.max(aiHeight, 2)}%`,
                          }}
                        />
                      </div>
                      {/* Tooltip */}
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-10">
                        <div className="bg-gray-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
                          <div>{formatAdminDate(day.date)}</div>
                          <div>{day.traditional_searches} traditional</div>
                          <div>{day.ai_searches} AI</div>
                        </div>
                      </div>
                    </div>
                  )
                },
              )}
            </div>
          )}

          {dailyTrend.length > 0 && (
            <div className="flex justify-between mt-2 text-xs text-gray-500">
              <span>{dailyTrend[0]?.date ? formatAdminDate(dailyTrend[0].date) : ''}</span>
              <span>Today</span>
            </div>
          )}
        </div>

        {/* Click Engagement */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Click Engagement</h2>

          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 bg-gray-100 rounded animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-gray-50 rounded-lg p-4 text-center">
                <div className="text-2xl font-bold text-gray-900">
                  {Number(data?.clicks?.total_clicks ?? 0).toLocaleString()}
                </div>
                <div className="text-xs text-gray-500 mt-1">Total Clicks</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-4 text-center">
                <div className="text-2xl font-bold text-gray-900">
                  {Number(data?.clicks?.searches_with_clicks ?? 0).toLocaleString()}
                </div>
                <div className="text-xs text-gray-500 mt-1">Searches with Clicks</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-4 text-center">
                <div className="text-2xl font-bold text-gray-900">
                  {data?.clicks?.avg_click_position ?? 0}
                </div>
                <div className="text-xs text-gray-500 mt-1">Avg Click Position</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Top Search Queries Table */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Top Search Queries</h2>
        <p className="text-sm text-gray-500 mb-4">
          Most common search queries in the last {daysFilter} days
        </p>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-10 bg-gray-100 rounded animate-pulse" />
            ))}
          </div>
        ) : topQueries.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">No search data yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-2 font-medium text-gray-500">Query</th>
                  <th className="text-right py-3 px-2 font-medium text-gray-500">Count</th>
                  <th className="text-right py-3 px-2 font-medium text-gray-500">Avg Results</th>
                </tr>
              </thead>
              <tbody>
                {topQueries.map(
                  (
                    query: { search_term: string; query_count: number; avg_results: number },
                    index: number,
                  ) => (
                    <tr
                      key={`${query.search_term}-${index}`}
                      className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                    >
                      <td className="py-3 px-2 text-gray-900 font-medium">{query.search_term}</td>
                      <td className="py-3 px-2 text-right font-mono text-gray-900">
                        {Number(query.query_count).toLocaleString()}
                      </td>
                      <td className="py-3 px-2 text-right font-mono text-gray-600">
                        {query.avg_results}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
