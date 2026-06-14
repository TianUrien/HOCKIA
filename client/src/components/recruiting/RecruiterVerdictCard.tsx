/**
 * RecruiterVerdictCard — the explanation-led lead of the recruiter card
 * (Matching Increment #5). Renders the synthesized verdict from
 * computeRecruiterVerdict: a qualitative tier headline + the ranked
 * highlights and caveats drawn from the four lenses. No percentage — the
 * numeric scores stay internal. Returns null when not applicable (no
 * recruiter scope), so the card simply omits the lead.
 *
 * The AI Opinion panel renders directly beneath this as the richer narrated
 * version of the same verdict; the per-lens chips remain below as the
 * granular breakdown.
 */

import { CheckCircle2, Eye, CircleDashed, MinusCircle, Check, AlertTriangle } from 'lucide-react'
import type { RecruiterVerdict, VerdictTier } from '@/lib/recruiterVerdict'

interface RecruiterVerdictCardProps {
  verdict: RecruiterVerdict
  className?: string
  /** Surface the strength as an explicit "NN% match" number (in addition to
   *  the bar). Off by default so the full profile keeps its explanation-led
   *  read; the recruiter preview sheet opts in, matching the grid card which
   *  already shows the %. */
  showMatchPercent?: boolean
}

const TIER_STYLE: Record<
  VerdictTier,
  { icon: typeof CheckCircle2; iconClass: string; wrapClass: string; headlineClass: string; barClass: string }
> = {
  pursue: {
    icon: CheckCircle2,
    iconClass: 'text-[#8026FA]',
    wrapClass: 'border-[#8026FA]/30 bg-gradient-to-br from-[#8026FA]/[0.06] to-[#924CEC]/[0.04]',
    headlineClass: 'text-[#5b16b8]',
    barClass: 'bg-[#8026FA]',
  },
  consider: {
    icon: Eye,
    iconClass: 'text-gray-700',
    wrapClass: 'border-gray-200 bg-gray-50/70',
    headlineClass: 'text-gray-900',
    barClass: 'bg-[#8026FA]/55',
  },
  longshot: {
    icon: CircleDashed,
    iconClass: 'text-gray-400',
    wrapClass: 'border-gray-200 bg-white',
    headlineClass: 'text-gray-600',
    barClass: 'bg-gray-400',
  },
  pass: {
    icon: MinusCircle,
    iconClass: 'text-gray-400',
    wrapClass: 'border-gray-200 bg-gray-50/40',
    headlineClass: 'text-gray-500',
    barClass: 'bg-gray-300',
  },
}

export default function RecruiterVerdictCard({ verdict, className = '', showMatchPercent = false }: RecruiterVerdictCardProps) {
  if (!verdict.isApplicable) return null
  const style = TIER_STYLE[verdict.tier]
  const Icon = style.icon
  const matchPct = Math.round(verdict.strength * 100)

  return (
    <div
      className={`rounded-xl border px-4 py-3 ${style.wrapClass} ${className}`}
      role="group"
      aria-label={`Recruiter verdict: ${verdict.headline}`}
    >
      <div className="flex items-center gap-2">
        <Icon className={`w-4 h-4 flex-shrink-0 ${style.iconClass}`} aria-hidden="true" />
        <p className={`text-sm font-bold ${style.headlineClass}`}>{verdict.headline}</p>
        {showMatchPercent ? (
          <span className="ml-auto text-xs font-semibold text-[#8026FA]">
            {matchPct}% <span className="font-normal text-gray-400">{verdict.scoped ? 'for your scope' : 'general fit'}</span>
          </span>
        ) : (
          <span className="ml-auto text-[10px] uppercase tracking-wide text-gray-400 font-medium">
            {verdict.scoped ? 'for your scope' : 'general fit'}
          </span>
        )}
      </div>

      {/* Verdict-strength bar — the SAME synthesis as the headline, normalized
          and tier-capped, so it can never disagree with the tier. Never a "%". */}
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-200/70">
        <div
          className={`h-full rounded-full ${style.barClass} transition-[width] duration-300`}
          style={{ width: `${Math.round(verdict.strength * 100)}%` }}
          aria-hidden="true"
        />
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
            <li key={`h-${i}`} className="flex gap-1.5 text-[13px] text-gray-700 leading-snug">
              <Check className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-[#8026FA]" aria-hidden="true" />
              <span>{h}</span>
            </li>
          ))}
          {verdict.caveats.map((c, i) => (
            <li key={`c-${i}`} className="flex gap-1.5 text-[13px] text-gray-500 leading-snug">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-amber-500" aria-hidden="true" />
              <span>{c}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
