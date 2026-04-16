import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import type { RetentionCohort } from '../types'

interface RetentionCurveChartProps {
  cohorts: RetentionCohort[]
  loading?: boolean
}

const COHORT_COLORS = ['#8026FA', '#3b82f6', '#10b981']

export function RetentionCurveChart({ cohorts, loading }: RetentionCurveChartProps) {
  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="h-4 w-36 bg-gray-200 rounded mb-4" />
        <div className="h-[280px] flex items-center justify-center">
          <div className="animate-pulse text-gray-400 text-sm">Loading chart...</div>
        </div>
      </div>
    )
  }

  if (!cohorts || cohorts.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Retention Curves</h3>
        <div className="h-[280px] flex items-center justify-center">
          <p className="text-sm text-gray-400">Not enough data for retention curves</p>
        </div>
      </div>
    )
  }

  // Transform cohorts into chart data: [{period: 'D1', 'Jan 2026': 45, ...}, ...]
  const periods = ['D1', 'D7', 'D14', 'D30']
  const pctKeys = ['d1_pct', 'd7_pct', 'd14_pct', 'd30_pct'] as const

  const chartData = periods.map((period, i) => {
    const point: Record<string, string | number | null> = { period }
    cohorts.slice(0, 3).forEach((c) => {
      const label = new Date(c.signup_month).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
        + ` (${c.cohort_size})`
      point[label] = c[pctKeys[i]]
    })
    return point
  })

  const cohortLabels = cohorts.slice(0, 3).map((c) =>
    new Date(c.signup_month).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
      + ` (${c.cohort_size})`
  )

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">Retention Curves</h3>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
          <XAxis dataKey="period" tick={{ fontSize: 12, fill: '#9ca3af' }} />
          <YAxis
            domain={[0, 100]}
            tick={{ fontSize: 11, fill: '#9ca3af' }}
            tickFormatter={(v) => `${v}%`}
            width={45}
          />
          <Tooltip
            contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', fontSize: '13px' }}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Recharts Formatter type mismatch
            formatter={(value: number | undefined) => [`${value?.toFixed(1) ?? '—'}%`] as any}
          />
          <Legend wrapperStyle={{ fontSize: '12px' }} />
          {cohortLabels.map((label, i) => (
            <Line
              key={label}
              type="monotone"
              dataKey={label}
              stroke={COHORT_COLORS[i]}
              strokeWidth={2}
              dot={{ r: 4 }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
