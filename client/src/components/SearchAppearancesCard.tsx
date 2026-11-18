import { useMemo } from 'react'
import { Eye } from 'lucide-react'
import { Trans } from 'react-i18next'
import type { SearchAppearancesDay } from '@/lib/searchAppearances'
import { useProfileT } from '@/i18n/ns/profile'

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
  const t = useProfileT()
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
            {t('searchAppearancesCard.title')}
          </p>
          <p className="text-sm text-gray-800 leading-relaxed">
            <Trans
              t={t}
              i18nKey="searchAppearancesCard.summary"
              count={total}
              values={{ count: total, windowDays }}
              components={{ count: <span className="font-semibold text-gray-900" />, days: <span className="font-semibold text-gray-900" /> }}
            />
          </p>

          {days.length > 0 && (
            <div
              className="mt-3 flex items-end gap-1 h-10"
              role="img"
              aria-label={t('searchAppearancesCard.chartLabel', { windowDays })}
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
