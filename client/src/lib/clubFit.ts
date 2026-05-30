/**
 * Club Fit — pragmatic v1
 *
 * Pure TypeScript implementation of the 4-component Fit math. No DB,
 * no cache, no migration. Computed on every render — lists are short
 * (≤50 cards typical), components are cheap (no joins, just math).
 *
 * The principle holds: HOCKIA surfaces facts, never judgments. Fit
 * is about the MATCH (player ↔ recruiting context), never about the
 * person. The three visual states use respectful copy:
 *
 *   green  — "Could be a fit"          (state.label)
 *   yellow — "Worth a closer look"
 *   grey   — "Different level"
 *
 * Components (per the locked spec, simplified for within-country v1):
 *
 *   competition_proximity  40%  — within-country tier distance
 *                                 (cross-country deferred until
 *                                  level_band_global is curated)
 *   gender_match           30%  — player playing_category fits the
 *                                 club's target team category
 *   availability           20%  — open_to_X (60%) + recency_30d (40%)
 *   recency                10%  — recency_30d on profile_updated_at
 *
 * Missing data NEVER raises confidence. Examples:
 *   - Player without playing_category   → gender_match = 0
 *   - Player without current_world_club → competition_proximity = 0
 *   - Player without last_active_at     → availability recency = 0
 *
 * Thresholds: green ≥ 0.66, yellow ≥ 0.40, grey otherwise.
 */

import {
  deriveTargetCategory,
  playingCategoryMatchesTarget,
  type RecruitingContextProfileFields,
  type TargetCategory,
} from './recruitingContext'

export type ClubFitState = 'green' | 'yellow' | 'grey'

export interface ClubFitComponents {
  gender_match: number
  competition_proximity: number
  availability: number
  recency: number
}

export interface ClubFitResult {
  /** True only when the viewer can produce a Fit (club with a target
   *  category). When false, components are all zero and state is grey,
   *  but the chip should HIDE entirely rather than render. */
  isApplicable: boolean
  state: ClubFitState
  /** 0..1, weighted sum of the four components. */
  score: number
  components: ClubFitComponents
  /** Human-readable reasons, used by the chip tooltip. Each entry is
   *  one factual line per evaluated component. */
  reasons: string[]
  /** The target category this Fit was computed against. */
  target: TargetCategory | null
}

/** Player profile fields the Fit math reads. */
export interface FitCandidateFields {
  id: string
  role: string | null
  playing_category: string | null
  current_world_club_id: string | null
  /** Curated 1..10 global level band derived from the player's
   *  current_world_club → world_leagues.level_band_global. P1.2
   *  switched proximity from same-country tier distance to this
   *  global band, eliminating the cross-country dead zone. Null
   *  when the player has no club linked or the club has no league
   *  → competition_proximity = 0. */
  competition_level_band?: number | null
  open_to_play: boolean | null
  open_to_coach: boolean | null
  open_to_opportunities: boolean | null
  last_active_at: string | null
}

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_TIER_DISTANCE_CAP = 4

const WEIGHTS = {
  competition_proximity: 0.4,
  gender_match: 0.3,
  availability: 0.2,
  recency: 0.1,
} as const

const STATE_THRESHOLDS = {
  green: 0.66,
  yellow: 0.4,
} as const

const NOT_APPLICABLE: ClubFitResult = {
  isApplicable: false,
  state: 'grey',
  score: 0,
  components: {
    gender_match: 0,
    competition_proximity: 0,
    availability: 0,
    recency: 0,
  },
  reasons: [],
  target: null,
}

/**
 * Recency factor for activity timestamps: 1.0 within 30d, linear to
 * 0 at 90d, 0 beyond. Matches the spec's recency_30d helper.
 */
function recency30d(timestamp: string | null | undefined): number {
  if (!timestamp) return 0
  const ms = Date.now() - new Date(timestamp).getTime()
  if (Number.isNaN(ms) || ms < 0) return 0
  if (ms <= 30 * DAY_MS) return 1
  if (ms >= 90 * DAY_MS) return 0
  // Linear ramp 30d→90d.
  return 1 - (ms - 30 * DAY_MS) / (60 * DAY_MS)
}

/** Clamp x to [0, 1]. */
function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0
  return Math.max(0, Math.min(1, x))
}

/**
 * Cross-country competition proximity using the curated 1..10
 * level_band_global. Returns 0 when either side is null, 1.0 when the
 * bands match exactly, decaying linearly to 0 at 4+ bands apart.
 * P1.2 replaced the tier+country model — same-country tier distance
 * was a dead-end for cross-border recruiting which is HOCKIA's main
 * use case. The level band collapses both dimensions into one
 * comparable scalar.
 */
function competitionProximity(
  candidateLevelBand: number | null | undefined,
  viewerLevelBand: number | null | undefined,
): number {
  if (candidateLevelBand == null || viewerLevelBand == null) return 0
  const d = Math.abs(candidateLevelBand - viewerLevelBand)
  return clamp01(1 - d / DEFAULT_TIER_DISTANCE_CAP)
}

/**
 * Optional overrides applied on top of the profile-derived context.
 * Sprint 2: the ContextSwitcher chip writes the active context's
 * target_category into `overrideTarget` so a multi-team club can
 * scope Fit to "Women's team this week" without editing their
 * profile. When omitted, Fit falls back to deriveTargetCategory.
 */
export interface ComputeClubFitOptions {
  overrideTarget?: TargetCategory | null
  /** Sought ROLE of the active recruiting context ('player' | 'coach'
   *  | … | null), from the linked opportunity's opportunity_type.
   *  Role-compatibility gate: Club Fit only models PLAYER fit, so when
   *  the active context seeks a non-player role we must produce NO fit
   *  label rather than mislabel players as a fit for, e.g., a coach
   *  opportunity. NULL = club/custom context → treated as
   *  player-seeking (preserves the club→player default). */
  targetRole?: string | null
}

/**
 * Compute a Club Fit result for a single candidate vs the viewer's
 * profile. Returns NOT_APPLICABLE when the viewer can't compute Fit
 * (not a club, or no team category declared). The chip should hide
 * entirely on isApplicable=false rather than render a misleading grey.
 *
 * `options.overrideTarget` (Sprint 2): when the viewer has an active
 * recruiting_context row, its target_category takes precedence over
 * the profile-derived target. Sprint 3 extends the viewer gate to
 * coaches — they have no profile-derived target source, so the
 * override is their only path to an applicable Fit signal.
 */
export function computeClubFit(
  viewerProfile: (RecruitingContextProfileFields & { competition_level_band?: number | null }) | null | undefined,
  candidate: FitCandidateFields | null | undefined,
  options?: ComputeClubFitOptions,
): ClubFitResult {
  if (!viewerProfile || !candidate) return NOT_APPLICABLE
  // Viewer must be a club or coach. Brands / umpires / players / anon
  // never see Fit. The target is resolved below from override OR
  // profile derivation; override-only viewers (coaches with a chosen
  // context, clubs without leagues but with a context) are accepted
  // here even though they have no profile-derived target.
  if (viewerProfile.role !== 'club' && viewerProfile.role !== 'coach') return NOT_APPLICABLE
  // Candidate must be a player. The chip stays hidden on coach / club /
  // umpire / brand candidates so we never surface a misleading signal
  // for roles whose Fit math isn't defined.
  if (candidate.role !== 'player') return NOT_APPLICABLE

  // Role-compatibility gate. The active recruiting context may be
  // scoped to a non-player opportunity (e.g. a club hiring a COACH).
  // Club Fit only models player↔team fit, so when the context seeks a
  // role other than 'player' we must produce NO label — otherwise a
  // player would be mislabelled "Possible fit" for a coach opportunity
  // (the trust bug). NULL targetRole = club/custom context with no
  // explicit role → treated as player-seeking (the club→player
  // default), so today's behaviour is preserved.
  if (options?.targetRole != null && options.targetRole !== 'player') {
    return NOT_APPLICABLE
  }

  // Sprint 3 (coach support): coaches have no profile-derived target —
  // deriveTargetCategory returns null for any non-club viewer — so they
  // rely entirely on options.overrideTarget (set by the ContextSwitcher
  // chip / per-opportunity auto-scope). Clubs still get the profile
  // derivation as a fallback.
  const target = options?.overrideTarget ?? deriveTargetCategory(viewerProfile)
  if (!target) return NOT_APPLICABLE

  // ── Components ──────────────────────────────────────────────────
  const reasons: string[] = []

  // Gender match — player's category against target's allowed set.
  const gender_match = playingCategoryMatchesTarget(candidate.playing_category, target) ? 1 : 0
  if (gender_match === 1 && candidate.playing_category) {
    reasons.push(`Plays ${humanizeCategory(candidate.playing_category)} — matches ${target.toLowerCase()}'s team category.`)
  } else if (candidate.playing_category) {
    reasons.push(`Plays ${humanizeCategory(candidate.playing_category)} — different from your team's category.`)
  } else {
    reasons.push('Playing category not added yet — no match info.')
  }

  // Competition proximity — cross-country via curated level_band_global.
  const competition_proximity = competitionProximity(
    candidate.competition_level_band ?? null,
    viewerProfile.competition_level_band ?? null,
  )
  if (competition_proximity >= 0.75) {
    reasons.push('Plays at a comparable league level to your team.')
  } else if (competition_proximity > 0) {
    reasons.push('Plays at a different league level from your team.')
  } else if (candidate.competition_level_band == null) {
    reasons.push('Current league not linked — level comparison unavailable.')
  } else if (viewerProfile.competition_level_band == null) {
    reasons.push("Your team's league level isn't set — level comparison unavailable.")
  }

  // Availability — open flag (60%) + recency_30d on last_active (40%).
  const isOpen =
    Boolean(candidate.open_to_play) ||
    Boolean(candidate.open_to_coach) ||
    Boolean(candidate.open_to_opportunities)
  const activeFactor = recency30d(candidate.last_active_at)
  const availability = clamp01(0.6 * (isOpen ? 1 : 0) + 0.4 * activeFactor)
  if (isOpen && activeFactor >= 0.99) {
    reasons.push('Open to opportunities and active recently.')
  } else if (isOpen) {
    reasons.push('Open to opportunities (less recent activity).')
  } else if (activeFactor >= 0.99) {
    reasons.push('Recently active (not flagged open to opportunities).')
  } else {
    reasons.push('Not currently flagged open to opportunities.')
  }

  // Recency — profile freshness signal. Profiles updated within 30d
  // count for full credit; we use last_active_at as a proxy when
  // profile_updated_at isn't available in the candidate row.
  const recency = recency30d(candidate.last_active_at)
  // F7 fix: the spec calls for one bullet per weighted component
  // (4 total). Availability already includes a recency factor, but
  // the standalone recency weight (10%) also deserves its own
  // bullet so the popover always shows 4 explanations.
  if (recency >= 0.99) {
    reasons.push('Active on HOCKIA within the last 30 days.')
  } else if (recency > 0) {
    reasons.push('Last active 30–90 days ago — profile partially fresh.')
  } else if (candidate.last_active_at) {
    reasons.push('Last active over 90 days ago.')
  } else {
    reasons.push('Activity recency unknown.')
  }

  // ── Score + state ───────────────────────────────────────────────
  const components: ClubFitComponents = {
    gender_match,
    competition_proximity,
    availability,
    recency,
  }

  const score = clamp01(
    WEIGHTS.competition_proximity * competition_proximity +
      WEIGHTS.gender_match * gender_match +
      WEIGHTS.availability * availability +
      WEIGHTS.recency * recency,
  )

  let state: ClubFitState
  if (score >= STATE_THRESHOLDS.green) state = 'green'
  else if (score >= STATE_THRESHOLDS.yellow) state = 'yellow'
  else state = 'grey'

  return {
    isApplicable: true,
    state,
    score,
    components,
    reasons,
    target,
  }
}

/** UI label for a state — single source of truth, used by both the
 *  visible chip text and the hover/tap tooltip so the two never drift. */
export function clubFitStateLabel(state: ClubFitState): string {
  switch (state) {
    case 'green':
      return 'Strong fit'
    case 'yellow':
      return 'Possible fit'
    case 'grey':
      return 'Lower fit'
  }
}

function humanizeCategory(category: string): string {
  switch (category) {
    case 'adult_women':
      return 'Adult Women'
    case 'adult_men':
      return 'Adult Men'
    case 'girls':
      return 'Girls'
    case 'boys':
      return 'Boys'
    case 'mixed':
      return 'Mixed'
    default:
      return category
  }
}
