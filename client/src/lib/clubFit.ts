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
  /** Optional: the player's club's league tier. When the carousel /
   *  grid hasn't joined to world_clubs.world_leagues, this is null
   *  and competition_proximity falls back to a binary same-club
   *  signal (worth a yellow at best). */
  competition_tier?: number | null
  /** Optional: the player's club's country, for the cross-country
   *  guard. When null, we assume same-country (v1 simplification). */
  competition_country_code?: string | null
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
 * Within-country competition proximity. Returns 0 when we have no tier
 * data, 1.0 when the tiers match exactly, decaying linearly to 0 over
 * 4 tier steps. Cross-country comparisons return 0 until level_band_global
 * is curated.
 */
function competitionProximity(
  candidateTier: number | null | undefined,
  viewerTier: number | null | undefined,
  candidateCountry: string | null | undefined,
  viewerCountry: string | null | undefined,
): number {
  if (candidateTier == null || viewerTier == null) return 0
  // Cross-country gate: when both countries are known and they differ,
  // we can't honestly compare tiers without the level_band_global
  // curation layer. Return 0.
  if (
    candidateCountry &&
    viewerCountry &&
    candidateCountry !== viewerCountry
  ) {
    return 0
  }
  const d = Math.abs(candidateTier - viewerTier)
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
}

/**
 * Compute a Club Fit result for a single candidate vs the viewer's
 * profile. Returns NOT_APPLICABLE when the viewer can't compute Fit
 * (not a club, or no team category declared). The chip should hide
 * entirely on isApplicable=false rather than render a misleading grey.
 *
 * `options.overrideTarget` (Sprint 2): when the viewer has an active
 * recruiting_context row, its target_category takes precedence over
 * the profile-derived target. The viewer-role gate (clubs only) still
 * applies — overrides don't expand who sees the chip.
 */
export function computeClubFit(
  viewerProfile: (RecruitingContextProfileFields & { competition_tier?: number | null; competition_country_code?: string | null }) | null | undefined,
  candidate: FitCandidateFields | null | undefined,
  options?: ComputeClubFitOptions,
): ClubFitResult {
  if (!viewerProfile || !candidate) return NOT_APPLICABLE
  // Viewer must be a club (Sprint v1 + Sprint 2 keep the chip
  // club-viewer only). We deliberately do NOT use isViewerFitCapable
  // here because that helper also requires a profile-derived target,
  // which would block override-only viewers (e.g., a brand-new club
  // that picked a context via the switcher before filling leagues).
  if (viewerProfile.role !== 'club') return NOT_APPLICABLE
  // Sprint v1: Fit chip is PLAYER-only. Coach context is deferred to
  // Sprint 2 (coaches need a different data source for their target —
  // their primary club affiliation, recruiter flag, etc.). Returning
  // NOT_APPLICABLE here hides the chip on coach / club / umpire /
  // brand candidates so we never surface a misleading signal.
  if (candidate.role !== 'player') return NOT_APPLICABLE

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

  // Competition proximity (within-country).
  const competition_proximity = competitionProximity(
    candidate.competition_tier ?? null,
    viewerProfile.competition_tier ?? null,
    candidate.competition_country_code ?? null,
    viewerProfile.competition_country_code ?? null,
  )
  if (competition_proximity >= 0.75) {
    reasons.push('Same or adjacent league tier to your club.')
  } else if (competition_proximity > 0) {
    reasons.push('Different league tier from your club.')
  } else if (candidate.competition_tier == null) {
    reasons.push('Current league not linked — tier comparison unavailable.')
  } else if (
    candidate.competition_country_code &&
    viewerProfile.competition_country_code &&
    candidate.competition_country_code !== viewerProfile.competition_country_code
  ) {
    reasons.push('Plays in a different country — cross-country fit not yet supported.')
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
