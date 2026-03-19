/**
 * InvestorDashboardContent Component
 *
 * Shared content for the investor metrics dashboard.
 * Used by both admin view (/admin/investors) and public view (/investors/:token).
 */

import { useState, useEffect } from 'react'
import { formatAdminDateTime } from '../utils/formatDate'
import { Users, TrendingUp, Briefcase, MessageSquare, Globe, UserCheck, GraduationCap, Store } from 'lucide-react'
import { StatCard } from './StatCard'
import { UserGrowthChart } from './UserGrowthChart'
import { RoleBreakdownChart } from './RoleBreakdownChart'
import type { InvestorMetrics, InvestorSignupTrend } from '../types'

interface InvestorDashboardContentProps {
  metrics: InvestorMetrics | null
  trends: InvestorSignupTrend[] | null
  loading: boolean
  error: string | null
  onRefresh?: () => void
  showWatermark?: boolean
}

export function InvestorDashboardContent({
  metrics,
  trends,
  loading,
  error,
  onRefresh,
  showWatermark = false,
}: InvestorDashboardContentProps) {
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)

  useEffect(() => {
    if (metrics?.generated_at) {
      const date = new Date(metrics.generated_at)
      const now = new Date()
      const diffMinutes = Math.floor((now.getTime() - date.getTime()) / 60000)

      if (diffMinutes < 1) {
        setLastUpdated('Just now')
      } else if (diffMinutes < 60) {
        setLastUpdated(`${diffMinutes} min ago`)
      } else {
        setLastUpdated(formatAdminDateTime(date))
      }
    }
  }, [metrics?.generated_at])

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
          <span className="text-2xl">!</span>
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Unable to load metrics</h2>
        <p className="text-gray-500 mb-4">{error}</p>
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
          >
            Try Again
          </button>
        )}
      </div>
    )
  }

  const growthDirection = (metrics?.growth_rate_30d ?? 0) >= 0 ? 'up' : 'down'

  return (
    <div className="space-y-8">
      {/* Last Updated */}
      {lastUpdated && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>Last updated: {lastUpdated}</span>
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={loading}
              className="text-purple-600 hover:text-purple-700 disabled:opacity-50"
            >
              Refresh
            </button>
          )}
        </div>
      )}

      {/* Headline Metrics */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Key Metrics</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <StatCard
            label="Total Users"
            value={metrics?.total_users ?? 0}
            icon={Users}
            color="purple"
            loading={loading}
          />
          <StatCard
            label="Growth (30d)"
            value={`${(metrics?.growth_rate_30d ?? 0) >= 0 ? '+' : ''}${metrics?.growth_rate_30d ?? 0}%`}
            icon={TrendingUp}
            color={growthDirection === 'up' ? 'green' : 'red'}
            trend={{
              value: metrics?.signups_30d ?? 0,
              label: 'new users',
              direction: growthDirection,
            }}
            loading={loading}
          />
          <StatCard
            label="Players"
            value={metrics?.total_players ?? 0}
            icon={UserCheck}
            color="blue"
            trend={
              metrics?.total_users
                ? {
                    value: Math.round((metrics.total_players / metrics.total_users) * 100),
                    label: '% of users',
                    direction: 'neutral',
                  }
                : undefined
            }
            loading={loading}
          />
          <StatCard
            label="Coaches"
            value={metrics?.total_coaches ?? 0}
            icon={GraduationCap}
            color="green"
            trend={
              metrics?.total_users
                ? {
                    value: Math.round((metrics.total_coaches / metrics.total_users) * 100),
                    label: '% of users',
                    direction: 'neutral',
                  }
                : undefined
            }
            loading={loading}
          />
          <StatCard
            label="Clubs"
            value={metrics?.total_clubs ?? 0}
            icon={Briefcase}
            color="amber"
            trend={
              metrics?.total_users
                ? {
                    value: Math.round((metrics.total_clubs / metrics.total_users) * 100),
                    label: '% of users',
                    direction: 'neutral',
                  }
                : undefined
            }
            loading={loading}
          />
          <StatCard
            label="Brands"
            value={metrics?.total_brands ?? 0}
            icon={Store}
            color="rose"
            trend={
              metrics?.total_users
                ? {
                    value: Math.round(((metrics.total_brands ?? 0) / metrics.total_users) * 100),
                    label: '% of users',
                    direction: 'neutral',
                  }
                : undefined
            }
            loading={loading}
          />
        </div>
      </section>

      {/* User Growth Chart */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">User Growth (Last 90 Days)</h2>
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <UserGrowthChart trends={trends} loading={loading} />
        </div>
      </section>

      {/* Geographic & Role Distribution */}
      <section className="grid md:grid-cols-2 gap-6">
        {/* Geographic Distribution */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Globe className="w-5 h-5 text-gray-500" />
            <h3 className="font-semibold text-gray-900">Geographic Distribution</h3>
          </div>
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex items-center gap-3 animate-pulse">
                  <div className="w-6 h-4 bg-gray-200 rounded" />
                  <div className="flex-1 h-4 bg-gray-200 rounded" />
                  <div className="w-12 h-4 bg-gray-200 rounded" />
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {(metrics?.top_countries || []).slice(0, 10).map((country, index) => {
                const maxCount = metrics?.top_countries[0]?.user_count || 1
                const percentage = Math.round((country.user_count / maxCount) * 100)
                return (
                  <div key={country.country} className="flex items-center gap-3">
                    <span className="w-6 text-sm text-gray-500 font-medium">{index + 1}.</span>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-gray-900">{country.country}</span>
                        <span className="text-sm text-gray-500">{country.user_count}</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-purple-500 to-blue-500 rounded-full transition-all duration-500"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  </div>
                )
              })}
              {(!metrics?.top_countries || metrics.top_countries.length === 0) && (
                <p className="text-sm text-gray-500 text-center py-4">No geographic data available</p>
              )}
            </div>
          )}
        </div>

        {/* Role Breakdown */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <Users className="w-5 h-5 text-gray-500" />
            <h3 className="font-semibold text-gray-900">User Role Breakdown</h3>
          </div>
          <RoleBreakdownChart
            players={metrics?.total_players ?? 0}
            coaches={metrics?.total_coaches ?? 0}
            clubs={metrics?.total_clubs ?? 0}
            brands={metrics?.total_brands ?? 0}
            loading={loading}
          />
        </div>
      </section>

      {/* Engagement Signals */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Engagement Signals</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Daily Active Users"
            value={metrics?.dau_7d_avg ?? 0}
            icon={Users}
            color="purple"
            trend={{
              value: 7,
              label: 'day avg',
              direction: 'neutral',
            }}
            loading={loading}
          />
          <StatCard
            label="Messages (30d)"
            value={metrics?.total_messages_30d ?? 0}
            icon={MessageSquare}
            color="blue"
            loading={loading}
          />
          <StatCard
            label="Applications (30d)"
            value={metrics?.total_applications_30d ?? 0}
            icon={Briefcase}
            color="green"
            loading={loading}
          />
          <StatCard
            label="Open Opportunities"
            value={metrics?.total_opportunities ?? 0}
            icon={Briefcase}
            color="amber"
            loading={loading}
          />
        </div>
      </section>

      {/* Watermark for public view */}
      {showWatermark && (
        <div className="text-center pt-8 pb-4 border-t border-gray-200">
          <p className="text-sm text-gray-400">
            Generated with{' '}
            <a
              href="https://inhockia.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-purple-500 hover:text-purple-600 font-medium"
            >
              HOCKIA
            </a>
          </p>
        </div>
      )}
    </div>
  )
}
