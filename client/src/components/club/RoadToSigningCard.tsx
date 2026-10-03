import { Check, Minus } from 'lucide-react'
import type { RoadStep } from '@/lib/signing'
import { cn } from '@/lib/utils'

/**
 * D4.1 · Road to signing (Figma 390:3; DEV NOTE 391:23). Five steps on a
 * shortlisted applicant: Shortlisted, Talked (ticks itself when both have
 * written), Trial or video call (optional; the club ticks it), Offer and
 * Signed (the player confirms it too). The next step is ringed in purple;
 * Talked offers Message while it is open. Club-only.
 */
interface Props {
  steps: RoadStep[]
  /** Tick / untick the trial (set_trial). Absent → the trial can't be changed now. */
  onToggleTrial?: () => void
  onMessage: () => void
  trialBusy?: boolean
}

function Mark({ done, current, skipped = false }: { done: boolean; current: boolean; skipped?: boolean }) {
  if (skipped) {
    return (
      <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-surface-grouped text-ink-3" aria-hidden="true">
        <Minus className="h-3.5 w-3.5" strokeWidth={3} />
      </span>
    )
  }
  if (done) {
    return (
      <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-positive text-white" aria-hidden="true">
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
      </span>
    )
  }
  return <span className={cn('h-[22px] w-[22px] shrink-0 rounded-full border-[1.5px]', current ? 'border-hockia-primary' : 'border-ink-4')} aria-hidden="true" />
}

export function RoadToSigningCard({ steps, onToggleTrial, onMessage, trialBusy }: Props) {
  return (
    <section className="rounded-2xl bg-surface-grouped px-4 pb-2 pt-3.5" data-testid="road-to-signing">
      <h2 className="pb-1 text-[15px] font-semibold leading-5 text-ink-1">Road to signing</h2>
      <ol>
        {steps.map((s) => {
          const strong = s.current
          const label = (
            <span className="min-w-0 flex-1">
              <span className={cn('block text-[15px] leading-5', strong ? 'font-semibold text-ink-1' : s.done || s.key === 'shortlisted' ? 'text-ink-1' : 'text-ink-2')}>{s.label}</span>
              <span className="block text-caption leading-4 text-ink-2">{s.detail}</span>
            </span>
          )
          const trialToggle = s.key === 'trial' && onToggleTrial
          return (
            <li key={s.key} className="flex min-h-[50px] items-center gap-3 py-1" data-testid={`road-step-${s.key}`} data-done={s.done} data-current={s.current} data-skipped={s.skipped ? 'true' : undefined}>
              {trialToggle ? (
                <button
                  type="button"
                  onClick={onToggleTrial}
                  disabled={trialBusy}
                  role="checkbox"
                  aria-checked={s.done}
                  aria-label="Trial or video call done"
                  className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:opacity-60"
                  data-testid="road-trial-toggle"
                >
                  <Mark done={s.done} current={false} />
                  {label}
                </button>
              ) : (
                <>
                  <Mark done={s.done} current={s.current} skipped={s.skipped} />
                  {label}
                </>
              )}
              {s.key === 'talked' && !s.done && (
                <button type="button" onClick={onMessage} className="-mr-2 inline-flex min-h-11 shrink-0 items-center px-2 text-[14px] font-semibold text-hockia-primary" data-testid="road-message">Message</button>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
