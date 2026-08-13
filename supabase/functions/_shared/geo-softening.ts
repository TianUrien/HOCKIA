/**
 * Widen a geographic search that found nothing, instead of answering with a
 * blank screen.
 *
 * HOCKIA is a global network with thin coverage in most countries: of 315
 * profiles, only 98 carry a base country at all, and outside Argentina (25),
 * Australia (12) and England (12) most countries have a handful or none. So
 * "clubs near me" legitimately returns zero for a large share of real users —
 * correctly, and uselessly. A player in London asking "what clubs would suit
 * me?" got an empty grid even though there were clubs one country away.
 *
 * The ladder below widens in honest, bounded steps: drop the city but keep the
 * country, then widen the country to its region, then drop geography. Each
 * rung is only taken when the one before it still returned nothing, so the
 * narrowest useful answer always wins.
 *
 * TWO RULES this module exists to enforce:
 *
 *  1. Widen ONLY geography. Every other filter the user gave — position, age,
 *     availability — is carried through untouched. Softening the question
 *     itself would answer something the user never asked.
 *
 *  2. Never widen silently. The caller must state which rung it landed on;
 *     `describeSoftening` writes that sentence. Showing Belgian clubs under a
 *     summary that says "clubs in London" is the same defect as the recruiting
 *     bug fixed on 2026-08-13, where the grid and the copy disagreed.
 */

export type GeoSofteningStep = 'city' | 'region' | 'worldwide'

/** The geographic filters the original search actually applied. */
export interface GeoScope {
  /** Countries the profile must be based in. */
  baseCountryIds: number[] | null
  /** Free text matched against base_city / base_location, e.g. "London". */
  baseLocationText: string | null
  /** World-club country (where the profile plays), not where they live. */
  countryIds: number[] | null
}

/** Every country sharing a region with the searched one(s). */
export interface RegionPeers {
  /** e.g. "Europe" — from countries.region, populated for all 202 rows. */
  regionLabel: string
  countryIds: number[]
}

/** Geographic params only — overlaid on the original search params. */
export interface GeoOverlay {
  p_base_location: string | null
  p_base_country_ids: number[] | null
  p_country_ids: number[] | null
}

export interface SofteningRung {
  step: GeoSofteningStep
  overlay: GeoOverlay
}

/**
 * Build the widening ladder for a search that returned nothing.
 *
 * Returns [] when the search had no geographic filter at all — a zero result
 * then has nothing to do with location and must be reported honestly rather
 * than "fixed" by widening something that was never narrow.
 */
export function buildSofteningLadder(
  scope: GeoScope,
  regionPeers: RegionPeers | null,
): SofteningRung[] {
  const appliedCountries = new Set([
    ...(scope.baseCountryIds ?? []),
    ...(scope.countryIds ?? []),
  ])
  const hasCountryFilter = appliedCountries.size > 0
  const hasCityText = !!scope.baseLocationText?.trim()
  if (!hasCountryFilter && !hasCityText) return []

  const rungs: SofteningRung[] = []

  // 1. Drop the city, keep the country. Only a distinct rung when a country
  //    filter remains to hold the search in place — with no country, dropping
  //    the city IS the worldwide rung, and running it twice would just repeat
  //    an identical query.
  if (hasCityText && hasCountryFilter) {
    rungs.push({
      step: 'city',
      overlay: {
        p_base_location: null,
        p_base_country_ids: scope.baseCountryIds,
        p_country_ids: scope.countryIds,
      },
    })
  }

  // 2. Widen the country to its region. Skipped when the region adds nothing
  //    (a single-country region, or the user already searched the whole one).
  if (hasCountryFilter && regionPeers && regionPeers.countryIds.length > appliedCountries.size) {
    rungs.push({
      step: 'region',
      overlay: {
        p_base_location: null,
        // Widen only the filters that were actually applied: promoting a null
        // filter to a region-wide list would ADD a constraint while claiming
        // to remove one.
        p_base_country_ids: scope.baseCountryIds?.length ? regionPeers.countryIds : null,
        p_country_ids: scope.countryIds?.length ? regionPeers.countryIds : null,
      },
    })
  }

  // 3. Drop geography entirely. Still a good answer for a global network —
  //    relocation is a first-class intent here — but only ever as the last
  //    rung, and always labelled as worldwide.
  rungs.push({
    step: 'worldwide',
    overlay: { p_base_location: null, p_base_country_ids: null, p_country_ids: null },
  })

  return rungs
}

/**
 * Strip anything that would render oddly in a chat bubble. Labels originate
 * from an LLM parse of user text, so they are untrusted: the bubble renders as
 * plain text (no innerHTML) but newlines and box-drawing characters would
 * still show up literally. Mirrors the existing headline sanitizer.
 */
function safeLabel(raw: string | null | undefined): string | null {
  if (!raw) return null
  return raw
    .replace(/[^\p{L}\p{N}\s\-.,'()]/gu, '')
    // \s in the class above KEEPS newlines and tabs, and trim() only reaches
    // the ends — an embedded newline would break the bubble mid-sentence.
    // Collapse all runs of whitespace to a single space.
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40) || null
}

export interface SofteningCopyInput {
  /** Plural entity noun, e.g. "clubs". */
  noun: string
  count: number
  /** The city/free-text the user asked for, e.g. "London". */
  cityLabel?: string | null
  /** The country the search was pinned to, e.g. "England". */
  countryLabel?: string | null
  /** The region widened into, e.g. "Europe". */
  regionLabel?: string | null
}

/**
 * The sentence that tells the user we widened, and how far. Always shown —
 * this is the honesty half of the feature, not decoration.
 */
export function describeSoftening(step: GeoSofteningStep, o: SofteningCopyInput): string {
  const city = safeLabel(o.cityLabel)
  const country = safeLabel(o.countryLabel)
  const region = safeLabel(o.regionLabel)
  const here = o.count === 1 ? 'here is 1' : `here are ${o.count}`
  // What the user asked for, in their terms, preferring the most specific.
  const asked = city ?? country ?? 'that area'

  switch (step) {
    case 'city':
      return `No ${o.noun} in ${asked} itself — ${here} in ${country ?? 'the wider area'}.`
    case 'region':
      return region
        ? `No ${o.noun} in ${asked} on HOCKIA yet — ${here} elsewhere in ${region}.`
        : `No ${o.noun} in ${asked} on HOCKIA yet — ${here} nearby.`
    case 'worldwide':
      return `No ${o.noun} in ${asked} on HOCKIA yet — ${here} from elsewhere in the world.`
  }
}
