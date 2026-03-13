/**
 * AdminMessagingHealth Page
 *
 * Messaging health analytics dashboard showing response times, conversation
 * depth, and messaging engagement across the platform.
 */

import { useState, useCallback, useEffect } from 'react'
import {
  MessageSquarePlus,
  Send,
  Clock,
  MessageSquareOff,
  AlertTriangle,
  RefreshCw,
  Users,
} from 'lucide-react'
import { StatCard } from '../components/StatCard'
import { getMessagingHealth } from '../api/analyticsApi'
import { logger } from '@/lib/logger'

type DaysFilter = 7 | 30 | 90

const ROLE_COLORS: Record<string, { bg: string; text: string }> = {
  player: { bg: '#EFF6FF', text: '#2563EB' },
  coach: { bg: '#F0FDFA', text: '#0D9488' },
  club: { bg: '#FFF7ED', text: '#EA580C' },
  brand: { bg: '#FFF1F2', text: '#E11D48' },
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`
  const hours = minutes / 60
  if (hours < 24) return `${hours.toFixed(1)} hr`
  return `${Math.round(hours)} hr`
}

export function AdminMessagingHealth() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [data, setData] = useState<any | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [daysFilter, setDaysFilter] = useState<DaysFilter>(30)

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const result = await getMessagingHealth(daysFilter)
      setData(result)
    } catch (err) {
      logger.error('[AdminMessagingHealth] Failed to fetch data:', err)
      setError(err instanceof Error ? err.message : 'Failed to load messaging health')
    } finally {
      setIsLoading(false)
    }
  }, [daysFilter])

  useEffect(() => {
    document.title = 'Messaging Health | PLAYR Admin'
    fetchData()
  }, [fetchData])

  // Depth distribution calculations
  const depthDistribution = data?.depth_distribution ?? null
  const depthBuckets = depthDistribution
    ? [
        { label: '1 message', count: depthDistribution.single_message ?? 0 },
        { label: '2-5 messages', count: depthDistribution.short_2_5 ?? 0 },
        { label: '6-10 messages', count: depthDistribution.medium_6_10 ?? 0 },
        { label: '11-25 messages', count: depthDistribution.long_11_25 ?? 0 },
        { label: '25+ messages', count: depthDistribution.very_long_25_plus ?? 0 },
      ]
    : []
  const maxDepthCount = Math.max(...depthBuckets.map((b) => b.count), 1)

  // Response time data
  const responseTime = data?.response_time ?? null

  // Top messengers
  const topMessengers: Array<{
    display_name: string
    role: string
    message_count: number
    conversation_count: number
  }> = data?.top_messengers ?? []

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-3" />
        <h2 className="text-lg font-semibold text-red-800 mb-2">Failed to load messaging health</h2>
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
          <h1 className="text-2xl font-bold text-gray-900">Messaging Health</h1>
          <p className="text-sm text-gray-500 mt-1">
            Response times, conversation depth, and messaging engagement
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
          label="New Conversations"
          value={data?.summary?.new_conversations ?? 0}
          icon={MessageSquarePlus}
          color="purple"
          loading={isLoading}
        />
        <StatCard
          label="Messages Sent"
          value={data?.summary?.total_messages ?? 0}
          icon={Send}
          color="blue"
          loading={isLoading}
        />
        <StatCard
          label="Median Response Time"
          value={
            responseTime?.median_response_minutes != null
              ? formatMinutes(responseTime.median_response_minutes)
              : '--'
          }
          icon={Clock}
          color="green"
          loading={isLoading}
        />
        <StatCard
          label="Unanswered"
          value={data?.summary?.unanswered_conversations ?? 0}
          icon={MessageSquareOff}
          color="amber"
          loading={isLoading}
        />
      </div>

      {/* Two-column section: Conversation Depth + Response Time */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Conversation Depth Distribution */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Conversation Depth</h2>

          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-6 bg-gray-100 rounded animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {depthBuckets.map((bucket) => {
                const widthPct = (bucket.count / maxDepthCount) * 100
                return (
                  <div key={bucket.label}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-gray-700">{bucket.label}</span>
                      <span className="text-sm font-mono text-gray-600">
                        {bucket.count.toLocaleString()}
                      </span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div
                        className="h-2 rounded-full bg-purple-500 transition-all"
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
              {depthBuckets.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-4">No data available</p>
              )}
              {depthDistribution?.avg_depth != null && (
                <p className="text-xs text-gray-500 mt-2">
                  Avg depth: {Number(depthDistribution.avg_depth).toFixed(1)}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Response Time Stats */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Response Time</h2>

          {isLoading ? (
            <div className="grid grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-20 bg-gray-100 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : responseTime ? (
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-gray-50 rounded-lg p-4 text-center">
                <div className="text-2xl font-bold text-gray-900">
                  {formatMinutes(responseTime.avg_response_minutes ?? 0)}
                </div>
                <div className="text-xs text-gray-500 mt-1">Average</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-4 text-center">
                <div className="text-2xl font-bold text-gray-900">
                  {formatMinutes(responseTime.median_response_minutes ?? 0)}
                </div>
                <div className="text-xs text-gray-500 mt-1">Median</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-4 text-center">
                <div className="text-2xl font-bold text-gray-900">
                  {(responseTime.total_responses ?? 0).toLocaleString()}
                </div>
                <div className="text-xs text-gray-500 mt-1">Total Responses</div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-400 text-center py-8">No response time data</p>
          )}
        </div>
      </div>

      {/* Top Messengers Table */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Most Active Messengers</h2>
        <p className="text-sm text-gray-500 mb-4">
          Top messaging users in the last {daysFilter} days
        </p>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-12 bg-gray-100 rounded animate-pulse" />
            ))}
          </div>
        ) : topMessengers.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">No messaging data yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-2 font-medium text-gray-500">Name</th>
                  <th className="text-left py-3 px-2 font-medium text-gray-500">Role</th>
                  <th className="text-right py-3 px-2 font-medium text-gray-500">Messages</th>
                  <th className="text-right py-3 px-2 font-medium text-gray-500">Conversations</th>
                </tr>
              </thead>
              <tbody>
                {topMessengers.map((user, index) => {
                  const colors = ROLE_COLORS[user.role] ?? {
                    bg: '#F3F4F6',
                    text: '#4B5563',
                  }

                  return (
                    <tr
                      key={index}
                      className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                    >
                      {/* Name */}
                      <td className="py-3 px-2">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-purple-100 flex items-center justify-center">
                            <Users className="w-3.5 h-3.5 text-purple-600" />
                          </div>
                          <span className="font-medium text-gray-900 text-sm">
                            {user.display_name}
                          </span>
                        </div>
                      </td>

                      {/* Role */}
                      <td className="py-3 px-2">
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize"
                          style={{
                            backgroundColor: colors.bg,
                            color: colors.text,
                          }}
                        >
                          {user.role}
                        </span>
                      </td>

                      {/* Messages */}
                      <td className="py-3 px-2 text-right font-mono text-gray-900">
                        {Number(user.message_count).toLocaleString()}
                      </td>

                      {/* Conversations */}
                      <td className="py-3 px-2 text-right font-mono text-gray-900">
                        {Number(user.conversation_count).toLocaleString()}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
