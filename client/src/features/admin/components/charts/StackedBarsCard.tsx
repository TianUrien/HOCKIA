import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ChartCard } from './ChartCard'

export interface BarSeries {
  key: string
  label: string
  color: string
}

interface StackedBarsCardProps {
  title: string
  hint?: string
  /** One row per bar; `label` is the x-axis text, series keys hold the numbers; `partial` marks a period in progress. */
  rows: Array<Record<string, string | number | boolean>>
  series: BarSeries[]
  /** Stack the series (default) or draw them side by side. */
  stacked?: boolean
  loading?: boolean
  height?: number
  aside?: React.ReactNode
}

const TOOLTIP_STYLE = { borderRadius: '8px', border: '1px solid #e5e7eb', fontSize: '12px' }

/** Bars per period (usually a week), one colour per series, stacked. */
export function StackedBarsCard({ title, hint, rows, series, stacked = true, loading, height = 240, aside }: StackedBarsCardProps) {
  const empty = rows.every((r) => series.every((s) => !Number(r[s.key])))
  return (
    <ChartCard title={title} hint={hint} aside={aside} loading={loading} empty={empty} height={height}>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={rows} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} interval="preserveStartEnd" tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} allowDecimals={false} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: '#f5f3ff' }} />
          {series.length > 1 && <Legend itemSorter={null} wrapperStyle={{ fontSize: '12px' }} iconType="circle" iconSize={8} />}
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} stackId={stacked ? 'a' : undefined} radius={i === series.length - 1 || !stacked ? [4, 4, 0, 0] : [0, 0, 0, 0]} maxBarSize={28}>
              {/* A period still in progress (this week) is drawn lighter so it doesn't read as a drop. */}
              {rows.map((r, j) => <Cell key={j} fillOpacity={r.partial ? 0.4 : 1} />)}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}
