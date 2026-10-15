/**
 * OverviewCharts — the picture of the product in six panels, under the KPI
 * strip on the admin Overview (founder request 2026-10-15: "more charts, pie
 * charts, bar charts" instead of grids of numbers).
 *
 *   Members      who is here (role donut) · who joined, week by week, by role
 *   Activity     messages & conversations per day · applications & roles per week · roles by status
 *   Reach        devices donut · push by role · top countries
 *
 * Everything draws from data the Overview already loads (dashboard stats,
 * 90 days of signup trends, top countries) plus one new daily series,
 * admin_get_activity_series. The number tiles those charts replace stay in
 * the "Detailed metrics" accordion below.
 */
import { useQuery } from '@tanstack/react-query'
import type { DashboardStats, SignupTrend, TopCountry } from '../types'
import { getActivitySeries } from '../api/adminApi'
import { DonutChartCard } from './charts/DonutChartCard'
import { StackedBarsCard } from './charts/StackedBarsCard'
import { TrendAreaCard } from './charts/TrendAreaCard'
import { RankedBarsCard } from './charts/RankedBarsCard'
import { ROLE_COLORS, ROLE_LABELS, SERIES_COLORS, shortDay, toWeekly } from '../lib/adminCharts'

interface OverviewChartsProps {
  stats: DashboardStats | null
  signupTrends: SignupTrend[]
  topCountries: TopCountry[]
  /** The Overview's period filter (7 / 30 / 90) drives the daily activity window. */
  days: number
  loading?: boolean
}

function SectionHeading({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex items-baseline gap-2 pt-2">
      <h2 className="text-sm font-bold text-gray-900">{title}</h2>
      <span className="text-xs text-gray-400">{hint}</span>
    </div>
  )
}

export function OverviewCharts({ stats, signupTrends, topCountries, days, loading = false }: OverviewChartsProps) {
  const activity = useQuery({
    queryKey: ['admin', 'activity-series', days],
    queryFn: () => getActivitySeries(days),
    staleTime: 5 * 60 * 1000,
  })
  const activityRows = (activity.data ?? []).map((d) => ({ ...d, label: shortDay(d.day) }))

  // Sign-ups: the 90-day daily trend rolled into Monday-start weeks, by role.
  const weeklySignups = toWeekly(signupTrends, 'date', ['players', 'coaches', 'clubs', 'brands'])
  // Applications and roles posted: daily activity rolled into weeks.
  const weeklyActivity = toWeekly(activity.data ?? [], 'day', ['applications', 'opportunities'])

  const roleSlices = [
    { label: ROLE_LABELS.player, value: stats?.total_players ?? 0, color: ROLE_COLORS.player },
    { label: ROLE_LABELS.coach, value: stats?.total_coaches ?? 0, color: ROLE_COLORS.coach },
    { label: ROLE_LABELS.club, value: stats?.total_clubs ?? 0, color: ROLE_COLORS.club },
    { label: ROLE_LABELS.umpire, value: stats?.total_umpires ?? 0, color: ROLE_COLORS.umpire },
    { label: ROLE_LABELS.brand, value: stats?.total_brands ?? 0, color: ROLE_COLORS.brand },
  ]
  const roleSum = roleSlices.reduce((n, s) => n + s.value, 0)
  const otherRoles = Math.max(0, (stats?.total_users ?? 0) - roleSum)
  if (otherRoles > 0) roleSlices.push({ label: ROLE_LABELS.other, value: otherRoles, color: ROLE_COLORS.other })

  return (
    <div className="space-y-3" data-testid="overview-charts">
      <SectionHeading title="Members" hint="who is here, and who joined when" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DonutChartCard
          title="Members by role"
          hint="Every account with a role; the centre is the total."
          slices={roleSlices}
          centerLabel="members"
          total={stats?.total_users ?? 0}
          loading={loading}
        />
        <StackedBarsCard
          title="Sign-ups per week, by role"
          hint="Last 13 weeks (Monday start); the last bar is the current, partial week."
          rows={weeklySignups}
          series={[
            { key: 'players', label: 'Players', color: ROLE_COLORS.player },
            { key: 'coaches', label: 'Coaches', color: ROLE_COLORS.coach },
            { key: 'clubs', label: 'Clubs', color: ROLE_COLORS.club },
            { key: 'brands', label: 'Brands', color: ROLE_COLORS.brand },
          ]}
          loading={loading}
        />
      </div>

      <SectionHeading title="Activity" hint="what members do, day by day" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <TrendAreaCard
          title={`Messages and conversations per day (${days}d)`}
          hint="Messages sent, and new conversations opened."
          rows={activityRows}
          series={[
            { key: 'messages', label: 'Messages', color: SERIES_COLORS[0] },
            { key: 'conversations', label: 'New conversations', color: SERIES_COLORS[1] },
          ]}
          loading={activity.isLoading}
        />
        <StackedBarsCard
          title={`Applications and roles per week (${days}d)`}
          hint="Applications sent by members, and roles posted by clubs and coaches."
          rows={weeklyActivity}
          series={[
            { key: 'applications', label: 'Applications', color: SERIES_COLORS[0] },
            { key: 'opportunities', label: 'Roles posted', color: SERIES_COLORS[2] },
          ]}
          stacked={false}
          loading={activity.isLoading}
        />
        <DonutChartCard
          title="Roles by status"
          hint="All roles ever posted."
          slices={[
            { label: 'Open', value: stats?.open_vacancies ?? 0, color: SERIES_COLORS[3] },
            { label: 'Closed', value: stats?.closed_vacancies ?? 0, color: SERIES_COLORS[6] },
            { label: 'Draft', value: stats?.draft_vacancies ?? 0, color: SERIES_COLORS[2] },
          ]}
          centerLabel="roles"
          loading={loading}
        />
      </div>

      <SectionHeading title="Reach" hint="where members use HOCKIA, and from where" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <DonutChartCard
          title="Devices"
          hint="Members by the device they last used."
          slices={[
            { label: 'iOS', value: stats?.device_users_ios ?? 0, color: SERIES_COLORS[1] },
            { label: 'Android', value: stats?.device_users_android ?? 0, color: SERIES_COLORS[3] },
            { label: 'Desktop', value: stats?.device_users_desktop ?? 0, color: SERIES_COLORS[0] },
          ]}
          centerLabel="devices"
          loading={loading}
        />
        <DonutChartCard
          title="Push notifications on"
          hint="Members who allowed push, by role; the centre is all subscribers."
          slices={[
            { label: ROLE_LABELS.player, value: stats?.push_subscribers_player ?? 0, color: ROLE_COLORS.player },
            { label: ROLE_LABELS.coach, value: stats?.push_subscribers_coach ?? 0, color: ROLE_COLORS.coach },
            { label: ROLE_LABELS.club, value: stats?.push_subscribers_club ?? 0, color: ROLE_COLORS.club },
            { label: ROLE_LABELS.brand, value: stats?.push_subscribers_brand ?? 0, color: ROLE_COLORS.brand },
          ]}
          centerLabel="subscribed"
          total={stats?.push_subscribers ?? 0}
          loading={loading}
        />
        <RankedBarsCard
          title="Top countries"
          hint="Members by country; share of all members."
          bars={topCountries.map((c) => ({ label: c.country, value: c.user_count }))}
          total={stats?.total_users ?? 0}
          loading={loading}
        />
      </div>
    </div>
  )
}
