/**
 * AcquisitionCharts — where new members come from, on the Overview
 * (founder request relayed 2026-10-15: "no veo un chart que me diga de dónde
 * vienen los usuarios").
 *
 *   Donut   sign-ups in the window by first-touch channel group
 *   Bars    the same per Monday-start week, so a push on Instagram shows up
 *           as a bar, not a number
 *
 * Both draw from admin_get_signups_by_channel_week. "Direct" and "Unknown"
 * are drawn grey: they are the absence of a channel, not a channel. The line
 * under the charts says how many sign-ups were measured (UTM, referrer,
 * install referrer or deep link) versus inferred or backfilled, so the shares
 * are read with the right confidence. The full per-source report lives in
 * Growth › Attribution.
 */
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { getSignupsByChannelWeek } from '../api/adminApi'
import { DonutChartCard } from './charts/DonutChartCard'
import { StackedBarsCard } from './charts/StackedBarsCard'
import { CHANNEL_GROUP_COLORS, summariseChannels } from '../lib/acquisitionCharts'
import { displayGroup } from '@/lib/attributionLabels'

interface AcquisitionChartsProps {
  /** Window in days; the Overview passes 91 so the bars read as 13 weeks. */
  days?: number
}

export function AcquisitionCharts({ days = 91 }: AcquisitionChartsProps) {
  const q = useQuery({
    queryKey: ['admin', 'signups-by-channel-week', days],
    queryFn: () => getSignupsByChannelWeek(days),
    staleTime: 5 * 60 * 1000,
  })
  const summary = summariseChannels(q.data ?? [])
  const weeks = Math.round(days / 7)
  const slices = summary.groups.map((g) => ({ label: displayGroup(g), value: summary.totals[g], color: CHANNEL_GROUP_COLORS[g] ?? '#0d9488' }))
  const series = summary.groups.map((g) => ({ key: g, label: displayGroup(g), color: CHANNEL_GROUP_COLORS[g] ?? '#0d9488' }))
  const measuredPct = summary.total > 0 ? Math.round((summary.measured / summary.total) * 100) : null

  return (
    <div className="space-y-3" data-testid="acquisition-charts">
      <div className="flex items-baseline gap-2 pt-2">
        <h2 className="text-sm font-bold text-gray-900">Acquisition</h2>
        <span className="text-xs text-gray-400">where new members come from (first touch, last {weeks} weeks)</span>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DonutChartCard
          title="Sign-ups by channel"
          hint="First touch before registering. Direct and Unknown are the absence of a channel, so they stay grey."
          slices={slices}
          centerLabel="sign-ups"
          loading={q.isLoading}
        />
        <StackedBarsCard
          title="Sign-ups per week, by channel"
          hint="Monday-start weeks; the lighter bar is the current, partial week."
          rows={summary.weekly}
          series={series}
          loading={q.isLoading}
        />
      </div>
      {!q.isLoading && summary.total > 0 && (
        <p className="text-[11px] text-gray-500" data-testid="acquisition-confidence">
          {summary.measured.toLocaleString()} of {summary.total.toLocaleString()} sign-ups ({measuredPct}%) had a measured channel (UTM, referrer, Play install referrer or deep link); the rest were inferred or backfilled.
          {' '}Per-source detail in <Link to="/admin/attribution" className="text-purple-700 underline-offset-2 hover:underline">Attribution</Link>.
        </p>
      )}
    </div>
  )
}
