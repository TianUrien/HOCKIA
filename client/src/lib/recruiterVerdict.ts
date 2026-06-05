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
 */

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
}

export interface RecruiterVerdict {
  /** True only under a meaningful recruiter context (Fit applicable). The
   *  card renders the lead only then — mirrors the AI Opinion gate. */
  isApplicable: boolean
  tier: VerdictTier
  /** Glanceable tier label, e.g. "Worth a look". */
  headline: string
  /** Ranked positive reasons pulled from the lenses (0–3). */
  highlights: string[]
  /** Ranked concerns pulled from the lenses (0–2). */
  caveats: string[]
  /** Whether an opportunity is the active scope — drives the lead's
   *  "for your scope" vs "general fit" framing. */
  scoped: boolean
}

const NOT_APPLICABLE: RecruiterVerdict = {
  isApplicable: false,
  tier: 'pass',
  headline: '',
  highlights: [],
  caveats: [],
  scoped: false,
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

const W_FIT = 1.0
const W_PROVEN = 0.6
const W_INTEREST = 0.8

// Four action tiers over the internal point sum (range ≈ −0.8 … 4.8).
const PURSUE_AT = 2.6
const CONSIDER_AT = 1.4
const LONGSHOT_AT = 0.4

/**
 * Synthesize the recruiter verdict from the computed lens results. Returns
 * NOT_APPLICABLE (card shows no lead) unless Fit is applicable — i.e. the
 * viewer is a recruiter with a resolvable target.
 */
export function computeRecruiterVerdict(input: RecruiterVerdictInput): RecruiterVerdict {
  const { fit, evidence, interest } = input
  if (!fit || !fit.isApplicable) return NOT_APPLICABLE

  let points = FIT_PTS[fit.state] * W_FIT
  if (evidence?.isApplicable) points += PROVEN_PTS[evidence.level] * W_PROVEN
  if (interest?.isApplicable) points += INTEREST_PTS[interest.level] * W_INTEREST

  let tier: VerdictTier =
    points >= PURSUE_AT ? 'pursue' : points >= CONSIDER_AT ? 'consider' : points >= LONGSHOT_AT ? 'longshot' : 'pass'
  // Fit is the spine: a grey fit (wrong level/role/category for THIS scope)
  // can never be "Pursue" or "Worth considering", however proven or eager
  // the player is — strong video + relocation willingness shouldn't override
  // "doesn't fit what you're recruiting". Cap at longshot so they still
  // surface (the recruiter may be flexible) without a misleading headline.
  if (fit.state === 'grey' && (tier === 'pursue' || tier === 'consider')) tier = 'longshot'

  // Highlights — strongest SELLING POINTS, fit first (spine), then proven,
  // then interested. Pull from each lens's polarity-tagged `positives` so a
  // mixed-tone lens (interest) never contributes a concern here. Evidence
  // only lists what exists, so its reasons are all positive — but only
  // surface them when the track record is more than thin (moderate+).
  const highlights: string[] = []
  if (fit.positives[0]) highlights.push(fit.positives[0])
  if (evidence?.isApplicable && evidence.level !== 'limited' && evidence.reasons[0]) {
    highlights.push(evidence.reasons[0])
  }
  if (interest?.isApplicable && interest.positives[0]) highlights.push(interest.positives[0])

  // Caveats — decision-relevant CONCERNS. A live Interested mismatch is the
  // sharpest; then a Fit concern (category/level/availability); then a thin
  // track record (a synthesized note — evidence reasons are never negative).
  const caveats: string[] = []
  if (interest?.isApplicable && interest.caveats[0]) caveats.push(interest.caveats[0])
  if (fit.caveats[0]) caveats.push(fit.caveats[0])
  if (evidence?.isApplicable && evidence.level === 'limited') {
    // Specifically the Proven-lens evidence VOLUME (video + references),
    // not their playing level — a proven-level player can still have thin
    // verifiable evidence on file, so keep this distinct from "level".
    caveats.push('Limited video & references on file so far.')
  }

  return {
    isApplicable: true,
    tier,
    headline: HEADLINES[tier],
    highlights: highlights.slice(0, 3),
    caveats: caveats.slice(0, 2),
    scoped: Boolean(input.hasOpeningScope),
  }
}
