/**
 * AdminPlayers Page
 *
 * Player analytics dashboard showing journey funnel and profile completeness.
 */

import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  Users,
  RefreshCw,
  Video,
  FileText,
  Image,
  UserCheck,
  AlertTriangle,
  TrendingUp,
  Lightbulb,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { StatCard } from '../components/StatCard'
import { getPlayerFunnel, getProfileCompletenessDistribution, getExtendedDashboardStats } from '../api/adminApi'
import type { PlayerFunnel, ProfileCompletenessDistribution, ExtendedDashboardStats } from '../types'
import { logger } from '@/lib/logger'

type DaysFilter = 7 | 30 | 90 | null

// Static color maps — Tailwind JIT requires full class names at build time
const FUNNEL_COLORS: Record<string, { bar: string; icon: string }> = {
  purple: { bar: 'bg-purple-500', icon: 'text-purple-600' },
  blue: { bar: 'bg-blue-500', icon: 'text-blue-600' },
  indigo: { bar: 'bg-indigo-500', icon: 'text-indigo-600' },
  violet: { bar: 'bg-violet-500', icon: 'text-violet-600' },
  pink: { bar: 'bg-pink-500', icon: 'text-pink-600' },
  rose: { bar: 'bg-rose-500', icon: 'text-rose-600' },
  green: { bar: 'bg-green-500', icon: 'text-green-600' },
  amber: { bar: 'bg-amber-500', icon: 'text-amber-600' },
}

const COMPLETENESS_COLORS: Record<string, string> = {
  red: 'bg-red-500',
  amber: 'bg-amber-500',
  blue: 'bg-blue-500',
  green: 'bg-green-500',
  gray: 'bg-gray-400',
}

const COMPLETENESS_COLOR_MAP: Record<string, string> = {
  '0-25%': 'red',
  '26-50%': 'amber',
  '51-75%': 'blue',
  '76-100%': 'green',
}

interface FunnelStep {
  key: keyof PlayerFunnel
  label: string
  icon: LucideIcon
  color: string
}

const FUNNEL_STEPS: FunnelStep[] = [
  { key: 'signed_up', label: 'Signed Up', icon: Users, color: 'purple' },
  { key: 'onboarding_completed', label: 'Onboarding Complete', icon: UserCheck, color: 'blue' },
  { key: 'has_avatar', label: 'Has Avatar', icon: Image, color: 'indigo' },
  { key: 'has_video', label: 'Has Video Highlight', icon: Video, color: 'violet' },
  { key: 'has_journey_entry', label: 'Has Journey Entry', icon: FileText, color: 'pink' },
  { key: 'has_gallery_photo', label: 'Has Gallery Photo', icon: Image, color: 'rose' },
  { key: 'applied_to_vacancy', label: 'Applied to Vacancy', icon: FileText, color: 'green' },
]

export function AdminPlayers() {
  const [funnel, setFunnel] = useState<PlayerFunnel | null>(null)
  const [distribution, setDistribution] = useState<ProfileCompletenessDistribution[]>([])
  const [stats, setStats] = useState<ExtendedDashboardStats | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [daysFilter, setDaysFilter] = useState<DaysFilter>(30)

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const [funnelData, distData, statsData] = await Promise.all([
        getPlayerFunnel(daysFilter ?? undefined),
        getProfileCompletenessDistribution('player'),
        getExtendedDashboardStats(),
      ])

      setFunnel(funnelData)
      setDistribution(distData)
      setStats(statsData)
    } catch (err) {
      logger.error('[AdminPlayers] Failed to fetch data:', err)
      setError(err instanceof Error ? err.message : 'Failed to load player data')
    } finally {
      setIsLoading(false)
    }
  }, [daysFilter])

  useEffect(() => {
    document.title = 'Player Analytics | HOCKIA Admin'
    fetchData()
  }, [fetchData])

  const signedUp = funnel?.signed_up ?? 0

  // Compute insights dynamically from funnel data
  const insights = useMemo(() => {
    if (!funnel || signedUp === 0) return []

    const steps = FUNNEL_STEPS.map((step, i) => {
      const value = Number(funnel[step.key]) || 0
      const prevValue = i > 0 ? Number(funnel[FUNNEL_STEPS[i - 1].key]) || 1 : value
      const conversion = prevValue > 0 ? Math.round((value / prevValue) * 100) : 0
      return { ...step, value, conversion }
    })

    // Find biggest drop-off (lowest step-to-step conversion, skip first step)
    const worstStep = steps.slice(1).reduce((worst, step) =>
      step.conversion < worst.conversion ? step : worst
    )

    const onboardingDropoff = Math.round(((funnel.signed_up - funnel.onboarding_completed) / funnel.signed_up) * 100)
    const applicationRate = funnel.onboarding_completed > 0
      ? Math.round((funnel.applied_to_vacancy / funnel.onboarding_completed) * 100)
      : 0

    const result: { value: string; label: string; color: string }[] = [
      {
        value: `${worstStep.conversion}%`,
        label: `conversion at "${worstStep.label}" — biggest bottleneck`,
        color: 'text-red-600',
      },
      {
        value: `${onboardingDropoff}%`,
        label: 'drop off before completing onboarding',
        color: 'text-amber-600',
      },
      {
        value: `${applicationRate}%`,
        label: 'of onboarded players applied to a vacancy',
        color: 'text-green-600',
      },
    ]

    if (funnel.open_to_opportunities !== undefined) {
      const openRate = funnel.onboarding_completed > 0
        ? Math.round((funnel.open_to_opportunities / funnel.onboarding_completed) * 100)
        : 0
      result.push({
        value: `${openRate}%`,
        label: 'of onboarded players are open to opportunities',
        color: 'text-blue-600',
      })
    }

    return result
  }, [funnel, signedUp])

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-3" />
        <h2 className="text-lg font-semibold text-red-800 mb-2">Failed to load player data</h2>
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
          <h1 className="text-2xl font-bold text-gray-900">Player Analytics</h1>
          <p className="text-sm text-gray-500 mt-1">
            Monitor player journey funnel and profile completeness
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
          label="Players with Video"
          value={stats?.players_with_video ?? 0}
          icon={Video}
          color="purple"
          loading={isLoading}
          trend={stats?.players_with_video_pct ? {
            value: stats.players_with_video_pct,
            label: 'of all players',
            direction: 'up',
          } : undefined}
        />
        <StatCard
          label="Applied (Ever)"
          value={stats?.players_applied_ever ?? 0}
          icon={FileText}
          color="blue"
          loading={isLoading}
        />
        <StatCard
          label="Applied (7d)"
          value={stats?.players_applied_7d ?? 0}
          icon={TrendingUp}
          color="green"
          loading={isLoading}
        />
        <StatCard
          label="Avg Profile Score"
          value={`${stats?.avg_profile_score ?? 0}%`}
          icon={UserCheck}
          color="amber"
          loading={isLoading}
        />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 bg-white p-4 rounded-xl border border-gray-200">
        <label className="text-sm text-gray-600">Funnel period:</label>
        <select
          id="funnel-period-filter"
          aria-label="Filter funnel by time period"
          value={daysFilter ?? 'all'}
          onChange={(e) => {
            const val = e.target.value
            setDaysFilter(val === 'all' ? null : Number(val) as DaysFilter)
          }}
          className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-purple-500"
        >
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
          <option value="all">All time</option>
        </select>
      </div>

      {/* Journey Funnel */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-6">Player Journey Funnel</h2>

        {isLoading ? (
          <div className="space-y-6">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="space-y-2 animate-pulse">
                <div className="flex justify-between">
                  <div className="h-4 w-32 bg-gray-200 rounded" />
                  <div className="h-4 w-20 bg-gray-200 rounded" />
                </div>
                <div className="h-8 bg-gray-100 rounded-lg" />
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-5">
            {FUNNEL_STEPS.map((step, index) => {
              const value = Number(funnel?.[step.key]) || 0
              const percentage = signedUp > 0 ? Math.round((value / signedUp) * 100) : 0
              const widthPct = Math.max(percentage, 4)
              const colors = FUNNEL_COLORS[step.color] || FUNNEL_COLORS.purple
              const Icon = step.icon

              // Step-to-step conversion
              const prevValue = index > 0
                ? Number(funnel?.[FUNNEL_STEPS[index - 1].key]) || 0
                : value
              const stepConversion = prevValue > 0
                ? Math.round((value / prevValue) * 100)
                : 0

              return (
                <div key={step.key} className="space-y-1.5">
                  {/* Step header */}
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                    <div className="flex items-center gap-2">
                      <Icon className={`w-4 h-4 flex-shrink-0 ${colors.icon}`} />
                      <span className="text-sm font-medium text-gray-700">{step.label}</span>
                    </div>
                    <div className="flex items-center gap-3 pl-6 sm:pl-0">
                      <span className="text-sm font-bold text-gray-900">{value.toLocaleString()}</span>
                      <span className="text-xs text-gray-500">{percentage}% of total</span>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="h-7 bg-gray-100 rounded-lg overflow-hidden">
                    <div
                      className={`h-full rounded-lg transition-all duration-500 ${colors.bar}`}
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>

                  {/* Drop-off indicator */}
                  {index > 0 && (
                    <p className="text-xs text-gray-400 pl-6">
                      {stepConversion}% from {FUNNEL_STEPS[index - 1].label}
                      {stepConversion < 100 && (
                        <span className="text-gray-300"> &middot; {100 - stepConversion}% drop-off</span>
                      )}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Profile Completeness Distribution */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-6">Profile Completeness Distribution</h2>

        {isLoading ? (
          <div className="space-y-4 animate-pulse">
            <div className="h-10 bg-gray-100 rounded-lg" />
            <div className="flex gap-6">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-4 w-20 bg-gray-200 rounded" />
              ))}
            </div>
          </div>
        ) : (
          <>
            {/* Stacked horizontal bar */}
            <div className="h-10 bg-gray-100 rounded-lg overflow-hidden flex">
              {distribution.map(({ bucket, percentage }) => {
                const colorKey = COMPLETENESS_COLOR_MAP[bucket] || 'gray'
                const barClass = COMPLETENESS_COLORS[colorKey] || COMPLETENESS_COLORS.gray
                return (
                  <div
                    key={bucket}
                    className={`${barClass} transition-all duration-500 first:rounded-l-lg last:rounded-r-lg`}
                    style={{ width: `${Math.max(percentage, 1)}%` }}
                    title={`${bucket}: ${percentage}%`}
                  />
                )
              })}
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-x-6 gap-y-2 mt-4">
              {distribution.map(({ bucket, count, percentage }) => {
                const colorKey = COMPLETENESS_COLOR_MAP[bucket] || 'gray'
                const dotClass = COMPLETENESS_COLORS[colorKey] || COMPLETENESS_COLORS.gray
                return (
                  <div key={bucket} className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-sm flex-shrink-0 ${dotClass}`} />
                    <span className="text-sm text-gray-600">{bucket}</span>
                    <span className="text-sm font-semibold text-gray-900">{count.toLocaleString()}</span>
                    <span className="text-xs text-gray-400">({percentage}%)</span>
                  </div>
                )
              })}
            </div>
          </>
        )}

        {/* Summary */}
        <div className="mt-6 pt-4 border-t border-gray-100">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
            <div>
              <p className="text-sm text-gray-500">Onboarding Rate</p>
              <p className="text-xl font-bold text-gray-900">{stats?.onboarding_rate ?? 0}%</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">With Video</p>
              <p className="text-xl font-bold text-gray-900">{stats?.players_with_video_pct ?? 0}%</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Avg Score</p>
              <p className="text-xl font-bold text-gray-900">{stats?.avg_profile_score ?? 0}%</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Ever Applied</p>
              <p className="text-xl font-bold text-gray-900">{stats?.players_applied_ever ?? 0}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Key Insights */}
      {insights.length > 0 && (
        <div className="bg-gradient-to-br from-purple-50 to-blue-50 rounded-xl border border-purple-100 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Lightbulb className="w-5 h-5 text-purple-500" />
            <h2 className="text-lg font-semibold text-gray-900">Key Insights</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {insights.map((insight, i) => (
              <div key={i} className="flex items-baseline gap-2 bg-white/80 rounded-lg px-4 py-3">
                <span className={`text-xl font-bold flex-shrink-0 ${insight.color}`}>
                  {insight.value}
                </span>
                <span className="text-sm text-gray-600">{insight.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
