import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { HOCKIA_PRIMARY } from '@/lib/brandTokens'

interface TemplateBreakdown {
  template_key: string
  name: string
  sent: number
  delivered: number
  opened: number
  clicked: number
  open_rate: number
  click_rate: number
}

interface EmailTemplateBreakdownChartProps {
  data: TemplateBreakdown[]
  loading?: boolean
}

export function EmailTemplateBreakdownChart({ data, loading }: EmailTemplateBreakdownChartProps) {
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
        <h3 className="text-sm font-semibold text-gray-700 mb-4">Per-Template Breakdown</h3>
        <div className="h-[300px] flex items-center justify-center">
          <p className="text-sm text-gray-400">No template data yet</p>
        </div>
      </div>
    )
  }

  const formatted = data.map(d => ({
    ...d,
    label: d.name.replace(' Notification', '').replace(' Request', ''),
  }))

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">Per-Template Breakdown</h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={formatted} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
          <XAxis type="number" tick={{ fontSize: 12, fill: '#9ca3af' }} />
          <YAxis type="category" dataKey="label" width={120} tick={{ fontSize: 12, fill: '#6b7280' }} />
          <Tooltip
            contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', fontSize: '13px' }}
          />
          <Legend wrapperStyle={{ fontSize: '12px' }} />
          <Bar dataKey="sent" name="Sent" fill={HOCKIA_PRIMARY} radius={[0, 4, 4, 0]} />
          <Bar dataKey="opened" name="Opened" fill="#3b82f6" radius={[0, 4, 4, 0]} />
          <Bar dataKey="clicked" name="Clicked" fill="#10b981" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
