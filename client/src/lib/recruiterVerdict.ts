/**
 * Recruiter verdict — the explanation-led SYNTHESIS that leads the
 * recruiter card (Matching Increment #5, deterministic half).
 *
 * The four lenses each answer one question — Fit (right level/role?),
 * Proven (can I trust it?), Interested (will they want it?), and the
 * eligibility hard gate (handled upstream). Until now the recruiter card
 * stacked them as independent chips and left the recruiter to integrate
 * them in their head. This fuses the lens RESULTS into a single qualitative
 * read — a tier headline plus the most decision-relevant highlights and
 * caveats — so the card leads with "worth a look, and why" instead of a
 * pile of signals.
 *
 * Core principle (project_hockia_matching_model): explanation over a single
 * percentage. The numeric lens scores stay INTERNAL; the verdict exposes a
 * qualitative tier + reasons, never a "%". Pure + synchronous over results
 * the card already computes, so it's fully unit-testable and always present
 * (no LLM, no latency). The AI Opinion panel narrates this same verdict in
 * richer prose when available (#5 Part 2) — it does not replace it.
 *
 * #6: the active scope's recruitment problem reshapes the cross-lens
 * weighting + which highlight leads, so the same candidate can read
 * differently for "replace a key player" vs "young talent with potential".
 */

import { recruitmentProblemLabel } from './opportunityIntent'

/**
 * Action-led recommendation tiers — the lead answers "what should the
 * recruiter DO with this candidate for this scope?", not "how good is the
 * fit?" (that's the per-lens chip). Verb-led on purpose so it never reads
 * as another fit chip.
 */
export type VerdictTier = 'pursue' | 'consider' | 'longshot' | 'pass'

/** Minimal shapes the synthesis reads — a structural subset of
 *  ClubFitResult / EvidenceResult / InterestResult so this stays decoupled
 *  from each lens's full interface and trivially testable. `positives` /
 *  `caveats` are the polarity-split reasons (the lenses tag them at source
 *  so the verdict never has to guess a sentence's tone). */
export interface VerdictFitInput {
  isApplicable: boolean
  state: 'green' | 'yellow' | 'grey'
  positives: string[]
  caveats: string[]
}
export interface VerdictEvidenceInput {
  isApplicable: boolean
  level: 'strong' | 'moderate' | 'limited'
  /** Evidence only ever lists what EXISTS, so every reason is a positive. */
  reasons: string[]
}
export interface VerdictInterestInput {
  isApplicable: boolean
  level: 'strong' | 'possible' | 'low'
  positives: string[]
  caveats: string[]
}

export interface RecruiterVerdictInput {
  /** Player Club Fit OR coach Coach Fit — whichever applies to this card. */
  fit: VerdictFitInput | null | undefined
  evidence: VerdictEvidenceInput | null | undefined
  interest: VerdictInterestInput | null | undefined
  /** True when an opportunity is the active scope (level/compensation/etc).
   *  Drives the lead's "for your scope" vs "general fit" label — a club
   *  with only a profile-derived team category still gets a verdict, just
   *  framed as a general read rather than for a specific opening. */
  hasOpeningScope?: boolean
  /** Active scope's recruitment problem (#6). Reshapes the cross-lens
   *  weighting + which highlight leads, so the recommendation reflects what
   *  the recruiter is actually solving. Null/unknown → balanced default. */
  problem?: string | null
  /** Candidate role ('player' | 'coach') — only used to word the thin-
   *  evidence caveat correctly (coaches have no video, so "video" mustn't
   *  appear). Defaults to player wording. */
  candidateRole?: string | null
}

export interface RecruiterVerdict {
  /** True only under a meaningful recruiter context (Fit applicable). The
   *  card renders the lead only then — mirrors the AI Opinion gate. */
  isApplicable: boolean
  tier: VerdictTier
  /** 0..1 verdict strength for the card's visual bar — the internal lens
   *  points normalized and kept CONSISTENT with the tier (the grey-fit cap
   *  also caps this), so a bar can never contradict the headline. It is a
   *  qualitative fill, never surfaced as a "%". */
  strength: number
  /** Glanceable tier label, e.g. "Worth a look". */
  headline: string
  /** Ranked positive reasons pulled from the lenses (0–3). */
  highlights: string[]
  /** Ranked concerns pulled from the lenses (0–2). */
  caveats: string[]
  /** Whether an opportunity is the active scope — drives the lead's
   *  "for your scope" vs "general fit" framing. */
  scoped: boolean
  /** Human label of the recruitment problem the weighting was tuned for
   *  (#6), or null when no problem is set (balanced default). Drives the
   *  card's "Weighted for: …" note. */
  weightedFor: string | null
}

const NOT_APPLICABLE: RecruiterVerdict = {
  isApplicable: false,
  tier: 'pass',
  strength: 0,
  headline: '',
  highlights: [],
  caveats: [],
  scoped: false,
  weightedFor: null,
}

const HEADLINES: Record<VerdictTier, string> = {
  pursue: 'Pursue',
  consider: 'Worth considering',
  longshot: 'Longshot',
  pass: 'Likely pass',
}

// Fit is the spine; Interested carries real weight (a clear mismatch — an
// excluded country, a wants-paid-vs-unpaid clash — is a genuine negative,
// hence the −1 floor); Proven is supporting confidence. Points are summed
// INTERNALLY only to pick the qualitative tier — never surfaced.
const FIT_PTS: Record<'green' | 'yellow' | 'grey', number> = { green: 2, yellow: 1, grey: 0 }
const PROVEN_PTS: Record<'strong' | 'moderate' | 'limited', number> = { strong: 2, moderate: 1, limited: 0 }
const INTEREST_PTS: Record<'strong' | 'possible' | 'low', number> = { strong: 2, possible: 1, low: -1 }

interface LensWeights {
  fit: number
  proven: number
  interest: number
}

// Balanced default — also used for 'best_available' framing and any
// unknown/unset problem.
const DEFAULT_WEIGHTS: LensWeights = { fit: 1.0, proven: 0.6, interest: 0.8 }

// #6 — the recruitment problem REDISTRIBUTES cross-lens emphasis. Every
// profile keeps fit+proven+interest ≈ 2.4 (the default total) so the tier
// thresholds below stay calibrated — the problem changes WHICH lens decides
// the verdict, not the overall score magnitude.
// NB: the verdict only sees the three coarse lens TIERS (fit / proven-
// evidence / interest), so these are deliberately coarse levers. "Level" is
// smeared across fit (band proximity) + interest (level alignment), while
// the Proven lens is specifically VERIFIABLE evidence (video + references),
// NOT playing level — so a "raise level" problem leans on fit+interest, not
// on video volume.
const PROBLEM_WEIGHTS: Record<string, LensWeights> = {
  replace_player: { fit: 1.0, proven: 0.9, interest: 0.5 }, // trustworthy, fitting replacement
  raise_level: { fit: 1.1, proven: 0.8, interest: 0.5 }, //     fit-to-the-(high)-scoped-level + quality
  best_available: { fit: 0.7, proven: 1.1, interest: 0.6 }, //  quality/trust over a tight fit
  young_talent: { fit: 1.0, proven: 0.3, interest: 1.1 }, //    thin evidence expected; upside + willingness
  leadership: { fit: 0.9, proven: 1.0, interest: 0.5 }, //      experience / track record + fit
  urgent: { fit: 0.7, proven: 0.4, interest: 1.3 }, //          available + interested NOW
}

// Which lens's highlight LEADS, per problem — only where it's unambiguous.
// Urgent + young-talent are interest-led (can they come / are they keen),
// so lead with the willingness/availability selling point. Every other
// problem keeps the default fit-first order (a clean "lead with level/proven"
// isn't expressible here since level lives across fit+interest).
const PROBLEM_EMPHASIS: Record<string, 'fit' | 'proven' | 'interest'> = {
  young_talent: 'interest',
  urgent: 'interest',
}

// Four action tiers over the internal point sum (range ≈ −0.8 … 4.8).
const PURSUE_AT = 2.6
const CONSIDER_AT = 1.4
const LONGSHOT_AT = 0.4

// Visual strength for the card's bar — the internal points mapped to 0..1,
// anchored to the tier thresholds so the fill bucket ALWAYS agrees with the
// tier word (pass ≈ 6–30%, longshot ≈ 30–55%, consider ≈ 55–80%, pursue ≈
// 80–100%). Piecewise-linear between anchors. Never shown as a number.
const STRENGTH_ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [-0.8, 0.06],
  [LONGSHOT_AT, 0.3],
  [CONSIDER_AT, 0.55],
  [PURSUE_AT, 0.8],
  [4.8, 1.0],
]
function pointsToStrength(points: number): number {
  const a = STRENGTH_ANCHORS
  if (points <= a[0][0]) return a[0][1]
  for (let i = 1; i < a.length; i++) {
    if (points <= a[i][0]) {
      const [x0, y0] = a[i - 1]
      const [x1, y1] = a[i]
      return y0 + ((points - x0) / (x1 - x0)) * (y1 - y0)
    }
  }
  return a[a.length - 1][1]
}

/**
 * Synthesize the recruiter verdict from the computed lens results. Returns
 * NOT_APPLICABLE (card shows no lead) unless Fit is applicable — i.e. the
 * viewer is a recruiter with a resolvable target.
 */
export function computeRecruiterVerdict(input: RecruiterVerdictInput): RecruiterVerdict {
  const { fit, evidence, interest } = input
  if (!fit || !fit.isApplicable) return NOT_APPLICABLE

  // #6 — apply the recruitment problem's weight profile (balanced default
  // when no problem is set or the value is unrecognised).
  const problem = input.problem ?? null
  const weights = (problem && PROBLEM_WEIGHTS[problem]) || DEFAULT_WEIGHTS
  const emphasis = (problem && PROBLEM_EMPHASIS[problem]) || 'fit'

  let points = FIT_PTS[fit.state] * weights.fit
  if (evidence?.isApplicable) points += PROVEN_PTS[evidence.level] * weights.proven
  if (interest?.isApplicable) points += INTEREST_PTS[interest.level] * weights.interest

  let tier: VerdictTier =
    points >= PURSUE_AT ? 'pursue' : points >= CONSIDER_AT ? 'consider' : points >= LONGSHOT_AT ? 'longshot' : 'pass'
  // Fit is the spine: a grey fit (wrong level/role/category for THIS scope)
  // can never be "Pursue" or "Worth considering", however proven or eager
  // the player is — strong video + relocation willingness shouldn't override
  // "doesn't fit what you're recruiting". Cap at longshot so they still
  // surface (the recruiter may be flexible) without a misleading headline.
  if (fit.state === 'grey' && (tier === 'pursue' || tier === 'consider')) tier = 'longshot'

  // Verdict strength for the card's bar. Capped to stay consistent with the
  // tier: a grey fit that was just downgraded to longshot must not show a
  // near-full bar, so its points are pulled below the consider threshold.
  const cappedPoints = fit.state === 'grey' && points >= CONSIDER_AT ? CONSIDER_AT - 0.01 : points
  const strength = pointsToStrength(cappedPoints)

  // Highlights — strongest SELLING POINTS from each lens's polarity-tagged
  // `positives` (so a mixed-tone lens never contributes a concern here).
  // Evidence only lists what exists → all positive, surfaced only when the
  // track record is more than thin (moderate+). #6: the lead highlight
  // follows the problem's EMPHASIS so the explanation speaks to it.
  const fitHi = fit.positives[0] ? [fit.positives[0]] : []
  const provenHi =
    evidence?.isApplicable && evidence.level !== 'limited' && evidence.reasons[0] ? [evidence.reasons[0]] : []
  const interestHi = interest?.isApplicable && interest.positives[0] ? [interest.positives[0]] : []
  const ordered =
    emphasis === 'interest'
      ? [interestHi, fitHi, provenHi]
      : emphasis === 'proven'
        ? [provenHi, fitHi, interestHi]
        : [fitHi, provenHi, interestHi]
  const highlights = ordered.flat().slice(0, 3)

  // Caveats — decision-relevant CONCERNS. A live Interested mismatch is the
  // sharpest; then a Fit concern (category/level/availability); then a thin
  // track record (a synthesized note — evidence reasons are never negative).
  const caveats: string[] = []
  if (interest?.isApplicable && interest.caveats[0]) caveats.push(interest.caveats[0])
  if (fit.caveats[0]) caveats.push(fit.caveats[0])
  if (evidence?.isApplicable && evidence.level === 'limited') {
    // The Proven-lens evidence VOLUME, not their playing level — a proven-
    // level candidate can still have thin verifiable evidence. Coaches have
    // no video-upload surface, so don't mention video for them.
    caveats.push(
      input.candidateRole === 'coach'
        ? 'Limited references & track record on file so far.'
        : 'Limited video & references on file so far.',
    )
  }

  return {
    isApplicable: true,
    tier,
    strength,
    headline: HEADLINES[tier],
    highlights,
    caveats: caveats.slice(0, 2),
    scoped: Boolean(input.hasOpeningScope),
    // Only label a RECOGNISED problem (one with a weight profile) — an
    // unknown value falls back to the default weighting and shows no note.
    weightedFor: problem && PROBLEM_WEIGHTS[problem] ? recruitmentProblemLabel(problem) : null,
  }
}
