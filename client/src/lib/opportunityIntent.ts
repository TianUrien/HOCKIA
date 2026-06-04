/**
 * Opportunity intent vocabularies (Matching Increment #4) — recruiter-side
 * level / compensation / recruitment-problem. Single source of truth for
 * the opportunity form, the read-only display, and (in #4b) the Interested
 * lens. DB stores the `value` keys.
 */

export interface IntentOption {
  value: string
  label: string
}

/** Level of TALENT sought (not the club's own level). */
export const LEVEL_SOUGHT_OPTIONS: readonly IntentOption[] = [
  { value: 'elite', label: 'Elite / International' },
  { value: 'high_performance', label: 'High Performance' },
  { value: 'competitive', label: 'Competitive' },
  { value: 'development', label: 'Development' },
] as const

export const COMPENSATION_OPTIONS: readonly IntentOption[] = [
  { value: 'paid', label: 'Paid' },
  { value: 'unpaid_development', label: 'Unpaid / Development' },
  { value: 'either', label: 'Either' },
] as const

/** Coach-worded "what are you solving this season?" priority. */
export const RECRUITMENT_PROBLEM_OPTIONS: readonly IntentOption[] = [
  { value: 'replace_player', label: 'Replace a key player' },
  { value: 'raise_level', label: 'Raise team level' },
  { value: 'best_available', label: 'Best available anywhere' },
  { value: 'young_talent', label: 'Young talent with potential' },
  { value: 'leadership', label: 'Add leadership / experience' },
  { value: 'urgent', label: 'Urgent need' },
] as const

function labelMap(options: readonly IntentOption[]): Record<string, string> {
  return Object.fromEntries(options.map((o) => [o.value, o.label]))
}
const LEVEL_LABELS = labelMap(LEVEL_SOUGHT_OPTIONS)
const COMPENSATION_LABELS = labelMap(COMPENSATION_OPTIONS)
const PROBLEM_LABELS = labelMap(RECRUITMENT_PROBLEM_OPTIONS)

export function levelSoughtLabel(value: string | null | undefined): string | null {
  return value ? (LEVEL_LABELS[value] ?? value) : null
}
export function compensationLabel(value: string | null | undefined): string | null {
  return value ? (COMPENSATION_LABELS[value] ?? value) : null
}
export function recruitmentProblemLabel(value: string | null | undefined): string | null {
  return value ? (PROBLEM_LABELS[value] ?? value) : null
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
