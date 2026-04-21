/**
 * AdminOnboardingFunnel Page
 *
 * Step-by-step drop-off analysis for the onboarding flow, with role filtering
 * and stuck-user tracking.
 */

import { useState, useCallback, useEffect } from 'react'
import {
  UserPlus,
  CheckCircle,
  Percent,
  Clock,
  AlertTriangle,
  RefreshCw,
  ChevronDown,
} from 'lucide-react'
import { StatCard } from '../components/StatCard'
import { getOnboardingFunnelDetail } from '../api/analyticsApi'
import { logger } from '@/lib/logger'

type DaysFilter = 7 | 30 | 90
type RoleFilter = null | 'player' | 'coach' | 'club' | 'brand' | 'umpire'

const ROLE_COLORS: Record<string, { bg: string; text: string }> = {
  player: { bg: '#EFF6FF', text: '#2563EB' },
  coach: { bg: '#F0FDFA', text: '#0D9488' },
  club: { bg: '#FFF7ED', text: '#EA580C' },
  brand: { bg: '#FFF1F2', text: '#E11D48' },
  umpire: { bg: '#FEFCE8', text: '#A16207' },
}

const FUNNEL_STEPS = [
  { key: 'signed_up', label: 'Signed Up' },
  { key: 'role_selected', label: 'Role Selected' },
  { key: 'avatar_uploaded', label: 'Avatar Uploaded' },
  { key: 'form_submitted', label: 'Form Submitted' },
  { key: 'completed', label: 'Completed' },
] as const

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`
  if (minutes < 1440) {
    const hrs = Math.floor(minutes / 60)
    const mins = Math.round(minutes % 60)
    return mins > 0 ? `${hrs} hr ${mins} min` : `${hrs} hr`
  }
  const days = Math.round(minutes / 1440)
  return `${days} days`
}

export function AdminOnboardingFunnel() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [data, setData] = useState<any | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [daysFilter, setDaysFilter] = useState<DaysFilter>(30)
  const [roleFilter, setRoleFilter] = useState<RoleFilter>(null)

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const result = await getOnboardingFunnelDetail(
        daysFilter,
        roleFilter ?? undefined,
      )
      setData(result)
    } catch (err) {
      logger.error('[AdminOnboardingFunnel] Failed to fetch data:', err)
      setError(
        err instanceof Error ? err.message : 'Failed to load onboarding funnel',
      )
    } finally {
      setIsLoading(false)
    }
  }, [daysFilter, roleFilter])

  useEffect(() => {
    document.title = 'Onboarding Funnel | HOCKIA Admin'
    fetchData()
  }, [fetchData])

  // Derived values
  const funnel = data?.funnel ?? {}
  const signedUp: number = funnel.signed_up ?? 0
  const completed: number = funnel.completed ?? 0
  const completionRate = signedUp > 0 ? ((completed / signedUp) * 100).toFixed(1) : '0.0'
  const stuckUsers: Array<{ role: string; last_step: string; days_since_signup: number }> =
    data?.stuck_users ?? []
  // by_role comes back as { player: { signed_up, completed, completion_rate }, ... }
  const byRoleRaw = data?.by_role ?? {}
  const byRole: Array<{
    role: string
    signed_up: number
    completed: number
    completion_rate: number
  }> = Object.entries(byRoleRaw).map(([role, counts]) => ({
    role,
    ...(counts as { signed_up: number; completed: number; completion_rate: number }),
  }))
  const timeToComplete: Array<{ role: string; median_minutes: number }> =
    data?.time_to_complete ?? []

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-3" />
        <h2 className="text-lg font-semibold text-red-800 mb-2">
          Failed to load onboarding funnel
        </h2>
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
          <h1 className="text-2xl font-bold text-gray-900">Onboarding Funnel</h1>
          <p className="text-sm text-gray-500 mt-1">
            Step-by-step drop-off analysis for the onboarding flow
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

          {/* Role filter dropdown */}
          <div className="relative">
            <select
              value={roleFilter ?? ''}
              onChange={(e) =>
                setRoleFilter((e.target.value || null) as RoleFilter)
              }
              className="appearance-none pl-3 pr-8 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer"
            >
              <option value="">All Roles</option>
              <option value="player">Player</option>
              <option value="coach">Coach</option>
              <option value="club">Club</option>
              <option value="brand">Brand</option>
              <option value="umpire">Umpire</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
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
          label="Signed Up"
          value={signedUp}
          icon={UserPlus}
          color="purple"
          loading={isLoading}
        />
        <StatCard
          label="Completed"
          value={completed}
          icon={CheckCircle}
          color="green"
          loading={isLoading}
        />
        <StatCard
          label="Completion Rate"
          value={`${completionRate}%`}
          icon={Percent}
          color="blue"
          loading={isLoading}
        />
        <StatCard
          label="Stuck Users"
          value={stuckUsers.length}
          icon={Clock}
          color="amber"
          loading={isLoading}
        />
      </div>

      {/* Funnel Visualization */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Onboarding Steps</h2>

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="space-y-1">
            {FUNNEL_STEPS.map((step, index) => {
              const count: number = funnel[step.key] ?? 0
              const pctOfTotal = signedUp > 0 ? (count / signedUp) * 100 : 0
              const prevStep = index > 0 ? FUNNEL_STEPS[index - 1] : null
              const prevCount: number = prevStep ? (funnel[prevStep.key] ?? 0) : 0
              const dropOff =
                prevStep && prevCount > 0
                  ? (((prevCount - count) / prevCount) * 100).toFixed(1)
                  : null

              return (
                <div key={step.key}>
                  {/* Drop-off indicator between rows */}
                  {dropOff !== null && (
                    <div className="flex items-center gap-2 py-1 pl-4">
                      <span className="text-xs font-medium text-red-500">
                        -{dropOff}% drop-off
                      </span>
                    </div>
                  )}

                  {/* Step row */}
                  <div className="flex items-center gap-4">
                    <div className="w-36 shrink-0 text-sm font-medium text-gray-700">
                      {step.label}
                    </div>
                    <div className="flex-1 bg-gray-100 rounded-full h-6 relative overflow-hidden">
                      <div
                        className="h-6 rounded-full bg-purple-500 transition-all flex items-center justify-end pr-2"
                        style={{ width: `${Math.max(pctOfTotal, 2)}%` }}
                      >
                        {pctOfTotal > 15 && (
                          <span className="text-xs font-medium text-white">
                            {pctOfTotal.toFixed(1)}%
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="w-20 shrink-0 text-right">
                      <span className="text-sm font-mono text-gray-600">
                        {count.toLocaleString()}
                      </span>
                    </div>
                    {pctOfTotal <= 15 && (
                      <span className="text-xs text-gray-500 w-14 shrink-0">
                        {pctOfTotal.toFixed(1)}%
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Two-column: Completion by Role + Time to Complete */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Completion by Role */}
        {roleFilter === null && (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Completion by Role
            </h2>

            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-6 bg-gray-100 rounded animate-pulse" />
                ))}
              </div>
            ) : byRole.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">No data available</p>
            ) : (
              <div className="space-y-4">
                {byRole.map((entry) => {
                  const colors = ROLE_COLORS[entry.role] ?? {
                    bg: '#F3F4F6',
                    text: '#4B5563',
                  }
                  const rate = entry.completion_rate ?? 0

                  return (
                    <div key={entry.role}>
                      <div className="flex items-center justify-between mb-1">
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize"
                          style={{
                            backgroundColor: colors.bg,
                            color: colors.text,
                          }}
                        >
                          {entry.role}
                        </span>
                        <div className="flex items-center gap-3 text-sm text-gray-600">
                          <span className="font-mono">
                            {entry.completed}/{entry.signed_up}
                          </span>
                          <span className="font-semibold" style={{ color: colors.text }}>
                            {rate.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-2">
                        <div
                          className="h-2 rounded-full transition-all"
                          style={{
                            width: `${rate}%`,
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
        )}

        {/* Time to Complete */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Median Time to Complete
          </h2>

          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />
              ))}
            </div>
          ) : timeToComplete.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No data available</p>
          ) : (
            <div className="space-y-3">
              {timeToComplete.map((entry) => {
                const colors = ROLE_COLORS[entry.role] ?? {
                  bg: '#F3F4F6',
                  text: '#4B5563',
                }

                return (
                  <div
                    key={entry.role}
                    className="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-50"
                  >
                    <span
                      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize"
                      style={{
                        backgroundColor: colors.bg,
                        color: colors.text,
                      }}
                    >
                      {entry.role}
                    </span>
                    <span className="text-sm font-semibold text-gray-900">
                      {formatDuration(entry.median_minutes)}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Stuck Users Table */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">
          Users Stuck in Onboarding
        </h2>
        <p className="text-sm text-gray-500 mb-4">
          Users who started but haven&apos;t completed onboarding
        </p>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-12 bg-gray-100 rounded animate-pulse" />
            ))}
          </div>
        ) : stuckUsers.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">No stuck users</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-2 font-medium text-gray-500">Role</th>
                  <th className="text-left py-3 px-2 font-medium text-gray-500">
                    Last Step
                  </th>
                  <th className="text-right py-3 px-2 font-medium text-gray-500">
                    Days Since Signup
                  </th>
                </tr>
              </thead>
              <tbody>
                {stuckUsers.map((user, idx) => {
                  const colors = ROLE_COLORS[user.role] ?? {
                    bg: '#F3F4F6',
                    text: '#4B5563',
                  }

                  return (
                    <tr
                      key={idx}
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
                          {user.role}
                        </span>
                      </td>
                      <td className="py-3 px-2 text-gray-700 capitalize">
                        {user.last_step.replace(/_/g, ' ')}
                      </td>
                      <td className="py-3 px-2 text-right font-mono text-gray-900">
                        {Number(user.days_since_signup).toFixed(1)}
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
