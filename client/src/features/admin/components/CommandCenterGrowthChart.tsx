import {
  ComposedChart,
  Area,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import type { UserGrowthPoint } from '../types'
import { HOCKIA_PRIMARY } from '@/lib/brandTokens'

interface CommandCenterGrowthChartProps {
  data: UserGrowthPoint[]
  loading?: boolean
}

export function CommandCenterGrowthChart({ data, loading }: CommandCenterGrowthChartProps) {
  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="h-4 w-32 bg-gray-200 rounded mb-4" />
        <div className="h-[300px] flex items-center justify-center">
          <div className="animate-pulse text-gray-400 text-sm">Loading chart...</div>
        </div>
      </div>
    )
  }

  if (!data || data.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">User Growth</h3>
        <div className="h-[300px] flex items-center justify-center">
          <p className="text-sm text-gray-400">No growth data yet</p>
        </div>
      </div>
    )
  }

  const formatted = data.map(d => ({
    ...d,
    day: new Date(d.day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  }))

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">User Growth</h3>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={formatted}>
          <defs>
            <linearGradient id="gradCumulative" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={HOCKIA_PRIMARY} stopOpacity={0.15} />
              <stop offset="95%" stopColor={HOCKIA_PRIMARY} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
          <XAxis
            dataKey="day"
            tick={{ fontSize: 11, fill: '#9ca3af' }}
            interval="preserveStartEnd"
          />
          <YAxis
            yAxisId="left"
            tick={{ fontSize: 11, fill: '#9ca3af' }}
            width={50}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fontSize: 11, fill: '#9ca3af' }}
            width={40}
          />
          <Tooltip
            contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', fontSize: '13px' }}
          />
          <Legend wrapperStyle={{ fontSize: '12px' }} />
          <Area
            yAxisId="left"
            type="monotone"
            dataKey="cumulative_total"
            name="Total Users"
            stroke={HOCKIA_PRIMARY}
            fill="url(#gradCumulative)"
            strokeWidth={2}
          />
          <Bar
            yAxisId="right"
            dataKey="new_users"
            name="New / Day"
            fill="#c4b5fd"
            radius={[3, 3, 0, 0]}
            maxBarSize={20}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
