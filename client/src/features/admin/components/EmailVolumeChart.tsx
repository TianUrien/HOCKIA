import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { HOCKIA_PRIMARY } from '@/lib/brandTokens'

interface DailyTrend {
  date: string
  sent: number
  delivered: number
  opened: number
  clicked: number
  bounced: number
}

interface EmailVolumeChartProps {
  data: DailyTrend[]
  loading?: boolean
}

export function EmailVolumeChart({ data, loading }: EmailVolumeChartProps) {
  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="h-[300px] flex items-center justify-center">
          <div className="animate-pulse text-gray-400 text-sm">Loading chart...</div>
        </div>
      </div>
    )
  }

  if (!data || data.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Email Volume</h3>
        <div className="h-[300px] flex items-center justify-center">
          <p className="text-sm text-gray-400">No send data yet</p>
        </div>
      </div>
    )
  }

  const formatted = data.map(d => ({
    ...d,
    date: new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  }))

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">Email Volume</h3>
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={formatted}>
          <defs>
            <linearGradient id="gradSent" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={HOCKIA_PRIMARY} stopOpacity={0.15} />
              <stop offset="95%" stopColor={HOCKIA_PRIMARY} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gradDelivered" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10b981" stopOpacity={0.15} />
              <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gradOpened" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
          <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#9ca3af' }} />
          <YAxis tick={{ fontSize: 12, fill: '#9ca3af' }} />
          <Tooltip
            contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', fontSize: '13px' }}
          />
          <Legend wrapperStyle={{ fontSize: '12px' }} />
          <Area type="monotone" dataKey="sent" name="Sent" stroke={HOCKIA_PRIMARY} fill="url(#gradSent)" strokeWidth={2} />
          <Area type="monotone" dataKey="delivered" name="Delivered" stroke="#10b981" fill="url(#gradDelivered)" strokeWidth={2} />
          <Area type="monotone" dataKey="opened" name="Opened" stroke="#3b82f6" fill="url(#gradOpened)" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
