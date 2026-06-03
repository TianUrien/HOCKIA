/**
 * Interested lens — "will this candidate actually want THIS opportunity?"
 * (Matching Increment #2.2). Sibling of clubFit / coachFit / evidence.
 *
 * Field-hockey deals fall through on motivation + logistics, not just fit.
 * This scores the candidate's stated intent (Increment #2.1 fields)
 * against the active scope's opportunity:
 *
 *   Mobility (primary) — relocation willingness + countries open/excluded
 *     vs the opportunity's country.
 *   Availability (secondary) — available_from vs the opportunity's
 *     start_date. Mostly dormant today (few opportunities set a start
 *     date) → contributes nothing when unmeasurable, self-activates as
 *     clubs add dates.
 *
 * SOFT signal: a clear mismatch (excluded country, home-only + abroad)
 * ranks the candidate DOWN with a reason — never filters them out. EU
 * eligibility remains the only hard gate.
 *
 * Pure function: country names are resolved by an injected `countryName`
 * (from useCountries) so this stays testable. Returns NOT_APPLICABLE when
 * nothing can be measured (chip hides), mirroring the other lenses.
 *
 * Deferred to Increment #4 (need recruiter-side fields): level-target and
 * paid/development matching.
 */

import { formatAvailableFrom } from './candidateIntent'

export type InterestLevel = 'strong' | 'possible' | 'low'

export interface InterestResult {
  isApplicable: boolean
  level: InterestLevel
  /** 0..1 weighted over the measurable components. */
  score: number
  reasons: string[]
}

export interface InterestCandidateFields {
  role: string | null
  relocation_willingness?: string | null
  relocation_countries_open?: number[] | null
  relocation_countries_excluded?: number[] | null
  available_from?: string | null
  /** Candidate's home country (base_country_id ?? nationality_country_id). */
  home_country_id?: number | null
}

export interface ComputeInterestOptions {
  /** Sought role of the active scope; Interested applies to that role. */
  targetRole?: string | null
  /** Opportunity location_country (raw text). */
  targetLocationCountry?: string | null
  /** Opportunity start_date (ISO). */
  targetStartDate?: string | null
  /** Resolve a countries.id to a display name (e.g. useCountries). */
  countryName: (id: number) => string | undefined
}

const WEIGHTS = { mobility: 0.7, availability: 0.3 } as const
const LEVEL_THRESHOLDS = { strong: 0.66, possible: 0.4 } as const

const NOT_APPLICABLE: InterestResult = { isApplicable: false, level: 'low', score: 0, reasons: [] }

/** Normalize a country name for comparison: lowercase + trim, and fold the
 *  UK home nations to "united kingdom" (opportunities use "England" but
 *  the countries table only has "United Kingdom"). */
function normalizeCountry(name: string | null | undefined): string | null {
  if (!name) return null
  const t = name.trim().toLowerCase()
  if (!t) return null
  if (t === 'england' || t === 'scotland' || t === 'wales' || t === 'northern ireland') {
    return 'united kingdom'
  }
  return t
}

function namesFromIds(ids: number[] | null | undefined, countryName: (id: number) => string | undefined): string[] {
  return (ids ?? []).map((id) => normalizeCountry(countryName(id))).filter((n): n is string => Boolean(n))
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0
  return Math.max(0, Math.min(1, x))
}

/**
 * Compute the Interested signal for a candidate vs the active opportunity
 * scope. Applies only to the scoped role; NOT_APPLICABLE when no component
 * is measurable.
 */
export function computeInterest(
  candidate: InterestCandidateFields | null | undefined,
  options: ComputeInterestOptions,
): InterestResult {
  if (!candidate) return NOT_APPLICABLE
  // Interested only applies to the role the scope seeks (player/coach), and
  // only for an actual opportunity scope (location present).
  if (!options.targetRole || candidate.role !== options.targetRole) return NOT_APPLICABLE
  if (!options.targetLocationCountry && !options.targetStartDate) return NOT_APPLICABLE

  const reasons: string[] = []
  const measured: Array<{ score: number; weight: number }> = []

  // ── Mobility ──
  const willingness = candidate.relocation_willingness ?? null
  const openNorms = namesFromIds(candidate.relocation_countries_open, options.countryName)
  const excludedNorms = namesFromIds(candidate.relocation_countries_excluded, options.countryName)
  const mobilityMeasurable = Boolean(willingness) || openNorms.length > 0 || excludedNorms.length > 0

  if (mobilityMeasurable) {
    const oppRaw = options.targetLocationCountry?.trim() || null
    const oppNorm = normalizeCountry(oppRaw)
    const homeName = candidate.home_country_id ? options.countryName(candidate.home_country_id) : undefined
    const homeNorm = normalizeCountry(homeName)
    let mobility = 0.5 // neutral default when we can't fully assess

    if (oppNorm && excludedNorms.includes(oppNorm)) {
      mobility = 0
      reasons.push(`Excluded ${oppRaw} from the countries they'd consider.`)
    } else if (willingness === 'home_only') {
      if (homeNorm && oppNorm) {
        if (homeNorm === oppNorm) {
          mobility = 1
          reasons.push('Opportunity is in their home country.')
        } else {
          mobility = 0
          reasons.push(`Only wants to stay in ${homeName ?? 'their home country'}.`)
        }
      } else {
        mobility = 0.5
        reasons.push('Prefers to stay in their home country.')
      }
    } else if (willingness === 'relocate' || willingness === 'open_to_discuss') {
      const base = willingness === 'relocate' ? 1 : 0.75
      if (openNorms.length > 0) {
        if (oppNorm && openNorms.includes(oppNorm)) {
          mobility = base
          reasons.push(`Open to relocating to ${oppRaw}.`)
        } else {
          mobility = base * 0.5
          reasons.push(`Open to relocating, though ${oppRaw} isn't in their listed countries.`)
        }
      } else {
        mobility = base
        reasons.push(willingness === 'relocate' ? 'Open to relocating.' : 'Open to discussing relocation.')
      }
    } else {
      // Countries listed but no explicit willingness pill.
      if (oppNorm && openNorms.includes(oppNorm)) {
        mobility = 0.85
        reasons.push(`Lists ${oppRaw} among countries they'd consider.`)
      } else if (openNorms.length > 0) {
        mobility = 0.4
        reasons.push(`${oppRaw} isn't among their listed countries.`)
      } else {
        mobility = 0.6
        reasons.push(`Hasn't excluded ${oppRaw}.`)
      }
    }
    measured.push({ score: clamp01(mobility), weight: WEIGHTS.mobility })
  }

  // ── Availability ──
  const availFrom = candidate.available_from || null
  const startDate = options.targetStartDate || null
  if (availFrom && startDate) {
    if (availFrom <= startDate) {
      reasons.push(`Available from ${formatAvailableFrom(availFrom)} — in time for the start.`)
      measured.push({ score: 1, weight: WEIGHTS.availability })
    } else {
      reasons.push(`Available from ${formatAvailableFrom(availFrom)}, after the ${formatAvailableFrom(startDate)} start.`)
      measured.push({ score: 0.3, weight: WEIGHTS.availability })
    }
  }

  if (measured.length === 0) return NOT_APPLICABLE

  const totalWeight = measured.reduce((s, m) => s + m.weight, 0)
  const score = clamp01(measured.reduce((s, m) => s + m.score * m.weight, 0) / totalWeight)
  const level: InterestLevel =
    score >= LEVEL_THRESHOLDS.strong ? 'strong' : score >= LEVEL_THRESHOLDS.possible ? 'possible' : 'low'

  return { isApplicable: true, level, score, reasons }
}

/** UI label for an interest level. */
export function interestLevelLabel(level: InterestLevel): string {
  switch (level) {
    case 'strong':
      return 'Strong interest'
    case 'possible':
      return 'Possible interest'
    case 'low':
      return 'Low interest'
  }
}
