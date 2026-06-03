/**
 * InterestSignal — the 🤝 Interested lens UI (Matching Increment #2.2). A
 * tier pill ("Strong / Possible / Low interest") with the reasoning in the
 * tooltip. Renders nothing when not applicable (no scope, non-recruiter
 * viewer, or no measurable intent) — handled by useInterest/computeInterest.
 *
 * Neutral slate like ProvenSignal (it's a separate axis from Club Fit's
 * purple); the Handshake icon + "interest" wording distinguish it from the
 * Proven evidence pill. The level is carried in the TEXT, not the colour,
 * so "Low interest" never reads as a red warning.
 */

import { Handshake } from 'lucide-react'
import { interestLevelLabel, type InterestResult } from '@/lib/interestFit'

interface InterestSignalProps {
  result: InterestResult
  /** 'full' = pill + first reason line; 'compact' = pill only. */
  variant?: 'full' | 'compact'
  className?: string
}

export default function InterestSignal({ result, variant = 'full', className = '' }: InterestSignalProps) {
  if (!result.isApplicable) return null
  const label = interestLevelLabel(result.level)
  const tooltip = result.reasons.length > 0 ? `${label} — ${result.reasons.join(' · ')}` : label

  return (
    <div className={['flex flex-col gap-1', className].join(' ')}>
      <span
        className="inline-flex items-center gap-1 self-start rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700"
        title={tooltip}
        aria-label={`Interest: ${label}. ${result.reasons.join('. ')}`}
      >
        <Handshake className="w-3 h-3" aria-hidden="true" />
        {label}
      </span>
      {variant === 'full' && result.reasons.length > 0 && (
        <span className="text-[10px] text-gray-500 leading-snug">{result.reasons[0]}</span>
      )}
    </div>
  )
}
