import type { ReactNode } from 'react'

interface ChartCardProps {
  title: string
  /** One line under the title saying what the chart counts. */
  hint?: string
  /** Something at the right of the title row (an InfoTip, a toggle). */
  aside?: ReactNode
  loading?: boolean
  /** Shown instead of the chart when there is nothing to draw. */
  empty?: boolean
  emptyMessage?: string
  /** Height of the loading / empty area, matching the chart it stands in for. */
  height?: number
  className?: string
  children: ReactNode
}

/**
 * The frame every admin chart sits in: white card, small bold title, a hint
 * line, and the same loading and empty states, so the Overview reads as one
 * set of panels rather than a mix of styles.
 */
export function ChartCard({ title, hint, aside, loading = false, empty = false, emptyMessage = 'No data yet', height = 240, className = '', children }: ChartCardProps) {
  return (
    <section className={`bg-white rounded-xl border border-gray-200 p-5 ${className}`} data-testid="chart-card" aria-label={title}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          {hint && <p className="text-xs text-gray-500 mt-0.5">{hint}</p>}
        </div>
        {aside}
      </div>
      {loading ? (
        <div className="rounded-lg bg-gray-100 animate-pulse" style={{ height }} data-testid="chart-loading" />
      ) : empty ? (
        <div className="flex items-center justify-center text-sm text-gray-400" style={{ height }} data-testid="chart-empty">{emptyMessage}</div>
      ) : (
        children
      )}
    </section>
  )
}
