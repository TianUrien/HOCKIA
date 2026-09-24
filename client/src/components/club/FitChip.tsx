import { fitChipLabel, type FitState } from '@/lib/clubRecruiting'
import { cn } from '@/lib/utils'

/**
 * Fit chip for CLUB surfaces only (Figma 04 Club · Applicants 324:411):
 * a three-bar meter plus "Strong fit" (green) or "Possible fit" (neutral);
 * grey renders nothing. Never mount on a player-facing screen.
 */
export function FitChip({ state }: { state: FitState | null | undefined }) {
  const label = fitChipLabel(state)
  if (!label) return null
  const strong = state === 'green'
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full py-1 pl-2 pr-2.5', strong ? 'bg-positive-soft' : 'bg-[#ededf2]')} data-testid="fit-chip">
      <span className="flex items-end gap-[2px]" aria-hidden="true">
        <span className={cn('h-[5px] w-[3px] rounded-[1px]', strong ? 'bg-positive' : 'bg-ink-1')} />
        <span className={cn('h-[7.5px] w-[3px] rounded-[1px]', strong ? 'bg-positive' : 'bg-ink-1')} />
        <span className={cn('h-[10px] w-[3px] rounded-[1px]', strong ? 'bg-positive' : 'bg-ink-4')} />
      </span>
      <span className={cn('text-caption font-semibold', strong ? 'text-positive' : 'text-ink-1')}>{label}</span>
    </span>
  )
}
