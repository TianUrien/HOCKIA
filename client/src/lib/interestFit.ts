/**
 * Interested lens — "will this candidate actually want THIS opportunity?"
 * (Matching Increment #2.2). Sibling of clubFit / coachFit / evidence.
 *
 * Field-hockey deals fall through on motivation + logistics, not just fit.
 * This scores the candidate's stated intent (Increment #2.1 fields)
 * against the active scope's opportunity:
 *
 *   Mobility — relocation willingness + countries open/excluded vs the
 *     opportunity's country.
 *   Level (#4b) — the opportunity's level_sought vs the candidate's level.
 *     PROVEN level (from the linked club's league band) anchors the score;
 *     self-declared level_target adjusts it secondarily. "What they've
 *     proven" outweighs "what they say" — a recruiter-trust principle.
 *   Compensation (#4b) — the opportunity's compensation vs the candidate's
 *     stated paid/development preference.
 *   Availability — available_from vs the opportunity's start_date. Mostly
 *     dormant today (few opportunities set a start date) → contributes
 *     nothing when unmeasurable, self-activates as clubs add dates.
 *
 * SOFT signal: a clear mismatch (excluded country, wants-paid vs unpaid)
 * ranks the candidate DOWN with a reason — never filters them out. EU
 * eligibility remains the only hard gate.
 *
 * Pure function: country names are resolved by an injected `countryName`
 * (from useCountries) and the candidate's proven band is resolved upstream
 * (useInterest) so this stays testable. Returns NOT_APPLICABLE when
 * nothing can be measured (chip hides), mirroring the other lenses.
 */

import { formatAvailableFrom } from './candidateIntent'
import { tRecruiting } from '@/i18n/ns/recruiting'
import { LEVEL_RANK, bandToLevelRank, candidateLevelRank, levelSoughtLabel } from './opportunityIntent'

export type InterestLevel = 'strong' | 'possible' | 'low'

export interface InterestResult {
  isApplicable: boolean
  level: InterestLevel
  /** 0..1 weighted over the measurable components. */
  score: number
  reasons: string[]
  /** Reasons split by polarity for the #5 recruiter verdict — interest
   *  lines genuinely mix selling points ("open to relocating") with
   *  concerns ("wants paid; this is a development role"), so the verdict
   *  can't infer polarity from the overall level. The chip keeps using the
   *  flat `reasons`. */
  positives: string[]
  caveats: string[]
  /** Phase 3 — a MUST-HAVE interest criterion (level / compensation /
   *  location / availability) the recruiter marked required that the
   *  candidate EXPLICITLY fails. When true the verdict hard-caps to "Out of
   *  scope". A blank candidate field never sets this. Omitted = no fail. */
  hardFail?: boolean
  /** Human reasons for the hard fail, surfaced as the verdict's lead caveat. */
  hardFailReasons?: string[]
}

export interface InterestCandidateFields {
  role: string | null
  relocation_willingness?: string | null
  relocation_countries_open?: number[] | null
  relocation_countries_excluded?: number[] | null
  available_from?: string | null
  /** Candidate's home country (base_country_id ?? nationality_country_id). */
  home_country_id?: number | null
  /** Curated league band (1..10) of the candidate's current club — their
   *  PROVEN level. Resolved upstream (useInterest) from the world-club
   *  cache so this stays a pure number here. Null = unknown. */
  proven_level_band?: number | null
  /** Self-declared level aspiration (#2.1: top/competitive/development/any). */
  level_target?: string | null
  /** Self-declared compensation preference (#2.1: paid/development/either). */
  opportunity_preference?: string | null
}

export interface ComputeInterestOptions {
  /** Sought role of the active scope; Interested applies to that role. */
  targetRole?: string | null
  /** Opportunity location_country (raw text). */
  targetLocationCountry?: string | null
  /** Opportunity start_date (ISO). */
  targetStartDate?: string | null
  /** Opportunity level_sought (#4a: elite/high_performance/competitive/development). */
  targetLevel?: string | null
  /** Opportunity compensation (#4a: paid/unpaid_development/either). */
  targetCompensation?: string | null
  /** Resolve a countries.id to a display name (e.g. useCountries). */
  countryName: (id: number) => string | undefined
  // ── Phase 3 MUST-HAVE flags. Each hard-fails ("Out of scope") only on an
  // EXPLICIT mismatch; a blank candidate field stays neutral. ──
  /** MUST-HAVE level: candidate's KNOWN level is below targetLevel → fail. */
  levelRequired?: boolean
  /** MUST-HAVE compensation: candidate wants paid but the role is unpaid → fail. */
  compensationRequired?: boolean
  /** MUST-HAVE location: candidate excluded the opportunity country, or is
   *  home-only and the opportunity is elsewhere → fail. */
  locationRequired?: boolean
  /** MUST-HAVE availability: candidate's available_from is after start_date → fail. */
  availabilityRequired?: boolean
}

// Level + compensation are now first-class recruiter-intent signals
// alongside mobility; availability stays the minor (mostly dormant) one.
// Weights renormalize over whatever is measurable (see below).
const WEIGHTS = { mobility: 0.35, level: 0.3, compensation: 0.2, availability: 0.15 } as const
const LEVEL_THRESHOLDS = { strong: 0.66, possible: 0.4 } as const

const NOT_APPLICABLE: InterestResult = {
  isApplicable: false,
  level: 'low',
  score: 0,
  reasons: [],
  positives: [],
  caveats: [],
}

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
  // only when the scope carries at least one comparable axis (location,
  // start date, level, or compensation). Without any of those there's
  // nothing to be "interested" against → chip hides.
  if (!options.targetRole || candidate.role !== options.targetRole) return NOT_APPLICABLE
  if (
    !options.targetLocationCountry &&
    !options.targetStartDate &&
    !options.targetLevel &&
    !options.targetCompensation
  ) {
    return NOT_APPLICABLE
  }

  const reasons: string[] = []
  const positives: string[] = []
  const caveats: string[] = []
  const add = (text: string, tone: 'positive' | 'caveat' | 'neutral' = 'neutral') => {
    reasons.push(text)
    if (tone === 'positive') positives.push(text)
    else if (tone === 'caveat') caveats.push(text)
  }
  const measured: Array<{ score: number; weight: number }> = []
  // Phase 3 — MUST-HAVE failures: an EXPLICIT mismatch on a required
  // criterion. Surfaced to the verdict, which hard-caps to "Out of scope".
  const hardFailReasons: string[] = []

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
      add(tRecruiting('interestFit.mobility.excluded', { country: oppRaw }), 'caveat')
      if (options.locationRequired) hardFailReasons.push(tRecruiting('interestFit.hardFail.excluded', { country: oppRaw }))
    } else if (willingness === 'home_only') {
      if (homeNorm && oppNorm) {
        if (homeNorm === oppNorm) {
          mobility = 1
          add(tRecruiting('interestFit.mobility.homeCountry'), 'positive')
        } else {
          mobility = 0
          add(homeName ? tRecruiting('interestFit.mobility.homeOnlyNamed', { country: homeName }) : tRecruiting('interestFit.mobility.homeOnly'), 'caveat')
          if (options.locationRequired) {
            hardFailReasons.push(homeName ? tRecruiting('interestFit.hardFail.homeOnlyNamed', { country: oppRaw, home: homeName }) : tRecruiting('interestFit.hardFail.homeOnly', { country: oppRaw }))
          }
        }
      } else {
        mobility = 0.5
        add(tRecruiting('interestFit.mobility.prefersHome'))
      }
    } else if (willingness === 'relocate' || willingness === 'open_to_discuss') {
      const base = willingness === 'relocate' ? 1 : 0.75
      if (openNorms.length > 0) {
        if (oppNorm && openNorms.includes(oppNorm)) {
          mobility = base
          add(tRecruiting('interestFit.mobility.relocateTo', { country: oppRaw }), 'positive')
        } else {
          mobility = base * 0.5
          add(tRecruiting('interestFit.mobility.relocateNotListed', { country: oppRaw }))
        }
      } else {
        mobility = base
        add(willingness === 'relocate' ? tRecruiting('interestFit.mobility.relocate') : tRecruiting('interestFit.mobility.discuss'), 'positive')
      }
    } else {
      // Countries listed but no explicit willingness pill.
      if (oppNorm && openNorms.includes(oppNorm)) {
        mobility = 0.85
        add(tRecruiting('interestFit.mobility.listed', { country: oppRaw }), 'positive')
      } else if (openNorms.length > 0) {
        mobility = 0.4
        add(tRecruiting('interestFit.mobility.notListed', { country: oppRaw }), 'caveat')
      } else {
        mobility = 0.6
        add(tRecruiting('interestFit.mobility.notExcluded', { country: oppRaw }))
      }
    }
    measured.push({ score: clamp01(mobility), weight: WEIGHTS.mobility })
  }

  // ── Level alignment (proven first, self-declared second) ──
  // PROVEN level (the candidate's club-league band) anchors the score;
  // the self-declared aspiration only adjusts it. A recruiter trusts what
  // a player has demonstrated over what they wrote in a preference.
  const oppLevelRank = options.targetLevel ? (LEVEL_RANK[options.targetLevel] ?? null) : null
  if (oppLevelRank != null) {
    const provenRank = bandToLevelRank(candidate.proven_level_band)
    const declaredRank = candidateLevelRank(candidate.level_target)
    const basisRank = provenRank ?? declaredRank
    if (basisRank != null) {
      const proven = provenRank != null
      const diff = oppLevelRank - basisRank // + = opening above candidate; − = below
      const absDiff = Math.abs(diff)
      let levelScore = absDiff === 0 ? 1 : absDiff === 1 ? 0.8 : absDiff === 2 ? 0.55 : 0.4
      const oppLabel = levelSoughtLabel(options.targetLevel)?.toLowerCase() ?? tRecruiting('interestFit.level.thisLevel')

      if (absDiff === 0) {
        add(
          proven
            ? tRecruiting('interestFit.level.provenMatch', { level: oppLabel })
            : tRecruiting('interestFit.level.targetMatch', { level: oppLabel }),
          'positive',
        )
      } else if (diff > 0) {
        // A stretch upward is ambiguous for interest (ambition vs reach) →
        // neutral, not a selling point.
        add(
          absDiff === 1
            ? (proven ? tRecruiting('interestFit.level.stepUpProven') : tRecruiting('interestFit.level.stepUpTarget'))
            : (proven ? tRecruiting('interestFit.level.wellAboveProven') : tRecruiting('interestFit.level.wellAboveTarget')),
        )
        // MUST-HAVE level fails only on a PROVEN level below the requirement —
        // a self-declared aspiration is a soft signal, not an explicit mismatch
        // of ACTUAL level (proven outranks declared), and a band-less
        // candidate's true level is unknown → neutral, never "Out of scope".
        if (options.levelRequired && proven) hardFailReasons.push(tRecruiting('interestFit.hardFail.belowLevel', { level: oppLabel }))
      } else {
        add(
          proven
            ? (absDiff >= 2 ? tRecruiting('interestFit.level.belowProvenOverqualified') : tRecruiting('interestFit.level.belowProven'))
            : tRecruiting('interestFit.level.belowTarget'),
          'caveat',
        )
      }

      // Secondary: when proven anchors the score, factor in stated desire —
      // a strong player offered a level below what they SAY they want is a
      // weaker interest bet even if they could clearly play it.
      if (proven && declaredRank != null) {
        if (declaredRank < oppLevelRank) {
          levelScore *= 0.85
          add(tRecruiting('interestFit.level.wantsLower'), 'caveat')
        } else if (declaredRank > oppLevelRank + 1) {
          levelScore *= 0.9
          add(tRecruiting('interestFit.level.wantsHigher'), 'caveat')
        }
      }
      measured.push({ score: clamp01(levelScore), weight: WEIGHTS.level })
    }
  }

  // ── Compensation alignment ──
  // Opportunity vocab is paid/unpaid_development/either; candidate vocab is
  // paid/development/either. 'either' on either side = compatible. A clear
  // wants-paid vs unpaid-role clash ranks down (soft, with a reason).
  const oppComp = options.targetCompensation ?? null
  const candPref = candidate.opportunity_preference ?? null
  if (oppComp && candPref) {
    let compScore: number
    let compReason: string
    if (oppComp === 'either' || candPref === 'either') {
      compScore = 0.85
      compReason =
        candPref === 'either' ? tRecruiting('interestFit.comp.openEither') : tRecruiting('interestFit.comp.openingEither')
    } else if (candPref === 'paid' && oppComp === 'paid') {
      compScore = 1
      compReason = tRecruiting('interestFit.comp.paidMatch')
    } else if (candPref === 'development' && oppComp === 'unpaid_development') {
      compScore = 1
      compReason = tRecruiting('interestFit.comp.developmentMatch')
    } else if (candPref === 'paid' && oppComp === 'unpaid_development') {
      compScore = 0.1
      compReason = tRecruiting('interestFit.comp.wantsPaid')
      if (options.compensationRequired) hardFailReasons.push(tRecruiting('interestFit.hardFail.wantsPaid'))
    } else {
      // candidate development, opportunity paid — no conflict, a small plus.
      compScore = 0.9
      compReason = tRecruiting('interestFit.comp.developmentPaid')
    }
    add(compReason, compScore >= 0.66 ? 'positive' : compScore <= 0.4 ? 'caveat' : 'neutral')
    measured.push({ score: compScore, weight: WEIGHTS.compensation })
  }

  // ── Availability ──
  const availFrom = candidate.available_from || null
  const startDate = options.targetStartDate || null
  if (availFrom && startDate) {
    if (availFrom <= startDate) {
      add(tRecruiting('interestFit.availability.inTime', { date: formatAvailableFrom(availFrom) }), 'positive')
      measured.push({ score: 1, weight: WEIGHTS.availability })
    } else {
      add(tRecruiting('interestFit.availability.late', { date: formatAvailableFrom(availFrom), start: formatAvailableFrom(startDate) }), 'caveat')
      measured.push({ score: 0.3, weight: WEIGHTS.availability })
      if (options.availabilityRequired) {
        hardFailReasons.push(tRecruiting('interestFit.hardFail.late', { date: formatAvailableFrom(availFrom), start: formatAvailableFrom(startDate) }))
      }
    }
  }

  if (measured.length === 0) return NOT_APPLICABLE

  const totalWeight = measured.reduce((s, m) => s + m.weight, 0)
  const score = clamp01(measured.reduce((s, m) => s + m.score * m.weight, 0) / totalWeight)
  const level: InterestLevel =
    score >= LEVEL_THRESHOLDS.strong ? 'strong' : score >= LEVEL_THRESHOLDS.possible ? 'possible' : 'low'

  return {
    isApplicable: true,
    level,
    score,
    reasons,
    positives,
    caveats,
    hardFail: hardFailReasons.length > 0,
    hardFailReasons,
  }
}

/** UI label for an interest level. */
export function interestLevelLabel(level: InterestLevel): string {
  switch (level) {
    case 'strong':
      return tRecruiting('interestFit.label.strong')
    case 'possible':
      return tRecruiting('interestFit.label.possible')
    case 'low':
      return tRecruiting('interestFit.label.low')
  }
}
