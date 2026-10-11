import type { FitState } from '@/lib/clubRecruiting'
import { GLASS } from '@/lib/communityCard'

/**
 * The glass fit pill inside the scrim (Figma Card / Member photo "fit (club
 * viewers only)", preview P10): a three-bar meter + the label. Strong fit
 * fills all three bars, Possible fit two. Recruiters only — callers never
 * pass a fit for anyone else.
 */
export function FitPill({ state, label }: { state: FitState; label: string }) {
  const filled = state === 'green' ? 3 : 2
  return (
    <span className={`inline-flex max-w-full items-center gap-[5px] rounded-full bg-white/20 py-[3px] pl-[7px] pr-[9px] ${GLASS}`}>
      <span aria-hidden="true" className="flex shrink-0 items-end gap-[2px]">
        {[5, 7, 9].map((h, i) => (
          <span key={h} className={`w-[3px] rounded-[1px] ${i < filled ? 'bg-white' : 'bg-white/40'}`} style={{ height: h }} />
        ))}
      </span>
      <span className="truncate text-[11px] font-semibold leading-[13px] text-white">{label}</span>
    </span>
  )
}
