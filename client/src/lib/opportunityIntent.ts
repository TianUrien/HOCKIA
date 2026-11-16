/**
 * Opportunity intent vocabularies (Matching Increment #4) — recruiter-side
 * level / compensation / recruitment-problem. Single source of truth for
 * the opportunity form, the read-only display, and (in #4b) the Interested
 * lens. DB stores the `value` keys.
 */

import { tOpportunities } from '@/i18n/ns/opportunities.core'
import { withLazyText } from '@/lib/opportunityLazyText'

export interface IntentOption {
  value: string
  label: string
}

/** Level of TALENT sought (not the club's own level). */
export const LEVEL_SOUGHT_OPTIONS: readonly IntentOption[] = [
  withLazyText({ value: 'elite' }, { label: () => tOpportunities('level.elite') }),
  withLazyText({ value: 'high_performance' }, { label: () => tOpportunities('level.highPerformance') }),
  withLazyText({ value: 'competitive' }, { label: () => tOpportunities('level.competitive') }),
  withLazyText({ value: 'development' }, { label: () => tOpportunities('level.development') }),
] as const

export const COMPENSATION_OPTIONS: readonly IntentOption[] = [
  withLazyText({ value: 'paid' }, { label: () => tOpportunities('compensation.paid') }),
  withLazyText({ value: 'unpaid_development' }, { label: () => tOpportunities('compensation.unpaidDevelopment') }),
  withLazyText({ value: 'either' }, { label: () => tOpportunities('compensation.either') }),
] as const

/** Coach-worded "what are you solving this season?" priority. */
export const RECRUITMENT_PROBLEM_OPTIONS: readonly IntentOption[] = [
  withLazyText({ value: 'replace_player' }, { label: () => tOpportunities('recruitmentProblem.replacePlayer') }),
  withLazyText({ value: 'raise_level' }, { label: () => tOpportunities('recruitmentProblem.raiseLevel') }),
  withLazyText({ value: 'best_available' }, { label: () => tOpportunities('recruitmentProblem.bestAvailable') }),
  withLazyText({ value: 'young_talent' }, { label: () => tOpportunities('recruitmentProblem.youngTalent') }),
  withLazyText({ value: 'leadership' }, { label: () => tOpportunities('recruitmentProblem.leadership') }),
  withLazyText({ value: 'urgent' }, { label: () => tOpportunities('recruitmentProblem.urgent') }),
] as const

// Looked up on every call: the option labels follow the interface language.
function labelOf(options: readonly IntentOption[], value: string): string | undefined {
  return options.find((o) => o.value === value)?.label
}

export function levelSoughtLabel(value: string | null | undefined): string | null {
  return value ? (labelOf(LEVEL_SOUGHT_OPTIONS, value) ?? value) : null
}
export function compensationLabel(value: string | null | undefined): string | null {
  return value ? (labelOf(COMPENSATION_OPTIONS, value) ?? value) : null
}
export function recruitmentProblemLabel(value: string | null | undefined): string | null {
  return value ? (labelOf(RECRUITMENT_PROBLEM_OPTIONS, value) ?? value) : null
}

/**
 * Hybrid pre-fill: map a club's curated league band (1..10) to a default
 * level_sought tier. The recruiter can override on the form. Returns ''
 * when the band is unknown (unseeded club) so the field starts blank.
 */
export function levelSoughtFromBand(band: number | null | undefined): string {
  if (band == null || !Number.isFinite(band)) return ''
  if (band <= 2) return 'elite'
  if (band <= 4) return 'high_performance'
  if (band <= 7) return 'competitive'
  return 'development'
}

/** Ordinal rank for level alignment math in #4b (higher = stronger). */
export const LEVEL_RANK: Record<string, number> = {
  elite: 4,
  high_performance: 3,
  competitive: 2,
  development: 1,
}

/**
 * Candidate-side self-declared level target (#2.1 vocabulary:
 * top/competitive/development/any) projected onto the same 4-tier ordinal
 * scale as the opportunity's level_sought, so the Interested lens can
 * compare "what they say they want" against "what the recruiter seeks".
 * 'top' = highest aspiration → elite rank; 'any' is intentionally absent
 * (no constraint → neutral, returns null).
 */
export const CANDIDATE_LEVEL_RANK: Record<string, number> = {
  top: 4,
  competitive: 2,
  development: 1,
}

/** Map a self-declared level_target to its ordinal rank, or null when the
 *  candidate is open to any level (or the value is unset/unknown). */
export function candidateLevelRank(levelTarget: string | null | undefined): number | null {
  if (!levelTarget) return null
  return CANDIDATE_LEVEL_RANK[levelTarget] ?? null
}

/** Map a curated league band (1..10) to the level ordinal it implies —
 *  the candidate's PROVEN level for matching. Goes band → tier key
 *  (levelSoughtFromBand) → LEVEL_RANK. Returns null when the band is
 *  unknown (unseeded club / no linked club). */
export function bandToLevelRank(band: number | null | undefined): number | null {
  const tier = levelSoughtFromBand(band)
  return tier ? (LEVEL_RANK[tier] ?? null) : null
}
