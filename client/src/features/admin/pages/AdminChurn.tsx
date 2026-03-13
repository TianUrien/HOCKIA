/**
 * AdminChurn Page
 *
 * Churn & retention analytics dashboard showing user inactivity tiers,
 * churn by role, last actions before churn, retention cohorts, and at-risk users.
 */

import { useState, useCallback, useEffect } from 'react'
import {
  Clock,
  RotateCcw,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react'
import { StatCard } from '../components/StatCard'
import { getChurnAnalysis, getRetentionByRole } from '../api/analyticsApi'
import { logger } from '@/lib/logger'

type DaysFilter = 7 | 30 | 90

const ROLE_COLORS: Record<string, { bg: string; text: string }> = {
  player: { bg: '#EFF6FF', text: '#2563EB' },
  coach: { bg: '#F0FDFA', text: '#0D9488' },
  club: { bg: '#FFF7ED', text: '#EA580C' },
  brand: { bg: '#FFF1F2', text: '#E11D48' },
}

function formatEventName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function retentionColor(pct: number): string {
  if (pct > 50) return 'text-green-600'
  if (pct >= 25) return 'text-amber-600'
  return 'text-red-600'
}

export function AdminChurn() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [data, setData] = useState<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [retentionData, setRetentionData] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [daysFilter, setDaysFilter] = useState<DaysFilter>(30)

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const [churnResult, retentionResult] = await Promise.all([
        getChurnAnalysis(daysFilter),
        getRetentionByRole(),
      ])
      setData(churnResult)
      setRetentionData(retentionResult)
    } catch (err) {
      logger.error('[AdminChurn] Failed to fetch data:', err)
      setError(err instanceof Error ? err.message : 'Failed to load churn analytics')
    } finally {
      setIsLoading(false)
    }
  }, [daysFilter])

  useEffect(() => {
    document.title = 'Churn & Retention | PLAYR Admin'
    fetchData()
  }, [fetchData])

  // Chart calculations
  const churnByRole = data?.churn_by_role ?? []
  const lastActions = data?.last_action_before_churn ?? []
  const maxActionCount = lastActions.length > 0
    ? Math.max(...lastActions.map((a: { user_count: number }) => a.user_count), 1)
    : 1
  const retentionByRole = retentionData?.by_role ?? []
  const atRiskUsers = data?.at_risk_users ?? []
  const engagementBeforeChurn = data?.engagement_before_churn ?? null

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-3" />
        <h2 className="text-lg font-semibold text-red-800 mb-2">Failed to load churn analytics</h2>
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
          <h1 className="text-2xl font-bold text-gray-900">Churn & Retention</h1>
          <p className="text-sm text-gray-500 mt-1">
            User inactivity, churn patterns, and retention by role
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

      {/* Inactive User Tiers */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Inactive 7d"
          value={data?.inactive_tiers?.inactive_7d ?? 0}
          icon={Clock}
          color="green"
          loading={isLoading}
        />
        <StatCard
          label="Inactive 14d"
          value={data?.inactive_tiers?.inactive_14d ?? 0}
          icon={Clock}
          color="amber"
          loading={isLoading}
        />
        <StatCard
          label="Inactive 30d"
          value={data?.inactive_tiers?.inactive_30d ?? 0}
          icon={Clock}
          color="red"
          loading={isLoading}
        />
        <StatCard
          label="Re-engaged"
          value={data?.re_engaged_users ?? 0}
          icon={RotateCcw}
          color="blue"
          loading={isLoading}
        />
      </div>

      {/* Two-column section: Churn by Role + Last Action Before Churn */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Churn by Role */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Churn by Role</h2>
          <p className="text-sm text-gray-500 mb-4">Users inactive 14+ days</p>

          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />
              ))}
            </div>
          ) : churnByRole.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No data available</p>
          ) : (
            <div className="space-y-4">
              {churnByRole.map((role: { role: string; churned: number; active: number; churn_rate: number }) => {
                const colors = ROLE_COLORS[role.role] ?? {
                  bg: '#F3F4F6',
                  text: '#4B5563',
                }
                const total = role.churned + role.active
                const churnedPct = total > 0 ? (role.churned / total) * 100 : 0
                const activePct = total > 0 ? (role.active / total) * 100 : 0

                return (
                  <div key={role.role}>
                    <div className="flex items-center justify-between mb-1">
                      <span
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize"
                        style={{
                          backgroundColor: colors.bg,
                          color: colors.text,
                        }}
                      >
                        {role.role}
                      </span>
                      <div className="flex items-center gap-3 text-xs text-gray-500">
                        <span>
                          <span className="font-mono text-gray-700">{role.churned}</span> churned
                        </span>
                        <span>
                          <span className="font-mono text-gray-700">{role.active}</span> active
                        </span>
                        <span className="font-medium text-gray-900">
                          {role.churn_rate}%
                        </span>
                      </div>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2.5 flex overflow-hidden">
                      <div
                        className="h-2.5 transition-all"
                        style={{
                          width: `${churnedPct}%`,
                          backgroundColor: colors.text,
                          opacity: 0.6,
                        }}
                      />
                      <div
                        className="h-2.5 transition-all"
                        style={{
                          width: `${activePct}%`,
                          backgroundColor: colors.text,
                        }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Last Action Before Churn */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Last Action Before Churn</h2>
          <p className="text-sm text-gray-500 mb-4">What churned users did last (14+ days inactive)</p>

          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-6 bg-gray-100 rounded animate-pulse" />
              ))}
            </div>
          ) : lastActions.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No data available</p>
          ) : (
            <div className="space-y-3">
              {lastActions.map((action: { last_action: string; user_count: number }) => {
                const widthPct = (action.user_count / maxActionCount) * 100
                return (
                  <div key={action.last_action}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-gray-700">
                        {formatEventName(action.last_action)}
                      </span>
                      <span className="text-sm font-mono text-gray-600">
                        {action.user_count.toLocaleString()}
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
            </div>
          )}
        </div>
      </div>

      {/* Retention by Role */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Retention by Role</h2>
        <p className="text-sm text-gray-500 mb-4">Cohort retention rates by user role</p>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-10 bg-gray-100 rounded animate-pulse" />
            ))}
          </div>
        ) : retentionByRole.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">No retention data available</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-2 font-medium text-gray-500">Role</th>
                  <th className="text-right py-3 px-2 font-medium text-gray-500">Users</th>
                  <th className="text-right py-3 px-2 font-medium text-gray-500">Day 1</th>
                  <th className="text-right py-3 px-2 font-medium text-gray-500">Week 1</th>
                  <th className="text-right py-3 px-2 font-medium text-gray-500">Week 2</th>
                  <th className="text-right py-3 px-2 font-medium text-gray-500">Week 3-4</th>
                </tr>
              </thead>
              <tbody>
                {retentionByRole.map((row: { role: string; total_users: number; day_1_pct: number; week_1_pct: number; week_2_pct: number; week_3_4_pct: number }) => {
                  const colors = ROLE_COLORS[row.role] ?? {
                    bg: '#F3F4F6',
                    text: '#4B5563',
                  }

                  return (
                    <tr
                      key={row.role}
                      className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                    >
                      <td className="py-3 px-2">
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize"
                          style={{
                            backgroundColor: colors.bg,
                            color: colors.text,
                          }}
                        >
                          {row.role}
                        </span>
                      </td>
                      <td className="py-3 px-2 text-right font-mono text-gray-900">
                        {Number(row.total_users).toLocaleString()}
                      </td>
                      <td className={`py-3 px-2 text-right font-mono font-medium ${retentionColor(Number(row.day_1_pct))}`}>
                        {row.day_1_pct}%
                      </td>
                      <td className={`py-3 px-2 text-right font-mono font-medium ${retentionColor(Number(row.week_1_pct))}`}>
                        {row.week_1_pct}%
                      </td>
                      <td className={`py-3 px-2 text-right font-mono font-medium ${retentionColor(Number(row.week_2_pct))}`}>
                        {row.week_2_pct}%
                      </td>
                      <td className={`py-3 px-2 text-right font-mono font-medium ${retentionColor(Number(row.week_3_4_pct))}`}>
                        {row.week_3_4_pct}%
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Two-column section: At-Risk Users + Engagement Before Churn */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* At-Risk Users */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">At-Risk Users</h2>
          <p className="text-sm text-gray-500 mb-4">
            Users with 50%+ engagement decline this week vs last
          </p>

          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-10 bg-gray-100 rounded animate-pulse" />
              ))}
            </div>
          ) : atRiskUsers.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No at-risk users detected</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-3 px-2 font-medium text-gray-500">Name</th>
                    <th className="text-left py-3 px-2 font-medium text-gray-500">Role</th>
                    <th className="text-right py-3 px-2 font-medium text-gray-500">This Week</th>
                    <th className="text-right py-3 px-2 font-medium text-gray-500">Last Week</th>
                  </tr>
                </thead>
                <tbody>
                  {atRiskUsers.map((user: { display_name: string; role: string; sessions_this_week: number; sessions_prev_week: number }, index: number) => {
                    const colors = ROLE_COLORS[user.role] ?? {
                      bg: '#F3F4F6',
                      text: '#4B5563',
                    }

                    return (
                      <tr
                        key={index}
                        className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                      >
                        <td className="py-3 px-2 font-medium text-gray-900">{user.display_name}</td>
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
                        <td className="py-3 px-2 text-right font-mono text-red-600">
                          {user.sessions_this_week}
                        </td>
                        <td className="py-3 px-2 text-right font-mono text-gray-600">
                          {user.sessions_prev_week}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Engagement Before Churn */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Engagement Before Churn</h2>
          <p className="text-sm text-gray-500 mb-4">
            Average activity levels before users churned
          </p>

          {isLoading ? (
            <div className="grid grid-cols-2 gap-4">
              <div className="h-24 bg-gray-100 rounded-lg animate-pulse" />
              <div className="h-24 bg-gray-100 rounded-lg animate-pulse" />
            </div>
          ) : !engagementBeforeChurn ? (
            <p className="text-sm text-gray-400 text-center py-8">No data available</p>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-gray-50 rounded-lg p-4 text-center">
                <div className="text-3xl font-bold text-gray-900">
                  {engagementBeforeChurn.avg_sessions_before_churn ?? 0}
                </div>
                <div className="text-sm text-gray-500 mt-1">Avg Sessions Before Churn</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-4 text-center">
                <div className="text-3xl font-bold text-gray-900">
                  {engagementBeforeChurn.avg_minutes_before_churn ?? 0}
                </div>
                <div className="text-sm text-gray-500 mt-1">Avg Minutes Before Churn</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
