/**
 * Coach Fit — specialization-only v1 (Phase 2C)
 *
 * Sibling to clubFit.ts, but for COACH candidates under a COACH-seeking
 * recruiting scope. Where Club Fit ranks players on a 4–5 component blend,
 * Coach Fit v1 is deliberately narrow: the dominant signal is whether the
 * coach's SPECIALIZATION matches the coaching role the opportunity seeks
 * (e.g. a "Head Coach" opportunity floats head coaches up). The team
 * CATEGORY (Men/Women/Mixed) acts only as a tiebreaker.
 *
 * Availability + recency are intentionally NOT scored yet — there is less
 * objective signal for coach fit than player fit, and the product decision
 * (locked with the founder) was to ship the specialization story first and
 * layer the softer signals on later.
 *
 * Same principle as Club Fit: HOCKIA surfaces the MATCH (coach ↔ sought
 * role), never a judgment about the person. Missing data never raises
 * confidence.
 *
 * Applicability — Coach Fit produces a result ONLY when:
 *   - the viewer is a club or coach (recruiter surfaces), AND
 *   - the candidate is a coach, AND
 *   - the active scope seeks a coach (targetRole === 'coach'), AND
 *   - the scope names a specific coaching role (targetSpecialization set).
 * When no specific role is sought there is nothing to rank specialization
 * on, so we return NOT_APPLICABLE and Community keeps its completeness
 * ordering (Phase 1 behaviour) with no chip.
 *
 * Score = 0.8·specialization_match + 0.2·category_match.
 *   spec match + category   → 1.0  (green — strong)
 *   spec match only         → 0.8  (green — strong)
 *   category only           → 0.2  (grey — low)
 *   neither                 → 0.0  (grey — low)
 * Thresholds match Club Fit: green ≥ 0.66, yellow ≥ 0.40, grey otherwise.
 */

import {
  playingCategoryMatchesTarget,
  type RecruitingContextProfileFields,
  type TargetCategory,
} from './recruitingContext'
import { isOpenToAny } from './hockeyCategories'

export type CoachFitState = 'green' | 'yellow' | 'grey'

export interface CoachFitComponents {
  /** 1 when the coach's specialization matches the sought coaching role,
   *  else 0. The dominant signal in v1. */
  specialization_match: number
  /** 1 when any of the coach's coaching categories fits the target team
   *  category (or they're open to any), else 0. Tiebreak only. */
  category_match: number
}

export interface CoachFitResult {
  /** True only when a coach-fit signal is meaningful (see module doc). The
   *  chip hides entirely on false rather than render a misleading grey. */
  isApplicable: boolean
  state: CoachFitState
  /** 0..1 weighted score (specialization-dominant). */
  score: number
  components: CoachFitComponents
  /** Factual, non-judgmental lines for the chip tooltip. */
  reasons: string[]
  /** Reasons split by polarity for the #5 recruiter verdict (the chip
   *  keeps using the flat `reasons`). */
  positives: string[]
  caveats: string[]
  /** The target category this fit was computed against. */
  target: TargetCategory | null
}

/** Coach candidate fields the fit math reads. */
export interface CoachFitCandidateFields {
  id: string
  role: string | null
  coach_specialization: string | null
  coaching_categories: string[] | null
}

export interface ComputeCoachFitOptions {
  /** Sought team category (Men/Women/Mixed) from the active scope. */
  overrideTarget?: TargetCategory | null
  /** Sought role of the active scope ('player' | 'coach' | …). Coach Fit
   *  only applies when this is 'coach'. */
  targetRole?: string | null
  /** Sought coaching role, from the linked opportunity's `position`
   *  (which, for coach opportunities, carries the coach role enum, e.g.
   *  'head_coach'). NULL when the coach opportunity named no specific
   *  role → Coach Fit is NOT_APPLICABLE. */
  targetSpecialization?: string | null
}

const WEIGHTS = {
  specialization: 0.8,
  category: 0.2,
} as const

const STATE_THRESHOLDS = {
  green: 0.66,
  yellow: 0.4,
} as const

const NOT_APPLICABLE: CoachFitResult = {
  isApplicable: false,
  state: 'grey',
  score: 0,
  components: { specialization_match: 0, category_match: 0 },
  reasons: [],
  positives: [],
  caveats: [],
  target: null,
}

/** Normalize a coach specialization for comparison. Profiles use values
 *  like 'head_coach' / 'other'; opportunity.position uses the coach
 *  enum ('head_coach', 'assistant_coach', 'youth_coach', 'other_coach',
 *  …). Stripping a trailing '_coach' aligns the two vocabularies so
 *  'other_coach' ↔ 'other' and 'head_coach' ↔ 'head_coach' both match. */
function normalizeSpec(s: string | null | undefined): string | null {
  if (!s) return null
  const t = s.trim().toLowerCase()
  if (!t) return null
  return t.endsWith('_coach') ? t.slice(0, -'_coach'.length) : t
}

/** Human label for a coach specialization value (enum or profile form). */
export function humanizeCoachSpecialization(spec: string): string {
  const known: Record<string, string> = {
    head_coach: 'Head Coach',
    head: 'Head Coach',
    assistant_coach: 'Assistant Coach',
    assistant: 'Assistant Coach',
    youth_coach: 'Youth Coach',
    youth: 'Youth Coach',
    goalkeeper_coach: 'Goalkeeper Coach',
    goalkeeper: 'Goalkeeper Coach',
    strength_conditioning: 'Strength & Conditioning',
    performance_analyst: 'Performance Analyst',
    sports_scientist: 'Sports Scientist',
    other_coach: 'Other',
    other: 'Other',
  }
  const p = spec.trim().toLowerCase()
  if (known[p]) return known[p]
  return p
    .split(/[\s_-]+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
}

/**
 * Compute a Coach Fit result for a single coach candidate vs the active
 * coach-seeking recruiting scope. Returns NOT_APPLICABLE unless every
 * applicability condition in the module doc holds.
 */
export function computeCoachFit(
  viewerProfile: RecruitingContextProfileFields | null | undefined,
  candidate: CoachFitCandidateFields | null | undefined,
  options?: ComputeCoachFitOptions,
): CoachFitResult {
  if (!viewerProfile || !candidate) return NOT_APPLICABLE
  // Recruiter surfaces only — clubs and coaches.
  if (viewerProfile.role !== 'club' && viewerProfile.role !== 'coach') return NOT_APPLICABLE
  // Candidate must be a coach.
  if (candidate.role !== 'coach') return NOT_APPLICABLE
  // The scope must explicitly seek a coach. (Player/null scopes never
  // produce a coach-fit signal — the player path owns those.)
  if (options?.targetRole !== 'coach') return NOT_APPLICABLE

  const target = options?.overrideTarget ?? null
  const soughtSpec = normalizeSpec(options?.targetSpecialization)
  // No specific coaching role sought → nothing to rank specialization on.
  if (!soughtSpec) return NOT_APPLICABLE

  const reasons: string[] = []
  const positives: string[] = []
  const caveats: string[] = []
  const pushReason = (text: string, tone: 'positive' | 'caveat' | 'neutral' = 'neutral') => {
    reasons.push(text)
    if (tone === 'positive') positives.push(text)
    else if (tone === 'caveat') caveats.push(text)
  }

  // ── Specialization match (dominant signal) ──
  const candidateSpec = normalizeSpec(candidate.coach_specialization)
  const specialization_match = candidateSpec && candidateSpec === soughtSpec ? 1 : 0
  const soughtLabel = humanizeCoachSpecialization(options!.targetSpecialization!)
  if (specialization_match === 1) {
    pushReason(`Specializes as ${soughtLabel} — matches the role you're recruiting.`, 'positive')
  } else if (candidate.coach_specialization) {
    pushReason(
      `Specializes as ${humanizeCoachSpecialization(candidate.coach_specialization)} — not ${soughtLabel}.`,
      'caveat',
    )
  } else {
    pushReason('Coaching specialization not added yet — no role match info.')
  }

  // ── Category match (tiebreak) ──
  const category_match =
    target &&
    (isOpenToAny(candidate.coaching_categories) ||
      (Array.isArray(candidate.coaching_categories) &&
        candidate.coaching_categories.some((c) => playingCategoryMatchesTarget(c, target))))
      ? 1
      : 0
  if (target) {
    if (category_match === 1) {
      pushReason(`Coaches ${target.toLowerCase()}'s teams — matches your team category.`, 'positive')
    } else if (Array.isArray(candidate.coaching_categories) && candidate.coaching_categories.length > 0) {
      pushReason(`Coaches a different team category from ${target.toLowerCase()}'s.`, 'caveat')
    } else {
      pushReason('Coaching categories not added yet — no category match info.')
    }
  }

  const score = WEIGHTS.specialization * specialization_match + WEIGHTS.category * category_match

  let state: CoachFitState
  if (score >= STATE_THRESHOLDS.green) state = 'green'
  else if (score >= STATE_THRESHOLDS.yellow) state = 'yellow'
  else state = 'grey'

  return {
    isApplicable: true,
    state,
    score,
    components: { specialization_match, category_match },
    reasons,
    positives,
    caveats,
    target,
  }
}

/** UI label for a coach-fit state — single source of truth for chip text
 *  and tooltip. Matches the Club Fit vocabulary so the two read alike. */
export function coachFitStateLabel(state: CoachFitState): string {
  switch (state) {
    case 'green':
      return 'Strong fit'
    case 'yellow':
      return 'Possible fit'
    case 'grey':
      return 'Lower fit'
  }
}
