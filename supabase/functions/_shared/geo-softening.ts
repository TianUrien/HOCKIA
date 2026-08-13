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

/**
 * The geographic filters the original search applied, described in terms both
 * search paths share. Two very different queries run underneath — the profile
 * RPC (base country + free-text city) and the world-club directory (country +
 * province) — so the ladder is expressed as intent and each caller maps it
 * onto its own params.
 */
export interface GeoScope {
  /** Union of every country filter applied. Used to size the widening. */
  countryIds: number[] | null
  /** A narrowing BELOW country level: a city string, or a province id. */
  hasSubCountry: boolean
}

/** Every country sharing a region with the searched one(s). */
export interface RegionPeers {
  /** e.g. "Europe" — from countries.region, populated for all 202 rows. */
  regionLabel: string
  countryIds: number[]
}

/**
 * What a rung does to the country filter:
 *  - `original` — leave the caller's own country filter exactly as it was
 *  - `region`   — replace each applied country filter with the region peers
 *  - `none`     — drop country filtering entirely
 *
 * Deliberately NOT a concrete id list: the profile path filters on two
 * independent country columns, and handing back one merged array would widen
 * a filter past what the user actually asked for.
 */
export type CountryMode = 'original' | 'region' | 'none'

export interface SofteningRung {
  step: GeoSofteningStep
  /** Whether the city/province narrowing survives this rung. */
  keepSubCountry: boolean
  countryMode: CountryMode
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
  const appliedCount = new Set(scope.countryIds ?? []).size
  const hasCountryFilter = appliedCount > 0
  if (!hasCountryFilter && !scope.hasSubCountry) return []

  const rungs: SofteningRung[] = []

  // 1. Drop the city/province, keep the country. Only a distinct rung when a
  //    country filter remains to hold the search in place — with no country,
  //    dropping the sub-country narrowing IS the worldwide rung, and running
  //    it twice would just fire an identical query.
  if (scope.hasSubCountry && hasCountryFilter) {
    rungs.push({ step: 'city', keepSubCountry: false, countryMode: 'original' })
  }

  // 2. Widen the country to its region. Skipped when the region adds nothing
  //    (a single-country region, or the user already searched the whole one).
  if (hasCountryFilter && regionPeers && regionPeers.countryIds.length > appliedCount) {
    rungs.push({ step: 'region', keepSubCountry: false, countryMode: 'region' })
  }

  // 3. Drop geography entirely. Still a good answer for a global network —
  //    relocation is a first-class intent here — but only ever as the last
  //    rung, and always labelled as worldwide.
  rungs.push({ step: 'worldwide', keepSubCountry: false, countryMode: 'none' })

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
  /** Singular form for a count of one, e.g. "club". Falls back to `noun`. */
  nounSingular?: string
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
  const noun = o.count === 1 ? (o.nounSingular ?? o.noun) : o.noun
  const found = `${o.count === 1 ? 'here is' : 'here are'} ${o.count} ${noun}`
  // What the user asked for, in their terms, preferring the most specific.
  const asked = city ?? country ?? 'that area'

  switch (step) {
    case 'city': {
      // The parse frequently puts a COUNTRY in the location text ("United
      // Kingdom" rather than "London"), which leaves no narrower place to
      // contrast against — naming it on both sides produced the nonsense
      // "No clubs in United Kingdom itself — here is 1 in United Kingdom."
      // When the two labels coincide there is no widening worth narrating,
      // so state the plain result instead of inventing a contrast.
      const sameLabel = !city || !country || city.toLowerCase() === country.toLowerCase()
      return sameLabel
        ? `${found.charAt(0).toUpperCase()}${found.slice(1)} in ${country ?? asked}.`
        : `No ${o.noun} in ${city} itself — ${found} elsewhere in ${country}.`
    }
    case 'region':
      return region
        ? `No ${o.noun} in ${asked} on HOCKIA yet — ${found} elsewhere in ${region}.`
        : `No ${o.noun} in ${asked} on HOCKIA yet — ${found} nearby.`
    case 'worldwide':
      return `No ${o.noun} in ${asked} on HOCKIA yet — ${found} from elsewhere in the world.`
  }
}
