import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { ChartCard } from './ChartCard'
import { shareLabel } from '../../lib/adminCharts'

export interface DonutSlice {
  label: string
  value: number
  color: string
}

interface DonutChartCardProps {
  title: string
  hint?: string
  slices: DonutSlice[]
  /** Word under the total in the middle ("members", "roles"). */
  centerLabel: string
  /** Overrides the sum of the slices in the middle (e.g. total users when the slices are a subset). */
  total?: number
  loading?: boolean
  aside?: React.ReactNode
}

/**
 * A donut with the total in the middle and a legend that gives every slice
 * its count and share. Zero slices are dropped from the ring but kept in the
 * legend, so "Umpires 0" is still visible.
 */
export function DonutChartCard({ title, hint, slices, centerLabel, total, loading, aside }: DonutChartCardProps) {
  const sum = slices.reduce((n, s) => n + Math.max(0, s.value), 0)
  const whole = total ?? sum
  const drawn = slices.filter((s) => s.value > 0)
  return (
    <ChartCard title={title} hint={hint} aside={aside} loading={loading} empty={whole === 0} height={200}>
      <div className="grid grid-cols-[150px_minmax(0,1fr)] items-center gap-4">
        <div className="relative h-[150px]" data-testid="donut">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={drawn.map((s) => ({ name: s.label, value: s.value }))} dataKey="value" nameKey="name" innerRadius={48} outerRadius={70} paddingAngle={drawn.length > 1 ? 2 : 0} stroke="#ffffff" strokeWidth={2} startAngle={90} endAngle={-270} animationDuration={400}>
                {drawn.map((s) => <Cell key={s.label} fill={s.color} />)}
              </Pie>
              <Tooltip content={<SliceTip whole={whole} />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-xl font-bold text-gray-900 tabular-nums">{whole.toLocaleString()}</span>
            <span className="text-[10px] uppercase tracking-wider text-gray-500">{centerLabel}</span>
          </div>
        </div>
        <ul className="space-y-1.5 min-w-0" data-testid="donut-legend">
          {slices.map((s) => (
            <li key={s.label} className="flex items-center gap-2 text-sm">
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-gray-700">{s.label}</span>
              <span className="tabular-nums text-gray-900">{s.value.toLocaleString()}</span>
              <span className="w-10 text-right tabular-nums text-xs text-gray-500">{shareLabel(s.value, whole)}</span>
            </li>
          ))}
        </ul>
      </div>
    </ChartCard>
  )
}

function SliceTip({ active, payload, whole }: { active?: boolean; payload?: Array<{ name?: string; value?: number }>; whole: number }) {
  if (!active || !payload?.length) return null
  const { name, value = 0 } = payload[0]
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-sm">
      <div className="font-medium text-gray-900">{name}</div>
      <div className="text-gray-600 tabular-nums">{value.toLocaleString()} · {shareLabel(value, whole)}</div>
    </div>
  )
}
