/**
 * RecruiterVerdictCard — the explanation-led lead of the recruiter card
 * (Matching Increment #5). Renders the synthesized verdict from
 * computeRecruiterVerdict: a qualitative tier headline + the ranked
 * highlights and caveats drawn from the four lenses. No percentage: the
 * numeric scores stay internal. Returns null when not applicable (no
 * recruiter scope), so the card simply omits the lead.
 *
 * The AI Opinion panel renders directly beneath this as the richer narrated
 * version of the same verdict; the per-lens chips remain below as the
 * granular breakdown.
 */

import { Check, AlertTriangle } from 'lucide-react'
import { fitStateFromVerdict, type RecruiterVerdict } from '@/lib/recruiterVerdict'
import { FitBadge } from '@/components/ui/FitBadge'

interface RecruiterVerdictCardProps {
  verdict: RecruiterVerdict
  className?: string
}

/**
 * The fit word is the one Fit badge (design audit 2026-10-21, B3): Strong /
 * Possible with a bar meter, never a percentage. Outside the context shows no
 * badge; the caveats below say why.
 */
export default function RecruiterVerdictCard({ verdict, className = '' }: RecruiterVerdictCardProps) {
  if (!verdict.isApplicable) return null
  const fit = fitStateFromVerdict(verdict)

  return (
    <div
      className={`rounded-xl border border-line bg-white px-4 py-3 ${className}`}
      role="group"
      aria-label="Fit for your context"
      data-testid="recruiter-verdict"
    >
      <div className="flex items-center gap-2">
        <FitBadge state={fit} />
        <span className="ml-auto text-[11px] font-medium text-ink-3">
          {verdict.scoped ? 'For your context' : 'General fit'}
        </span>
      </div>

      {/* #6 — the recruitment problem the weighting was tuned for. */}
      {verdict.weightedFor && (
        <p className="mt-1 text-[11px] text-gray-500">
          Weighted for <span className="font-medium text-gray-700">{verdict.weightedFor}</span>
        </p>
      )}

      {(verdict.highlights.length > 0 || verdict.caveats.length > 0) && (
        <ul className="mt-2 space-y-1">
          {verdict.highlights.map((h, i) => (
            <li key={`h-${i}`} className="flex gap-1.5 text-[13px] text-ink-1 leading-snug">
              <Check className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-hockia-primary" aria-hidden="true" />
              <span>{h}</span>
            </li>
          ))}
          {verdict.caveats.map((c, i) => (
            <li key={`c-${i}`} className="flex gap-1.5 text-[13px] text-ink-2 leading-snug">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-ink-3" aria-hidden="true" />
              <span>{c}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
