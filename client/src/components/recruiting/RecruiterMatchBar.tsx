/**
 * RecruiterMatchBar — the horizontal "Recruiter Match" treatment for a
 * player candidate, shown ONLY when a recruiting scope is active (match
 * is meaningless without a target to match against). Replaces the compact
 * 3-bar ClubFitChip on the Community tile while scoped.
 *
 * Honesty contract (this is the whole point of the component):
 *   - The % is the candidate's REAL Club Fit score (0..1 → 0..100). We
 *     never rescale it to look flattering — a 0.68 reads "68%".
 *   - The "Top X%" is a REAL percentile computed by PeopleListView over
 *     the scoped candidate set (rank ÷ N). The parent suppresses it for a
 *     too-small set (passes topPercent=null), so we never print a
 *     meaningless "Top 50%" for a 2-person list.
 *   - The qualitative label is the source of truth a recruiter should
 *     trust; the number is supporting detail.
 *
 * Recruiter-facing copy only — never speaks to the player ("improve your
 * visibility" is a player message and must not appear here).
 */
import type { ClubFitState } from '@/lib/clubFit'

interface RecruiterMatchBarProps {
  /** Real Club Fit score, 0..1. */
  score: number
  state: ClubFitState
  /** Real percentile over the scoped set (e.g. 15 = ranked in the best
   *  15%). Used only to decide whether to flag "Among best matches" — the
   *  number itself is no longer shown (it read as an unexplained score).
   *  Null when the parent judged the set too small to rank. */
  topPercent?: number | null
  /** Player profile completeness 0..100 — drives the recruiter-facing
   *  qualitative hint. Null/omitted hides the hint line. */
  completenessPct?: number | null
}

// A candidate is flagged "Among best matches" only when genuinely in the
// top quartile of the scoped search — otherwise the label is meaningless.
const BEST_MATCH_MAX_PERCENTILE = 25

const MATCH_TOOLTIP =
  'How well this player fits your active recruiting scope — league level, position, category and availability. Ranked against the other candidates in this search.'

const STATE_STYLE: Record<ClubFitState, { fill: string; text: string; label: string }> = {
  green: { fill: 'bg-[#8026FA]', text: 'text-[#8026FA]', label: 'Strong match' },
  yellow: { fill: 'bg-[#a78bfa]', text: 'text-[#7c3aed]', label: 'Good match' },
  grey: { fill: 'bg-gray-400', text: 'text-gray-500', label: 'Limited match' },
}

/** Recruiter-facing read on profile completeness — a headline + a short
 *  qualifier, mirroring the reference card ("Good amount of information /
 *  Profile looks solid"). Always describes the PROFILE for the recruiter's
 *  decision; never the player-facing "improve your visibility". */
function completenessCopy(pct: number): { headline: string; sub: string } {
  if (pct >= 70) return { headline: 'Good amount of information', sub: 'Profile looks solid.' }
  if (pct >= 45) return { headline: 'Some key info missing', sub: 'May want more before deciding.' }
  return { headline: 'Limited information', sub: 'Hard to assess from the profile alone.' }
}

export default function RecruiterMatchBar({
  score,
  state,
  topPercent = null,
  completenessPct = null,
}: RecruiterMatchBarProps) {
  const style = STATE_STYLE[state]
  const pct = Math.round(Math.max(0, Math.min(1, score)) * 100)
  const isBestMatch = typeof topPercent === 'number' && topPercent <= BEST_MATCH_MAX_PERCENTILE

  return (
    <div className="space-y-1">
      <div
        className="text-[9px] font-medium uppercase tracking-wide text-gray-400"
        title={MATCH_TOOLTIP}
      >
        Recruiter match
      </div>

      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Recruiter match: ${style.label}, ${pct}%`}
      >
        <div className={`h-full rounded-full ${style.fill}`} style={{ width: `${pct}%` }} />
      </div>

      <div className={`text-[11px] font-semibold leading-none ${style.text}`}>
        {style.label} <span className="tabular-nums font-bold">· {pct}%</span>
      </div>

      {isBestMatch && (
        <div className={`text-[10px] font-semibold leading-none ${style.text}`}>
          Among best matches
        </div>
      )}

      {typeof completenessPct === 'number' && completenessPct > 0 && (() => {
        const copy = completenessCopy(completenessPct)
        return (
          <div className="pt-1">
            <div className="flex items-center justify-between text-[9px] font-medium uppercase tracking-wide text-gray-400">
              <span title="How much of this player's profile is filled in. More detail means a more reliable evaluation.">
                Profile complete
              </span>
              <span className="tabular-nums">{completenessPct}%</span>
            </div>
            <div className="text-[11px] font-semibold leading-tight text-gray-700">{copy.headline}</div>
            <div className="text-[10px] leading-tight text-gray-500">{copy.sub}</div>
          </div>
        )
      })()}
    </div>
  )
}
