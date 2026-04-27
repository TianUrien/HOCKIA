/**
 * AdminOverview Page
 *
 * Founder Command Center — answers "is the product working?" in 10 seconds.
 * KPI cards, health signals, growth chart, retention curves, activation funnel.
 * Detailed legacy metrics are available in a collapsible accordion below.
 */

import { useEffect, useState } from 'react'
import { formatAdminDateTime } from '../utils/formatDate'
import { Link } from 'react-router-dom'
import {
  Users,
  UserCheck,
  Building2,
  Briefcase,
  FileText,
  MessageSquare,
  UserX,
  AlertTriangle,
  RefreshCw,
  TrendingUp,
  Store,
  Package,
  Activity,
  Bell,
  Smartphone,
  ChevronDown,
} from 'lucide-react'
import { StatCard } from '../components/StatCard'
import { CommandCenterKPICard } from '../components/CommandCenterKPICard'
import { CommandCenterGrowthChart } from '../components/CommandCenterGrowthChart'
import { RetentionCurveChart } from '../components/RetentionCurveChart'
import { ActivationFunnel } from '../components/ActivationFunnel'
import { HealthSignals } from '../components/HealthSignals'
import { ProductHealthHero } from '../components/ProductHealthHero'
import { useAdminStats } from '../hooks/useAdminStats'
import { useCommandCenter } from '../hooks/useCommandCenter'
import { getErrorBudgetStatus } from '@/lib/errorBudget'
import type { ErrorBudgetStatus } from '@/lib/errorBudget'

type DaysFilter = 7 | 30 | 90

export function AdminOverview() {
  const [daysFilter, setDaysFilter] = useState<DaysFilter>(30)
  const { stats, signupTrends, topCountries, isLoading, error, refetch } = useAdminStats()
  const {
    stats: ccStats,
    growthData,
    cohorts,
    funnel,
    isLoading: ccLoading,
    error: ccError,
    refetch: ccRefetch,
  } = useCommandCenter(daysFilter)
  const [errorBudget, setErrorBudget] = useState<ErrorBudgetStatus | null>(null)

  useEffect(() => {
    document.title = 'Founder Command Center | HOCKIA'
    setErrorBudget(getErrorBudgetStatus())
    const interval = setInterval(() => setErrorBudget(getErrorBudgetStatus()), 60000)
    return () => clearInterval(interval)
  }, [])

  const handleRefresh = () => {
    refetch()
    ccRefetch()
  }

  const combinedLoading = isLoading || ccLoading
  const combinedError = error || ccError

  if (combinedError) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-3" />
        <h2 className="text-lg font-semibold text-red-800 mb-2">Failed to load dashboard</h2>
        <p className="text-sm text-red-600 mb-4">{combinedError}</p>
        <button
          onClick={handleRefresh}
          className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
        >
          Try Again
        </button>
      </div>
    )
  }

  // KPI trend helpers
  const userChange = (ccStats?.total_users ?? 0) - (ccStats?.total_users_prev ?? 0)
  const userChangePct = (ccStats?.total_users_prev ?? 0) > 0
    ? (userChange / ccStats!.total_users_prev) * 100
    : 0

  const oppsChange = (ccStats?.live_opportunities ?? 0) - (ccStats?.live_opportunities_prev ?? 0)
  const oppsChangePct = (ccStats?.live_opportunities_prev ?? 0) > 0
    ? (oppsChange / ccStats!.live_opportunities_prev) * 100
    : 0

  const appsChange = (ccStats?.applications_period ?? 0) - (ccStats?.applications_prev ?? 0)
  const appsChangePct = (ccStats?.applications_prev ?? 0) > 0
    ? (appsChange / ccStats!.applications_prev) * 100
    : 0

  // Calculate 7-day trends from signup data (for detailed section)
  const recent7dSignups = signupTrends.slice(-7).reduce((sum, d) => sum + d.total_signups, 0)
  const previous7dSignups = signupTrends.slice(-14, -7).reduce((sum, d) => sum + d.total_signups, 0)
  const signupTrend = previous7dSignups > 0 ? ((recent7dSignups - previous7dSignups) / previous7dSignups * 100).toFixed(0) : 0

  return (
    <div className="space-y-6">
      {/* ============================================================= */}
      {/* COMMAND CENTER HEADER                                          */}
      {/* ============================================================= */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Founder Command Center</h1>
          <p className="text-sm text-gray-500 mt-1">
            Is the product working? Key signals at a glance.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={daysFilter}
            onChange={(e) => setDaysFilter(Number(e.target.value) as DaysFilter)}
            title="Time period filter"
            className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={combinedLoading}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${combinedLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* ============================================================= */}
      {/* PRODUCT HEALTH SCORE — HERO                                    */}
      {/* ============================================================= */}
      <ProductHealthHero />

      {/* ============================================================= */}
      {/* 4 KPI CARDS                                                    */}
      {/* ============================================================= */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <CommandCenterKPICard
          label="Total Users"
          value={ccStats?.total_users ?? 0}
          change={userChange}
          changePct={userChangePct}
          subtitle={`DAU ${ccStats?.dau ?? 0} · WAU ${ccStats?.wau ?? 0} · MAU ${ccStats?.mau ?? 0}`}
          loading={ccLoading}
        />
        <CommandCenterKPICard
          label="Live Opportunities"
          value={ccStats?.live_opportunities ?? 0}
          change={oppsChange}
          changePct={oppsChangePct}
          loading={ccLoading}
        />
        <CommandCenterKPICard
          label={`Applications (${daysFilter}d)`}
          value={ccStats?.applications_period ?? 0}
          change={appsChange}
          changePct={appsChangePct}
          subtitle={`${ccStats?.application_conversion ?? 0}% view-to-apply`}
          loading={ccLoading}
        />
        <CommandCenterKPICard
          label="WAU / MAU"
          value={`${ccStats?.wau_mau_ratio ?? 0}%`}
          subtitle="Stickiness ratio"
          loading={ccLoading}
        />
      </div>

      {/* ============================================================= */}
      {/* HEALTH SIGNALS                                                 */}
      {/* ============================================================= */}
      <HealthSignals stats={ccStats} loading={ccLoading} />

      {/* ============================================================= */}
      {/* USER GROWTH CHART                                              */}
      {/* ============================================================= */}
      <CommandCenterGrowthChart data={growthData} loading={ccLoading} />

      {/* ============================================================= */}
      {/* RETENTION + FUNNEL (2-column)                                  */}
      {/* ============================================================= */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RetentionCurveChart cohorts={cohorts} loading={ccLoading} />
        <ActivationFunnel data={funnel} loading={ccLoading} />
      </div>

      {/* ============================================================= */}
      {/* DETAILED METRICS (collapsible accordion)                       */}
      {/* ============================================================= */}
      <details className="group">
        <summary className="flex items-center gap-2 cursor-pointer list-none text-sm font-semibold text-gray-500 hover:text-gray-700 transition-colors py-3 border-t border-gray-200">
          <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180" />
          Detailed Metrics
        </summary>
        <div className="space-y-6 pt-4">
          {/* User Metrics */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Users</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <StatCard
                label="Total Users"
                value={stats?.total_users ?? 0}
                icon={Users}
                color="purple"
                loading={isLoading}
                trend={
                  signupTrend !== 0
                    ? {
                        value: Number(signupTrend),
                        label: 'vs last 7d',
                        direction: Number(signupTrend) > 0 ? 'up' : 'down',
                      }
                    : undefined
                }
              />
              <StatCard
                label="Players"
                value={stats?.total_players ?? 0}
                icon={UserCheck}
                color="blue"
                loading={isLoading}
              />
              <StatCard
                label="Coaches"
                value={stats?.total_coaches ?? 0}
                icon={UserCheck}
                color="green"
                loading={isLoading}
              />
              <StatCard
                label="Clubs"
                value={stats?.total_clubs ?? 0}
                icon={Building2}
                color="amber"
                loading={isLoading}
              />
              <StatCard
                label="Brands"
                value={stats?.total_brands ?? 0}
                icon={Store}
                color="purple"
                loading={isLoading}
              />
            </div>
          </section>

          {/* Signups */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Signups</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                label="Last 7 Days"
                value={stats?.signups_7d ?? 0}
                icon={TrendingUp}
                color="purple"
                loading={isLoading}
              />
              <StatCard
                label="Last 30 Days"
                value={stats?.signups_30d ?? 0}
                icon={TrendingUp}
                color="blue"
                loading={isLoading}
              />
              <StatCard
                label="Onboarding Complete"
                value={stats?.onboarding_completed ?? 0}
                icon={UserCheck}
                color="green"
                loading={isLoading}
              />
              <StatCard
                label="Onboarding Pending"
                value={stats?.onboarding_pending ?? 0}
                icon={UserX}
                color="amber"
                loading={isLoading}
              />
            </div>
          </section>

          {/* Content Metrics */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Content</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                label="Total Vacancies"
                value={stats?.total_vacancies ?? 0}
                icon={Briefcase}
                color="purple"
                loading={isLoading}
              />
              <StatCard
                label="Open Vacancies"
                value={stats?.open_vacancies ?? 0}
                icon={Briefcase}
                color="green"
                loading={isLoading}
              />
              <StatCard
                label="Total Applications"
                value={stats?.total_applications ?? 0}
                icon={FileText}
                color="blue"
                loading={isLoading}
              />
              <StatCard
                label="Applications (7d)"
                value={stats?.applications_7d ?? 0}
                icon={FileText}
                color="amber"
                loading={isLoading}
              />
            </div>
          </section>

          {/* Brands */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Brands</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                label="Total Brands"
                value={stats?.total_brands ?? 0}
                icon={Store}
                color="purple"
                loading={isLoading}
              />
              <StatCard
                label="New Brands (7d)"
                value={stats?.brands_7d ?? 0}
                icon={TrendingUp}
                color="blue"
                loading={isLoading}
              />
              <StatCard
                label="Brand Products"
                value={stats?.total_brand_products ?? 0}
                icon={Package}
                color="green"
                loading={isLoading}
              />
              <StatCard
                label="Brand Posts"
                value={stats?.total_brand_posts ?? 0}
                icon={FileText}
                color="amber"
                loading={isLoading}
              />
            </div>
          </section>

          {/* Engagement */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Engagement</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                label="Conversations"
                value={stats?.total_conversations ?? 0}
                icon={MessageSquare}
                color="purple"
                loading={isLoading}
              />
              <StatCard
                label="Messages (7d)"
                value={stats?.messages_7d ?? 0}
                icon={MessageSquare}
                color="blue"
                loading={isLoading}
              />
              <StatCard
                label="Friendships"
                value={stats?.total_friendships ?? 0}
                icon={Users}
                color="green"
                loading={isLoading}
              />
              <StatCard
                label="Blocked Users"
                value={stats?.blocked_users ?? 0}
                icon={UserX}
                color="red"
                loading={isLoading}
              />
            </div>
          </section>

          {/* Push & PWA */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Push & PWA</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                label="Push Subscribers"
                value={stats?.push_subscribers ?? 0}
                icon={Bell}
                color="purple"
                loading={isLoading}
              />
              <StatCard
                label="Push Activation Rate"
                value={
                  stats?.total_users
                    ? `${((stats.push_subscribers / stats.total_users) * 100).toFixed(1)}%`
                    : '0%'
                }
                icon={Bell}
                color="blue"
                loading={isLoading}
              />
              <StatCard
                label="PWA Installs"
                value={stats?.pwa_installs ?? 0}
                icon={Smartphone}
                color="green"
                loading={isLoading}
              />
              <StatCard
                label="iOS / Android / Desktop"
                value={`${stats?.pwa_installs_ios ?? 0} / ${stats?.pwa_installs_android ?? 0} / ${stats?.pwa_installs_desktop ?? 0}`}
                icon={Smartphone}
                color="amber"
                loading={isLoading}
              />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4">
              <StatCard
                label="Players (Push)"
                value={stats?.push_subscribers_player ?? 0}
                color="blue"
                loading={isLoading}
              />
              <StatCard
                label="Coaches (Push)"
                value={stats?.push_subscribers_coach ?? 0}
                color="green"
                loading={isLoading}
              />
              <StatCard
                label="Clubs (Push)"
                value={stats?.push_subscribers_club ?? 0}
                color="amber"
                loading={isLoading}
              />
              <StatCard
                label="Brands (Push)"
                value={stats?.push_subscribers_brand ?? 0}
                color="rose"
                loading={isLoading}
              />
            </div>
          </section>

          {/* Device Tracking */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Devices (All Users)</h2>
              <Link to="/admin/devices" className="text-sm text-purple-600 hover:text-purple-700 font-medium">
                View all →
              </Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              <Link to="/admin/devices/ios" className="block transition hover:-translate-y-0.5 hover:shadow-md rounded-xl">
                <StatCard
                  label="iOS Users"
                  value={stats?.device_users_ios ?? 0}
                  icon={Smartphone}
                  color="blue"
                  loading={isLoading}
                />
              </Link>
              <Link to="/admin/devices/android" className="block transition hover:-translate-y-0.5 hover:shadow-md rounded-xl">
                <StatCard
                  label="Android Users"
                  value={stats?.device_users_android ?? 0}
                  icon={Smartphone}
                  color="green"
                  loading={isLoading}
                />
              </Link>
              <Link to="/admin/devices/desktop" className="block transition hover:-translate-y-0.5 hover:shadow-md rounded-xl">
                <StatCard
                  label="Desktop Users"
                  value={stats?.device_users_desktop ?? 0}
                  icon={Smartphone}
                  color="purple"
                  loading={isLoading}
                />
              </Link>
              <Link to="/admin/devices/pwa" className="block transition hover:-translate-y-0.5 hover:shadow-md rounded-xl">
                <StatCard
                  label="PWA Users"
                  value={stats?.device_users_pwa ?? 0}
                  icon={Smartphone}
                  color="amber"
                  loading={isLoading}
                />
              </Link>
              <Link to="/admin/devices/multi" className="block transition hover:-translate-y-0.5 hover:shadow-md rounded-xl">
                <StatCard
                  label="Multi-Platform"
                  value={stats?.device_users_multi_platform ?? 0}
                  icon={Smartphone}
                  color="rose"
                  loading={isLoading}
                />
              </Link>
            </div>
          </section>

          {/* Data Health */}
          <section>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Data Health</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Error Budget Card */}
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-gray-500">Error Budget</span>
                  <div className={`p-2 rounded-lg ${
                    errorBudget?.status === 'exceeded' ? 'bg-red-50' :
                    errorBudget?.status === 'warning' ? 'bg-amber-50' : 'bg-green-50'
                  }`}>
                    <Activity className={`w-4 h-4 ${
                      errorBudget?.status === 'exceeded' ? 'text-red-600' :
                      errorBudget?.status === 'warning' ? 'text-amber-600' : 'text-green-600'
                    }`} />
                  </div>
                </div>
                <div className="text-2xl font-bold text-gray-900">
                  {errorBudget ? `${errorBudget.remaining.toFixed(2)}%` : '—'}
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {errorBudget?.status === 'exceeded' ? 'Budget exceeded — investigate errors' :
                   errorBudget?.status === 'warning' ? 'Budget running low' :
                   'Remaining of 1% budget (last hour)'}
                </p>
                {errorBudget && (
                  <div className="mt-3 w-full bg-gray-100 rounded-full h-1.5">
                    <div
                      className={`h-1.5 rounded-full transition-all ${
                        errorBudget.status === 'exceeded' ? 'bg-red-500' :
                        errorBudget.status === 'warning' ? 'bg-amber-500' : 'bg-green-500'
                      }`}
                      style={{ width: `${Math.min(100, (errorBudget.errorRate / errorBudget.budget) * 100)}%` }}
                    />
                  </div>
                )}
              </div>
              <Link
                to="/admin/data-issues"
                className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-gray-500">Auth Orphans</span>
                  <div className="p-2 rounded-lg bg-red-50">
                    <AlertTriangle className="w-4 h-4 text-red-600" />
                  </div>
                </div>
                <div className="text-2xl font-bold text-gray-900">
                  {isLoading ? (
                    <span className="inline-block w-12 h-8 bg-gray-200 rounded animate-pulse" />
                  ) : (
                    stats?.auth_orphans ?? 0
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-1">Users without profiles</p>
              </Link>

              <Link
                to="/admin/data-issues"
                className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-gray-500">Profile Orphans</span>
                  <div className="p-2 rounded-lg bg-amber-50">
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                  </div>
                </div>
                <div className="text-2xl font-bold text-gray-900">
                  {isLoading ? (
                    <span className="inline-block w-12 h-8 bg-gray-200 rounded animate-pulse" />
                  ) : (
                    stats?.profile_orphans ?? 0
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-1">Profiles without auth users</p>
              </Link>

              <Link
                to="/admin/data-issues"
                className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-medium text-gray-500">Test Accounts</span>
                  <div className="p-2 rounded-lg bg-purple-50">
                    <Users className="w-4 h-4 text-purple-600" />
                  </div>
                </div>
                <div className="text-2xl font-bold text-gray-900">
                  {isLoading ? (
                    <span className="inline-block w-12 h-8 bg-gray-200 rounded animate-pulse" />
                  ) : (
                    stats?.test_accounts ?? 0
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-1">Marked as test data</p>
              </Link>
            </div>
          </section>

          {/* Top Countries */}
          {topCountries.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Top Countries</h2>
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase">
                        Country
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600 uppercase">
                        Users
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {topCountries.map((country, index) => (
                      <tr key={country.country} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm text-gray-900">
                          <span className="mr-2">{index + 1}.</span>
                          {country.country}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 text-right">
                          {country.user_count.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </details>

      {/* Last updated */}
      {(ccStats?.generated_at || stats?.generated_at) && (
        <p className="text-xs text-gray-400 text-center">
          Last updated: {formatAdminDateTime(ccStats?.generated_at ?? stats?.generated_at ?? '')}
        </p>
      )}
    </div>
  )
}
