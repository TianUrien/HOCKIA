import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ChartCard } from './ChartCard'

export interface TrendSeries {
  key: string
  label: string
  color: string
}

interface TrendAreaCardProps {
  title: string
  hint?: string
  /** One row per day; `label` is the x-axis text. */
  rows: Array<Record<string, string | number>>
  series: TrendSeries[]
  loading?: boolean
  height?: number
  aside?: React.ReactNode
}

const TOOLTIP_STYLE = { borderRadius: '8px', border: '1px solid #e5e7eb', fontSize: '12px' }

/** Daily lines with a soft fill under each, for "how much of X per day". */
export function TrendAreaCard({ title, hint, rows, series, loading, height = 240, aside }: TrendAreaCardProps) {
  const empty = rows.every((r) => series.every((s) => !Number(r[s.key])))
  const gradientId = (key: string) => `trend-${key.replace(/[^a-z0-9]/gi, '')}`
  return (
    <ChartCard title={title} hint={hint} aside={aside} loading={loading} empty={empty} height={height}>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={rows} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={gradientId(s.key)} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={s.color} stopOpacity={0.2} />
                <stop offset="95%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} interval="preserveStartEnd" tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} allowDecimals={false} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: '12px' }} iconType="circle" iconSize={8} />}
          {series.map((s) => (
            <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} fill={`url(#${gradientId(s.key)})`} dot={false} activeDot={{ r: 4 }} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
