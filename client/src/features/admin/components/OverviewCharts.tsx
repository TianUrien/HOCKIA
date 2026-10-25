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
import { ROLE_COLORS, ROLE_LABELS, SERIES_COLORS, completeDaysOnly, shortDay, toWeekly } from '../lib/adminCharts'

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
  // Today is a partial day: drop it so the last point never reads as a drop.
  const activityRows = completeDaysOnly(activity.data ?? []).map((d) => ({ ...d, label: shortDay(d.day) }))

  // Sign-ups: the 90-day daily trend rolled into Monday-start weeks, by role.
  const weeklySignups = toWeekly(signupTrends, 'date', ['players', 'coaches', 'clubs', 'umpires', 'brands'])
  // Applications and roles posted: daily activity rolled into weeks.
  const weeklyActivity = toWeekly(completeDaysOnly(activity.data ?? []), 'day', ['applications', 'opportunities'])

  // Push: the stats RPC splits subscribers by the four original roles; umpires
  // and anything else are the remainder, named as such rather than hidden.
  const pushNamed = (stats?.push_subscribers_player ?? 0) + (stats?.push_subscribers_coach ?? 0) + (stats?.push_subscribers_club ?? 0) + (stats?.push_subscribers_brand ?? 0)
  const pushOther = Math.max(0, (stats?.push_subscribers ?? 0) - pushNamed)
  // Devices: members with no device recorded are the gap between all members
  // and the three platforms; shown, so the donut's total is the member total.
  const deviceKnown = (stats?.device_users_ios ?? 0) + (stats?.device_users_android ?? 0) + (stats?.device_users_desktop ?? 0)
  const deviceNone = Math.max(0, (stats?.total_users ?? 0) - deviceKnown)
  // Countries: an empty country is "Unknown"; merge any duplicates that produces.
  const countryBars = Object.entries(topCountries.reduce<Record<string, number>>((acc, c) => {
    const label = c.country?.trim() ? c.country : 'Unknown'
    acc[label] = (acc[label] ?? 0) + c.user_count
    return acc
  }, {})).map(([label, value]) => ({ label, value, ...(label === 'Unknown' ? { color: '#d1d5db' } : {}) }))

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
            { key: 'umpires', label: 'Umpires', color: ROLE_COLORS.umpire },
            { key: 'brands', label: 'Brands', color: ROLE_COLORS.brand },
          ]}
          loading={loading}
        />
      </div>

      <SectionHeading title="Activity" hint="what members do, day by day" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <TrendAreaCard
          title={`Messages and conversations per day (${days}d)`}
          hint="Messages sent, and new conversations opened. Complete days only (today is left out)."
          rows={activityRows}
          series={[
            { key: 'messages', label: 'Messages', color: SERIES_COLORS[0] },
            { key: 'conversations', label: 'New conversations', color: SERIES_COLORS[1] },
          ]}
          loading={activity.isLoading}
        />
        <StackedBarsCard
          title={`Applications and opportunities per week (${days}d)`}
          hint="Applications sent by members, and opportunities posted by clubs and coaches. The lighter bar is the current, partial week."
          rows={weeklyActivity}
          series={[
            { key: 'applications', label: 'Applications', color: SERIES_COLORS[0] },
            { key: 'opportunities', label: 'Opportunities posted', color: SERIES_COLORS[2] },
          ]}
          stacked={false}
          loading={activity.isLoading}
        />
        <DonutChartCard
          title="Opportunities by status (all-time)"
          hint="Every opportunity ever posted, whatever the period filter says."
          slices={[
            { label: 'Open', value: stats?.open_vacancies ?? 0, color: SERIES_COLORS[3] },
            { label: 'Closed', value: stats?.closed_vacancies ?? 0, color: SERIES_COLORS[6] },
            { label: 'Draft', value: stats?.draft_vacancies ?? 0, color: SERIES_COLORS[2] },
          ]}
          centerLabel="opportunities"
          loading={loading}
        />
      </div>

      <SectionHeading title="Reach" hint="where members use Hockia, and from where" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <DonutChartCard
          title="Devices"
          hint="Members by the device they last used; the centre is all members."
          slices={[
            { label: 'iOS', value: stats?.device_users_ios ?? 0, color: SERIES_COLORS[1] },
            { label: 'Android', value: stats?.device_users_android ?? 0, color: SERIES_COLORS[3] },
            { label: 'Desktop', value: stats?.device_users_desktop ?? 0, color: SERIES_COLORS[0] },
            { label: 'No device recorded', value: deviceNone, color: '#d1d5db' },
          ]}
          centerLabel="members"
          total={stats?.total_users ?? 0}
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
            { label: 'Umpires & other', value: pushOther, color: ROLE_COLORS.umpire },
          ]}
          centerLabel="subscribed"
          total={stats?.push_subscribers ?? 0}
          loading={loading}
        />
        <RankedBarsCard
          title="Top countries"
          hint="Members by country; share of all members."
          bars={countryBars}
          total={stats?.total_users ?? 0}
          loading={loading}
        />
      </div>
    </div>
  )
}
