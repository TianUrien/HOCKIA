import { ChartCard } from './ChartCard'
import { share } from '../../lib/adminCharts'
import { HOCKIA_PRIMARY } from '@/lib/brandTokens'

export interface RankedBar {
  label: string
  value: number
  color?: string
}

interface RankedBarsCardProps {
  title: string
  hint?: string
  bars: RankedBar[]
  /** Denominator for the percentage column; defaults to the sum of the bars. */
  total?: number
  /** How many bars to show (the rest are summed into "Other"). */
  limit?: number
  loading?: boolean
  aside?: React.ReactNode
}

/**
 * Horizontal ranked bars (top countries, sources): the label, a bar scaled
 * to the leader, the count and the share. Plain HTML, which keeps the labels
 * readable at any width.
 */
export function RankedBarsCard({ title, hint, bars, total, limit = 8, loading, aside }: RankedBarsCardProps) {
  const sorted = [...bars].filter((b) => b.value > 0).sort((a, b) => b.value - a.value)
  const shown = sorted.slice(0, limit)
  const rest = sorted.slice(limit).reduce((n, b) => n + b.value, 0)
  if (rest > 0) shown.push({ label: 'Other', value: rest, color: '#94a3b8' })
  const whole = total ?? sorted.reduce((n, b) => n + b.value, 0)
  const max = shown[0]?.value ?? 0
  return (
    <ChartCard title={title} hint={hint} aside={aside} loading={loading} empty={shown.length === 0} height={200}>
      <ul className="space-y-2" data-testid="ranked-bars">
        {shown.map((b) => (
          <li key={b.label} className="grid grid-cols-[minmax(0,1fr)_3rem_2.5rem] items-center gap-3 text-sm">
            <div className="min-w-0">
              <div className="truncate text-gray-700">{b.label}</div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100">
                <div className="h-full rounded-full" style={{ width: `${max ? Math.max(2, (b.value / max) * 100) : 0}%`, backgroundColor: b.color ?? HOCKIA_PRIMARY }} />
              </div>
            </div>
            <span className="text-right tabular-nums text-gray-900">{b.value.toLocaleString()}</span>
            <span className="text-right tabular-nums text-xs text-gray-500">{share(b.value, whole)}%</span>
          </li>
        ))}
      </ul>
    </ChartCard>
  )
}
