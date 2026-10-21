import { fitChipLabel, type FitState } from '@/lib/clubRecruiting'
import { GLASS } from '@/lib/communityCard'
import { cn } from '@/lib/utils'

/**
 * The one Fit badge (design audit 2026-10-21, B3). Two words only, Strong fit
 * or Possible fit, with a three-bar meter so the meaning never relies on
 * colour (Strong fills three bars, Possible two). Never a percentage.
 *
 *  - `surface="light"` (rows, cards, sheets): positive tone for Strong,
 *    neutral for Possible.
 *  - `surface="photo"` (over a photo scrim): glass with white text.
 *
 * Grey / unknown renders nothing. Fit is for clubs and recruiting coaches
 * only: callers never pass a fit to a player-facing surface, and the badge
 * itself refuses to render for a player viewer when `viewerRole` is given.
 */
export interface FitBadgeProps {
  state: FitState | null | undefined
  surface?: 'light' | 'photo'
  /** Optional suffix after the label ("for Midfielder · Men's"). */
  suffix?: string | null
  /** The viewer's role: a player never sees fit (founder rule). */
  viewerRole?: string | null
  className?: string
}

const BAR_HEIGHTS = [5, 7, 9] as const

export function FitBadge({ state, surface = 'light', suffix = null, viewerRole, className }: FitBadgeProps) {
  if (viewerRole === 'player') return null
  const label = fitChipLabel(state)
  if (!label) return null
  const strong = state === 'green'
  const filled = strong ? 3 : 2
  const text = suffix ? `${label} ${suffix}` : label
  const photo = surface === 'photo'
  return (
    <span
      className={cn(
        'inline-flex max-w-full shrink-0 items-center gap-[5px] rounded-full py-[3px] pl-[7px] pr-[9px]',
        photo ? cn('bg-white/20', GLASS) : strong ? 'bg-positive-soft' : 'bg-surface-muted',
        className,
      )}
      data-testid="fit-badge"
      data-fit={strong ? 'strong' : 'possible'}
    >
      <span aria-hidden="true" className="flex shrink-0 items-end gap-[2px]">
        {BAR_HEIGHTS.map((h, i) => (
          <span
            key={h}
            className={cn(
              'w-[3px] rounded-[1px]',
              i < filled
                ? photo ? 'bg-white' : strong ? 'bg-positive' : 'bg-ink-1'
                : photo ? 'bg-white/40' : 'bg-ink-4',
            )}
            style={{ height: h }}
          />
        ))}
      </span>
      <span className={cn('truncate text-[12px] font-semibold leading-4', photo ? 'text-white' : strong ? 'text-positive' : 'text-ink-1')}>{text}</span>
    </span>
  )
}
