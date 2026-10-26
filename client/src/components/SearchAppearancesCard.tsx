import { useMemo } from 'react'
import { Eye } from 'lucide-react'
import type { SearchAppearancesDay } from '@/lib/searchAppearances'

interface SearchAppearancesCardProps {
  /** Last-N-days daily buckets, oldest → newest. */
  days: SearchAppearancesDay[]
  /** Total appearances across the window. */
  total: number
  /** Number of days the window covers (for the copy). */
  windowDays: number
}

/**
 * Owner-only card summarising how often the profile surfaced in active
 * community search/filter results over the last N days. Hidden when the
 * window has zero appearances so it doesn't pollute the dashboard of a new
 * profile nobody has searched for yet.
 *
 * Deliberately aggregate-only: we never return or render the identities
 * of the viewers who surfaced the profile.
 */
export default function SearchAppearancesCard({
  days,
  total,
  windowDays,
}: SearchAppearancesCardProps) {
  const peak = useMemo(() => Math.max(1, ...days.map((d) => d.appearances)), [days])

  // Render nothing when the profile hasn't surfaced yet — no value in a zero card.
  if (total <= 0) return null

  return (
    <div className="rounded-xl border border-line bg-surface-subtle p-4 sm:p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 flex items-center justify-center w-9 h-9 rounded-full bg-hockia-soft text-hockia-primary">
          <Eye className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-3 mb-0.5">
            Search appearances
          </p>
          <p className="text-sm text-gray-800 leading-relaxed">
            You appeared in{' '}
            <span className="font-semibold text-gray-900">{total}</span>{' '}
            active search{total === 1 ? '' : 'es'} in the last{' '}
            <span className="font-semibold text-gray-900">{windowDays} days</span>.
          </p>

          {days.length > 0 && (
            <div
              className="mt-3 flex items-end gap-1 h-10"
              role="img"
              aria-label={`Daily appearances over the last ${windowDays} days`}
            >
              {days.map((d) => {
                const heightPct = Math.round((d.appearances / peak) * 100)
                return (
                  <div
                    key={d.day}
                    className="flex-1 rounded-sm bg-hockia-soft-hover"
                    style={{ height: `${Math.max(heightPct, 6)}%` }}
                    title={`${d.day}: ${d.appearances}`}
                  />
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
