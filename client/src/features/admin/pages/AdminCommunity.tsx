/**
 * AdminCommunity Page
 *
 * Community & Q&A analytics dashboard showing questions, answers, and engagement.
 */

import { useState, useCallback, useEffect } from 'react'
import {
  HelpCircle,
  MessageSquare,
  Users,
  CheckCircle,
  AlertTriangle,
} from 'lucide-react'
import { StatCard } from '../components/StatCard'
import { getCommunityAnalytics } from '../api/analyticsApi'
import type { CommunityAnalytics } from '../types'
import { logger } from '@/lib/logger'

type DaysFilter = 7 | 30 | 90

const ROLE_COLORS: Record<string, { bg: string; text: string }> = {
  player: { bg: '#EFF6FF', text: '#2563EB' },
  coach: { bg: '#F0FDFA', text: '#0D9488' },
  club: { bg: '#FFF7ED', text: '#EA580C' },
  brand: { bg: '#FFF1F2', text: '#E11D48' },
}

const ROLE_BAR_COLORS: Record<string, string> = {
  player: '#2563EB',
  coach: '#0D9488',
  club: '#EA580C',
  brand: '#E11D48',
}

export function AdminCommunity() {
  const [data, setData] = useState<CommunityAnalytics | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [daysFilter, setDaysFilter] = useState<DaysFilter>(30)

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const result = await getCommunityAnalytics(daysFilter)
      setData(result)
    } catch (err) {
      logger.error('[AdminCommunity] Failed to fetch data:', err)
      setError(err instanceof Error ? err.message : 'Failed to load community data')
    } finally {
      setIsLoading(false)
    }
  }, [daysFilter])

  useEffect(() => {
    document.title = 'Community & Q&A | PLAYR Admin'
    fetchData()
  }, [fetchData])

  // Trend calculations
  const qTrend = data ? data.summary.total_questions - data.summary.prev_total_questions : 0
  const aTrend = data ? data.summary.total_answers - data.summary.prev_total_answers : 0

  // Daily trend chart data
  const dailyTrend = data?.daily_trend ?? []
  const maxDaily = Math.max(
    ...dailyTrend.map((d) => Math.max(d.questions, d.answers)),
    1
  )

  // Questions by role data
  const questionsByRole = data?.questions_by_role ?? []
  const maxRoleCount = Math.max(...questionsByRole.map((r) => r.count), 1)

  // Top contributors
  const topContributors = data?.top_contributors?.slice(0, 10) ?? []

  const getInitials = (name: string | null): string => {
    if (!name) return '?'
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-3" />
        <h2 className="text-lg font-semibold text-red-800 mb-2">Failed to load community data</h2>
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
          <h1 className="text-2xl font-bold text-gray-900">Community & Q&A</h1>
          <p className="text-sm text-gray-500 mt-1">
            Questions, answers, and community engagement
          </p>
        </div>
        <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-1">
          {([7, 30, 90] as DaysFilter[]).map((d) => (
            <button
              key={d}
              onClick={() => setDaysFilter(d)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                daysFilter === d
                  ? 'bg-purple-600 text-white'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Questions Asked"
          value={data?.summary.total_questions ?? 0}
          icon={HelpCircle}
          color="purple"
          loading={isLoading}
          trend={data ? {
            value: qTrend,
            label: 'vs prev period',
            direction: qTrend > 0 ? 'up' : qTrend < 0 ? 'down' : 'neutral',
          } : undefined}
        />
        <StatCard
          label="Answers Given"
          value={data?.summary.total_answers ?? 0}
          icon={MessageSquare}
          color="blue"
          loading={isLoading}
          trend={data ? {
            value: aTrend,
            label: 'vs prev period',
            direction: aTrend > 0 ? 'up' : aTrend < 0 ? 'down' : 'neutral',
          } : undefined}
        />
        <StatCard
          label="Response Rate"
          value={data ? `${data.summary.response_rate}%` : '0%'}
          icon={CheckCircle}
          color="green"
          loading={isLoading}
        />
        <StatCard
          label="Unique Contributors"
          value={(data?.summary.unique_askers ?? 0) + (data?.summary.unique_answerers ?? 0)}
          icon={Users}
          color="amber"
          loading={isLoading}
        />
      </div>

      {/* Two-column section: Daily Trend + Questions by Role */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Daily Trend Chart */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Daily Trend</h2>
          <p className="text-sm text-gray-500 mb-4">Questions and answers per day</p>

          {isLoading ? (
            <div className="h-40 bg-gray-100 rounded-lg animate-pulse" />
          ) : dailyTrend.length === 0 ? (
            <div className="h-40 flex items-center justify-center text-sm text-gray-500">
              No community activity data yet
            </div>
          ) : (
            <>
              <div className="h-40 flex items-end gap-1">
                {dailyTrend.map((day) => {
                  const qHeight = (day.questions / maxDaily) * 100
                  const aHeight = (day.answers / maxDaily) * 100

                  return (
                    <div
                      key={day.day}
                      className="flex-1 group relative flex items-end gap-px"
                      title={`${day.day}: ${day.questions} questions, ${day.answers} answers`}
                    >
                      {/* Questions bar (purple) */}
                      <div
                        className="w-1/2 rounded-t bg-purple-400 hover:bg-purple-500 transition-all"
                        style={{ height: `${Math.max(qHeight, 2)}%` }}
                      />
                      {/* Answers bar (blue) */}
                      <div
                        className="w-1/2 rounded-t bg-blue-400 hover:bg-blue-500 transition-all"
                        style={{ height: `${Math.max(aHeight, 2)}%` }}
                      />
                      {/* Tooltip */}
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-10">
                        <div className="bg-gray-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap">
                          <div>{day.day}</div>
                          <div className="flex items-center gap-1">
                            <span className="inline-block w-2 h-2 rounded-full bg-purple-400" />
                            {day.questions} questions
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="inline-block w-2 h-2 rounded-full bg-blue-400" />
                            {day.answers} answers
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
              {/* Legend */}
              <div className="flex items-center justify-between mt-2">
                <div className="flex items-center gap-4 text-xs text-gray-500">
                  <span className="flex items-center gap-1">
                    <span className="inline-block w-2.5 h-2.5 rounded-sm bg-purple-400" />
                    Questions
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block w-2.5 h-2.5 rounded-sm bg-blue-400" />
                    Answers
                  </span>
                </div>
                <span className="text-xs text-gray-400">
                  {dailyTrend[dailyTrend.length - 1]?.day ?? ''}
                </span>
              </div>
            </>
          )}
        </div>

        {/* Questions by Role */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Questions by Role</h2>
          <p className="text-sm text-gray-500 mb-4">Breakdown of who is asking</p>

          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />
              ))}
            </div>
          ) : questionsByRole.length === 0 ? (
            <div className="h-40 flex items-center justify-center text-sm text-gray-500">
              No questions recorded yet
            </div>
          ) : (
            <div className="space-y-3">
              {questionsByRole
                .sort((a, b) => b.count - a.count)
                .map((item) => (
                  <div key={item.role}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-gray-700 capitalize">
                        {item.role}
                      </span>
                      <span className="text-sm font-mono text-gray-600">{item.count}</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2.5">
                      <div
                        className="h-2.5 rounded-full"
                        style={{
                          width: `${(item.count / maxRoleCount) * 100}%`,
                          backgroundColor: ROLE_BAR_COLORS[item.role] || '#9CA3AF',
                        }}
                      />
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>

      {/* Top Contributors Table */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Top Contributors</h2>
          <p className="text-sm text-gray-500">Most active answerers in this period</p>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-12 bg-gray-100 rounded animate-pulse" />
            ))}
          </div>
        ) : topContributors.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-500">
            No contributors found in this period
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider py-3 pr-4 w-12">
                    #
                  </th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider py-3 pr-4">
                    Contributor
                  </th>
                  <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider py-3 pr-4">
                    Role
                  </th>
                  <th className="text-right text-xs font-medium text-gray-500 uppercase tracking-wider py-3">
                    Answers
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {topContributors.map((contributor, index) => {
                  const roleColor = ROLE_COLORS[contributor.role]
                  return (
                    <tr key={contributor.id} className="hover:bg-gray-50">
                      <td className="py-3 pr-4 text-sm text-gray-500 font-mono">
                        {index + 1}
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-3">
                          {contributor.avatar_url ? (
                            <img
                              src={contributor.avatar_url}
                              alt=""
                              className="w-8 h-8 rounded-full object-cover"
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center">
                              <span className="text-xs font-medium text-gray-600">
                                {getInitials(contributor.full_name)}
                              </span>
                            </div>
                          )}
                          <span className="text-sm font-medium text-gray-900">
                            {contributor.full_name || 'Unknown'}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 pr-4">
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize"
                          style={
                            roleColor
                              ? { backgroundColor: roleColor.bg, color: roleColor.text }
                              : undefined
                          }
                        >
                          {contributor.role}
                        </span>
                      </td>
                      <td className="py-3 text-right">
                        <span className="text-sm font-mono font-semibold text-gray-900">
                          {contributor.answer_count}
                        </span>
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
