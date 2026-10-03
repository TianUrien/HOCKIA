import { Link } from 'react-router-dom'
import { dayFirst } from '@/lib/dayFirst'
import { STATUS_TONE_TEXT } from '@/lib/statusTone'
import type { HappenedLine } from '@/lib/pulseWeek'

/**
 * "What happened" (Your week v2, Figma 42:276): a dated timeline of the
 * week's facts, one neutral line each. Everything here is grey — a player
 * waiting on a club cannot act, so nothing is amber (lib/statusTone). The
 * line "Your application to X expired with no reply" included.
 */
export function WhatHappened({ lines }: { lines: readonly HappenedLine[] }) {
  if (lines.length === 0) return null
  return (
    <section aria-label="What happened" data-testid="what-happened">
      <h2 className="px-1 pb-2 text-body font-semibold text-ink-1">What happened</h2>
      <ol className="divide-y divide-line overflow-hidden rounded-card bg-surface-grouped">
        {lines.map((l) => {
          const inner = (
            <>
              <span className="w-14 shrink-0 pt-px text-caption text-ink-3">{dayFirst(l.at)}</span>
              <span className={`min-w-0 flex-1 text-row ${l.tone === 'grey' ? 'text-ink-1' : STATUS_TONE_TEXT[l.tone]}`} data-testid="happened-line">{l.text}</span>
            </>
          )
          return (
            <li key={l.key}>
              {l.path ? (
                <Link to={l.path} className="flex items-start gap-3 px-4 py-3 active:bg-surface-muted">{inner}</Link>
              ) : (
                <div className="flex items-start gap-3 px-4 py-3">{inner}</div>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
