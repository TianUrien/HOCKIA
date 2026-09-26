import { Check, Minus } from 'lucide-react'
import { FitChip } from './FitChip'
import type { FitRow, FitState } from '@/lib/clubRecruiting'
import { cn } from '@/lib/utils'

/**
 * "Fit for this role" (Figma 04 Club · Applicant review 327:563, D2.1 club
 * view 395:178). CLUB surfaces only — never mount on a player-facing screen.
 * The four compute_club_fit components as plain checks; Level names the
 * missing side instead of ever showing a number.
 */
export function FitCard({ state, rows, className }: { state: FitState | null | undefined; rows: FitRow[]; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-3 rounded-2xl bg-surface-grouped p-4', className)} data-testid="fit-card">
      <div className="flex items-center justify-between">
        <span className="text-row font-semibold text-ink-1">Fit for this role</span>
        <FitChip state={state} />
      </div>
      {rows.map((r) => (
        <div key={r.key} className="flex items-start gap-2.5">
          <span className={cn('mt-px flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full', r.ok ? 'bg-positive-soft text-positive' : 'bg-white text-ink-3')}>
            {r.ok ? <Check className="h-3.5 w-3.5" strokeWidth={2.6} /> : <Minus className="h-3.5 w-3.5" strokeWidth={2.6} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-semibold leading-[19px] text-ink-1">{r.label}</span>
            <span className="block text-secondary text-ink-2">{r.detail}</span>
          </span>
        </div>
      ))}
      <p className="text-caption text-ink-3">Only clubs see fit. It reads the profile — nothing else.</p>
    </div>
  )
}
