/**
 * AdminFunnels Page
 *
 * Conversion funnels, notification effectiveness, and marketplace health dashboard.
 */

import { useState, useCallback, useEffect } from 'react'
import { GitBranch, Users, Briefcase, Bell, Shield, AlertTriangle } from 'lucide-react'
import { StatCard } from '../components/StatCard'
import { getConversionFunnels, getNotificationEffectiveness, getMarketplaceHealth } from '../api/analyticsApi'
import type { ConversionFunnels, NotificationEffectiveness, MarketplaceHealth } from '../types'
import { logger } from '@/lib/logger'

type DaysFilter = 7 | 30 | 90

const formatKind = (kind: string) =>
  kind.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-500',
  shortlisted: 'bg-green-500',
  maybe: 'bg-blue-400',
  rejected: 'bg-red-500',
}

export function AdminFunnels() {
  const [funnels, setFunnels] = useState<ConversionFunnels | null>(null)
  const [notifications, setNotifications] = useState<NotificationEffectiveness | null>(null)
  const [marketplace, setMarketplace] = useState<MarketplaceHealth | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [daysFilter, setDaysFilter] = useState<DaysFilter>(30)

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const [funnelsData, notificationsData, marketplaceData] = await Promise.all([
        getConversionFunnels(daysFilter),
        getNotificationEffectiveness(daysFilter),
        getMarketplaceHealth(daysFilter),
      ])

      setFunnels(funnelsData)
      setNotifications(notificationsData)
      setMarketplace(marketplaceData)
    } catch (err) {
      logger.error('[AdminFunnels] Failed to fetch data:', err)
      setError(err instanceof Error ? err.message : 'Failed to load conversion data')
    } finally {
      setIsLoading(false)
    }
  }, [daysFilter])

  useEffect(() => {
    document.title = 'Conversion & Health | PLAYR Admin'
    fetchData()
  }, [fetchData])

  // Funnel rendering helper
  const renderFunnel = (
    title: string,
    Icon: typeof Users,
    color: string,
    steps: Array<{ label: string; count: number }>
  ) => {
    const maxCount = steps[0]?.count || 1

    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-5">
          <div className={`p-2 rounded-lg ${color === 'blue' ? 'bg-blue-50' : color === 'purple' ? 'bg-purple-50' : 'bg-green-50'}`}>
            <Icon className={`w-4 h-4 ${color === 'blue' ? 'text-blue-600' : color === 'purple' ? 'text-purple-600' : 'text-green-600'}`} />
          </div>
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-10 bg-gray-100 rounded animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {steps.map((step, index) => {
              const widthPct = maxCount > 0 ? (step.count / maxCount) * 100 : 0
              const conversionPct =
                index > 0 && steps[index - 1].count > 0
                  ? ((step.count / steps[index - 1].count) * 100).toFixed(1)
                  : null

              return (
                <div key={step.label}>
                  {conversionPct !== null && (
                    <div className="flex items-center justify-center my-1">
                      <span className="text-xs text-gray-400">{conversionPct}% conversion</span>
                    </div>
                  )}
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-gray-700 w-32 shrink-0">{step.label}</span>
                    <span className="text-sm font-mono font-semibold text-gray-900 w-16 text-right shrink-0">
                      {step.count.toLocaleString()}
                    </span>
                    <div className="flex-1 bg-gray-100 rounded-full h-2.5">
                      <div
                        className={`h-2.5 rounded-full ${
                          color === 'blue' ? 'bg-blue-500' : color === 'purple' ? 'bg-purple-500' : 'bg-green-500'
                        }`}
                        style={{ width: `${Math.max(widthPct, 1)}%` }}
                      />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // Marketplace status breakdown
  const statusBreakdown = marketplace?.status_breakdown ?? []
  const maxStatusCount = Math.max(...statusBreakdown.map(s => s.count), 1)

  // Marketplace by position
  const byPosition = marketplace?.by_position ?? []
  const maxPositionCount = Math.max(...byPosition.map(p => p.count), 1)

  // Notification per_kind sorted by created DESC
  const perKind = [...(notifications?.per_kind ?? [])].sort((a, b) => b.created - a.created)

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-3" />
        <h2 className="text-lg font-semibold text-red-800 mb-2">Failed to load conversion data</h2>
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
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <GitBranch className="w-6 h-6 text-purple-600" />
            Conversion & Health
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            User journey funnels, notification effectiveness, and marketplace balance
          </p>
        </div>
        <div className="flex items-center gap-2">
          {([7, 30, 90] as DaysFilter[]).map(days => (
            <button
              key={days}
              onClick={() => setDaysFilter(days)}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                daysFilter === days
                  ? 'bg-purple-600 text-white'
                  : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
              }`}
            >
              {days}d
            </button>
          ))}
        </div>
      </div>

      {/* Conversion Funnels Section */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Conversion Funnels</h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {renderFunnel('Networking Funnel', Users, 'blue', [
            { label: 'Profile Viewers', count: funnels?.networking_funnel.profile_viewers ?? 0 },
            { label: 'Friend Requesters', count: funnels?.networking_funnel.friend_requesters ?? 0 },
            { label: 'Accepted', count: funnels?.networking_funnel.friend_accepted ?? 0 },
          ])}

          {renderFunnel('Opportunity Funnel', Briefcase, 'purple', [
            { label: 'Vacancy Viewers', count: funnels?.opportunity_funnel.vacancy_viewers ?? 0 },
            { label: 'Applicants', count: funnels?.opportunity_funnel.applicants ?? 0 },
            { label: 'Shortlisted', count: funnels?.opportunity_funnel.shortlisted ?? 0 },
          ])}

          {renderFunnel('Reference Funnel', Shield, 'green', [
            { label: 'Requesters', count: funnels?.reference_funnel.requesters ?? 0 },
            { label: 'Accepted', count: funnels?.reference_funnel.accepted ?? 0 },
          ])}
        </div>
      </div>

      {/* Notification Effectiveness Section */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-5">
          <Bell className="w-5 h-5 text-gray-400" />
          <h2 className="text-lg font-semibold text-gray-900">Notification Effectiveness</h2>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <StatCard
            label="Total Created"
            value={notifications?.totals.total_created ?? 0}
            icon={Bell}
            color="purple"
            loading={isLoading}
          />
          <StatCard
            label="Read Rate"
            value={`${(notifications?.totals.overall_read_rate ?? 0).toFixed(1)}%`}
            icon={Bell}
            color="blue"
            loading={isLoading}
          />
          <StatCard
            label="Click Rate"
            value={`${(notifications?.totals.overall_click_rate ?? 0).toFixed(1)}%`}
            icon={Bell}
            color="green"
            loading={isLoading}
          />
        </div>

        {/* Per-kind table */}
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-10 bg-gray-100 rounded animate-pulse" />
            ))}
          </div>
        ) : perKind.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-4">No notification data for this period</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-3 text-gray-500 font-medium">Kind</th>
                  <th className="text-right py-3 px-3 text-gray-500 font-medium">Created</th>
                  <th className="text-right py-3 px-3 text-gray-500 font-medium">Read</th>
                  <th className="text-right py-3 px-3 text-gray-500 font-medium">Clicks</th>
                  <th className="text-right py-3 px-3 text-gray-500 font-medium">Read Rate</th>
                  <th className="text-right py-3 px-3 text-gray-500 font-medium">Click Rate</th>
                </tr>
              </thead>
              <tbody>
                {perKind.map(row => (
                  <tr key={row.kind} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2.5 px-3 font-medium text-gray-900">{formatKind(row.kind)}</td>
                    <td className="py-2.5 px-3 text-right font-mono">{row.created.toLocaleString()}</td>
                    <td className="py-2.5 px-3 text-right font-mono">{row.read.toLocaleString()}</td>
                    <td className="py-2.5 px-3 text-right font-mono">{row.clicks.toLocaleString()}</td>
                    <td className="py-2.5 px-3 text-right font-mono">
                      <span className={row.read_rate >= 50 ? 'text-green-600' : row.read_rate >= 25 ? 'text-amber-600' : 'text-red-600'}>
                        {row.read_rate.toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono">
                      <span className={row.click_rate >= 20 ? 'text-green-600' : row.click_rate >= 10 ? 'text-amber-600' : 'text-gray-600'}>
                        {row.click_rate.toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Marketplace Health Section */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-5">
          <Briefcase className="w-5 h-5 text-gray-400" />
          <h2 className="text-lg font-semibold text-gray-900">Marketplace Health</h2>
        </div>

        {/* Supply vs Demand */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard
            label="Players Available"
            value={`${marketplace?.supply.players_available ?? 0} / ${marketplace?.supply.total_players ?? 0}`}
            icon={Users}
            color="blue"
            loading={isLoading}
          />
          <StatCard
            label="Coaches Available"
            value={`${marketplace?.supply.coaches_available ?? 0} / ${marketplace?.supply.total_coaches ?? 0}`}
            icon={Users}
            color="green"
            loading={isLoading}
          />
          <StatCard
            label="Open Vacancies"
            value={marketplace?.demand.open_vacancies ?? 0}
            icon={Briefcase}
            color="purple"
            loading={isLoading}
          />
          <StatCard
            label="Clubs Hiring"
            value={marketplace?.demand.clubs_hiring ?? 0}
            icon={Briefcase}
            color="amber"
            loading={isLoading}
          />
        </div>

        {/* Application Velocity */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Application Velocity</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="text-sm text-gray-500">Applications ({daysFilter}d)</div>
              <div className="text-xl font-bold text-gray-900 mt-1">
                {isLoading ? '...' : (marketplace?.velocity.applications_period ?? 0).toLocaleString()}
              </div>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="text-sm text-gray-500">Unique Applicants</div>
              <div className="text-xl font-bold text-gray-900 mt-1">
                {isLoading ? '...' : (marketplace?.velocity.unique_applicants ?? 0).toLocaleString()}
              </div>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="text-sm text-gray-500">Avg Hours to First App</div>
              <div className="text-xl font-bold text-gray-900 mt-1">
                {isLoading ? '...' : `${(marketplace?.velocity.avg_hours_to_first_app ?? 0).toFixed(1)}h`}
              </div>
            </div>
          </div>
        </div>

        {/* Status Breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Status Breakdown</h3>
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />)}
              </div>
            ) : statusBreakdown.length === 0 ? (
              <p className="text-sm text-gray-500">No application data yet</p>
            ) : (
              <div className="space-y-3">
                {statusBreakdown.map(({ status, count }) => (
                  <div key={status}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-gray-700 capitalize">{status}</span>
                      <span className="text-sm font-mono text-gray-600">{count.toLocaleString()}</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2.5">
                      <div
                        className={`h-2.5 rounded-full ${STATUS_COLORS[status] || 'bg-gray-400'}`}
                        style={{ width: `${(count / maxStatusCount) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* By Position */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">By Position</h3>
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />)}
              </div>
            ) : byPosition.length === 0 ? (
              <p className="text-sm text-gray-500">No position data yet</p>
            ) : (
              <div className="space-y-3">
                {byPosition.map(({ position, count }) => (
                  <div key={position}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-gray-700 capitalize">{position}</span>
                      <span className="text-sm font-mono text-gray-600">{count.toLocaleString()}</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2.5">
                      <div
                        className="h-2.5 rounded-full bg-purple-500"
                        style={{ width: `${(count / maxPositionCount) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
