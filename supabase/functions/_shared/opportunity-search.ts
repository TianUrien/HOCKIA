/**
 * Hockia AI — open-role search for candidate viewers (players, and coaches
 * looking for work).
 *
 * Deterministic on purpose: the query is small ("midfielder roles in Europe
 * with housing") and every filter has to be explainable, so we parse it with
 * keyword rules and filter the rows of `public_opportunities` in memory.
 * That view already carries the visibility rules (status = open, publisher
 * not hidden / not a test account / onboarded); on top of it we apply the
 * same application-eligibility rules the `check_application_eligibility`
 * trigger enforces, so we only ever surface roles the viewer can apply to.
 *
 * Product rules honoured here: no fit/match scores, no applicant counts, no
 * level pills, no reply-time estimates, gender-neutral copy, and no internal
 * enum values in anything the user reads.
 *
 * Pure functions only — unit-tested in opportunity-search.test.ts.
 */

import { labelFor, labelForInline } from './display-labels.ts'

export type OpportunityType = 'player' | 'coach'
export type OpportunityGender = 'Men' | 'Women' | 'Girls' | 'Boys' | 'Mixed'

/** A row of `public_opportunities` (only the columns we read). */
export interface OpportunityRow {
  id: string
  title: string | null
  opportunity_type: OpportunityType | null
  position: string | null
  gender: OpportunityGender | null
  location_city: string | null
  location_country: string | null
  application_deadline: string | null
  benefits: string[] | null
  custom_benefits: string[] | null
  eu_passport_required: boolean | null
  created_at: string | null
  club_name: string | null
  club_logo_url: string | null
  organization_name: string | null
  world_club_name: string | null
  world_club_avatar_url: string | null
}

/** What the client renders — labels only, never raw enum values. */
export interface OpportunityResult {
  id: string
  title: string
  position_label: string | null
  category_label: string | null
  location_label: string | null
  organization: string | null
  logo_url: string | null
  benefit_labels: string[]
  deadline: string | null
  navigate_to: string
}

export interface CountryRef {
  name: string
  common_name?: string | null
  region: string | null
}

export interface Viewer {
  role: 'player' | 'coach'
  /** 'men' | 'women' | null (unknown → never blocks). */
  gender: 'men' | 'women' | null
  /** true/false when nationality is known, null when it isn't. */
  euEligible: boolean | null
  position: string | null
  secondaryPosition: string | null
}

export interface OpportunityCriteria {
  opportunityType: OpportunityType
  positions: string[]
  benefits: string[]
  /** Team categories named in the query ("women's roles"). */
  genders: OpportunityGender[]
  /** Lower-cased country names/aliases to match location_country against. */
  countryNames: string[]
  /** Display label of the country filter, e.g. "Spain". */
  countryLabel: string | null
  /** Region named directly in the query, e.g. "Europe". */
  regionLabel: string | null
}

// ── Parsing ────────────────────────────────────────────────────────────────

const PLAYER_POSITION_PATTERNS: Array<[string, RegExp]> = [
  ['goalkeeper', /\b(?:goal ?keep(?:er|ers|ing)?|gks?|keepers?|arquer[oa]s?|porter[oa]s?)\b/i],
  ['defender', /\b(?:defen(?:der|ders|ce|sive)|defensor(?:es|as?)?)\b/i],
  ['midfielder', /\b(?:mid ?field(?:er|ers)?|mediocampistas?|volantes?)\b/i],
  ['forward', /\b(?:forwards?|strikers?|attack(?:er|ers|ing)?|delanter[oa]s?)\b/i],
]

const COACH_POSITION_PATTERNS: Array<[string, RegExp]> = [
  ['head_coach', /\bhead coach(?:es|ing)?\b/i],
  ['assistant_coach', /\bassistant coach(?:es|ing)?\b/i],
  ['youth_coach', /\b(?:youth|junior) coach(?:es|ing)?\b/i],
  ['goalkeeper_coach', /\b(?:gk|goal ?keep(?:er|ing)) coach(?:es|ing)?\b/i],
  ['strength_conditioning', /\b(?:s ?& ?c|strength (?:and|&) conditioning)\b/i],
  ['performance_analyst', /\b(?:performance )?analysts?\b/i],
  ['sports_scientist', /\bsports? scientists?\b/i],
]

const BENEFIT_PATTERNS: Array<[string, RegExp]> = [
  ['housing', /\b(?:housing|accommodation|apartment|place to (?:live|stay)|vivienda|alojamiento)\b/i],
  ['flights', /\b(?:flights?|airfare|plane tickets?|pasajes?)\b/i],
  ['visa', /\bvisas?\b/i],
  ['car', /\b(?:car|vehicle)\b/i],
  ['job', /\b(?:(?:a )?(?:job|work) (?:arranged|included|provided)|employment|trabajo)\b/i],
  ['insurance', /\binsurance\b/i],
  ['bonuses', /\bbonus(?:es)?\b/i],
  ['equipment', /\b(?:equipment|kit provided|sticks provided)\b/i],
  ['meals', /\b(?:meals?|food)\b/i],
  ['education', /\b(?:education|study|studies|university|scholarship)\b/i],
]

const GENDER_PATTERNS: Array<[OpportunityGender[], RegExp]> = [
  [['Women'], /\b(?:women'?s?|womens|ladies|female)\b/i],
  [['Men'], /\b(?:men'?s?|mens|male)\b/i],
  [['Girls'], /\bgirls?\b/i],
  [['Boys'], /\bboys?\b/i],
  [['Mixed'], /\bmixed\b/i],
]

/** Aliases the countries table spells differently from how people type. */
const COUNTRY_ALIASES: Record<string, string[]> = {
  'united kingdom': ['uk', 'britain', 'great britain', 'england', 'scotland', 'wales'],
  'united states': ['usa', 'us', 'america', 'united states of america'],
  netherlands: ['holland', 'the netherlands'],
}

const REGION_ALIASES: Record<string, string[]> = {
  europe: ['europe', 'european', 'europa'],
  'south america': ['south america', 'latin america', 'sudamerica', 'sudamérica'],
  'north america': ['north america'],
  oceania: ['oceania'],
  asia: ['asia'],
  africa: ['africa'],
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function wordIn(text: string, phrase: string): boolean {
  if (!phrase) return false
  return new RegExp(`(^|[^\\p{L}])${escapeRe(phrase)}([^\\p{L}]|$)`, 'iu').test(text)
}

function namesFor(c: CountryRef): string[] {
  const base = [c.name, c.common_name].filter((n): n is string => !!n).map(n => n.toLowerCase())
  const extra = base.flatMap(n => COUNTRY_ALIASES[n] ?? [])
  return Array.from(new Set([...base, ...extra]))
}

/**
 * Parse a candidate's role query. `countries` is the countries table
 * (name, common_name, region) so geography stays data-driven.
 */
export function parseOpportunityQuery(
  query: string,
  viewer: Viewer,
  countries: CountryRef[],
): OpportunityCriteria {
  const q = query ?? ''
  const opportunityType: OpportunityType = viewer.role === 'coach' ? 'coach' : 'player'
  const positionPatterns = opportunityType === 'coach' ? COACH_POSITION_PATTERNS : PLAYER_POSITION_PATTERNS
  // Strip coach phrases before reading player positions so "goalkeeper coach"
  // is never read as a goalkeeper role, and vice-versa.
  const positionInput = opportunityType === 'player'
    ? q.replace(/\b(?:gk|goal ?keep(?:er|ing)) coach(?:es|ing)?\b/gi, ' ')
    : q
  const positions = positionPatterns.filter(([, re]) => re.test(positionInput)).map(([k]) => k)

  const benefits = BENEFIT_PATTERNS.filter(([, re]) => re.test(q)).map(([k]) => k)

  // Remove "women…" before testing "men…" — /men/ would otherwise hit
  // inside "women", and a query naming both keeps both.
  const genders: OpportunityGender[] = []
  const withoutWomen = q.replace(/\b(?:women'?s?|womens)\b/gi, ' ')
  for (const [g, re] of GENDER_PATTERNS) {
    const text = g[0] === 'Men' ? withoutWomen : q
    if (re.test(text)) genders.push(...g)
  }

  // Region named directly ("in Europe").
  let regionLabel: string | null = null
  for (const [region, aliases] of Object.entries(REGION_ALIASES)) {
    if (aliases.some(a => wordIn(q, a))) {
      const canonical = countries.find(c => (c.region ?? '').toLowerCase() === region)?.region
      regionLabel = canonical ?? region.replace(/\b\w/g, ch => ch.toUpperCase())
      break
    }
  }

  // Countries named directly ("in Spain"). Two-letter aliases ("us") are
  // only honoured in upper case so "roles for us" is not the USA.
  const countryNames: string[] = []
  let countryLabel: string | null = null
  for (const c of countries) {
    const names = namesFor(c)
    const hit = names.some(n => n.length <= 2 ? new RegExp(`\\b${n.toUpperCase()}\\b`).test(q) : wordIn(q, n))
    if (hit) {
      countryNames.push(...names)
      countryLabel = countryLabel ? `${countryLabel}, ${c.common_name || c.name}` : (c.common_name || c.name)
    }
  }

  return {
    opportunityType,
    positions,
    benefits,
    genders,
    countryNames: Array.from(new Set(countryNames)),
    countryLabel,
    regionLabel,
  }
}

// ── Eligibility + filtering ────────────────────────────────────────────────

/**
 * Mirrors check_application_eligibility: EU passport and (player roles only)
 * team gender. Unknown viewer data never blocks.
 */
export function viewerCanApply(row: OpportunityRow, viewer: Viewer): boolean {
  if (row.eu_passport_required === true && viewer.euEligible === false) return false
  if (row.opportunity_type === 'player' && row.gender && row.gender !== 'Mixed' && viewer.gender) {
    const forWomen = row.gender === 'Women' || row.gender === 'Girls'
    const forMen = row.gender === 'Men' || row.gender === 'Boys'
    if (forWomen && viewer.gender === 'men') return false
    if (forMen && viewer.gender === 'women') return false
  }
  return true
}

function deadlinePassed(deadline: string | null, today: string): boolean {
  if (!deadline) return false
  return deadline.slice(0, 10) < today
}

export type GeoMode = 'original' | 'region' | 'none'

export interface GeoFilter {
  /** Lower-cased country names/aliases that pass. Empty = no country filter. */
  countryNames: string[]
}

/** Country names (lower-cased, with aliases) for every country in `region`. */
export function regionCountryNames(region: string, countries: CountryRef[]): string[] {
  const r = region.toLowerCase()
  return Array.from(new Set(
    countries.filter(c => (c.region ?? '').toLowerCase() === r).flatMap(namesFor),
  ))
}

/**
 * Filter rows to the ones the viewer can apply to and that match the
 * criteria. Geography is passed separately so the caller can widen it.
 */
export function filterOpportunities(
  rows: OpportunityRow[],
  criteria: OpportunityCriteria,
  viewer: Viewer,
  geo: GeoFilter,
  today: string,
): OpportunityRow[] {
  const geoSet = new Set(geo.countryNames)
  return rows.filter(row => {
    if (row.opportunity_type !== criteria.opportunityType) return false
    if (deadlinePassed(row.application_deadline, today)) return false
    if (!viewerCanApply(row, viewer)) return false
    if (criteria.positions.length && !(row.position && criteria.positions.includes(row.position))) return false
    if (criteria.genders.length) {
      // Coach roles are often posted without a team category — keep those.
      const ok = row.gender
        ? criteria.genders.includes(row.gender) || row.gender === 'Mixed'
        : row.opportunity_type === 'coach'
      if (!ok) return false
    }
    if (criteria.benefits.length) {
      const have = new Set((row.benefits ?? []).map(b => b.toLowerCase()))
      if (!criteria.benefits.every(b => have.has(b))) return false
    }
    if (geoSet.size) {
      const country = (row.location_country ?? '').trim().toLowerCase()
      if (!country || !geoSet.has(country)) return false
    }
    return true
  })
}

/**
 * Order: the viewer's own position first (then their secondary position),
 * then newest by created_at — the founder ruling for "Newest" ordering.
 * No score is computed or exposed.
 */
export function orderOpportunities(rows: OpportunityRow[], viewer: Viewer): OpportunityRow[] {
  const rank = (r: OpportunityRow) =>
    r.position && r.position === viewer.position ? 0
      : r.position && r.position === viewer.secondaryPosition ? 1
        : 2
  return [...rows].sort((a, b) => {
    const d = rank(a) - rank(b)
    if (d !== 0) return d
    return (b.created_at ?? '').localeCompare(a.created_at ?? '')
  })
}

// ── Presentation ───────────────────────────────────────────────────────────

const BENEFIT_LABELS: Record<string, string> = {
  housing: 'Housing', flights: 'Flights', visa: 'Visa', car: 'Car', job: 'Job',
  insurance: 'Insurance', bonuses: 'Bonuses', equipment: 'Equipment', meals: 'Meals',
  education: 'Education',
}

const CATEGORY_LABELS: Record<OpportunityGender, string> = {
  Men: "Men's team", Women: "Women's team", Girls: 'Girls', Boys: 'Boys', Mixed: 'Mixed',
}

function clean(s: string | null | undefined, max = 80): string | null {
  if (!s) return null
  const t = s.replace(/\s+/g, ' ').trim().slice(0, max)
  return t || null
}

export function toOpportunityResult(row: OpportunityRow): OpportunityResult {
  const location = [clean(row.location_city, 40), clean(row.location_country, 40)].filter(Boolean).join(', ')
  return {
    id: row.id,
    title: clean(row.title, 120) ?? (row.position ? `${labelFor(row.position)} role` : 'Open role'),
    position_label: row.position ? labelFor(row.position) : null,
    category_label: row.gender ? CATEGORY_LABELS[row.gender] ?? null : null,
    location_label: location || null,
    organization: clean(row.world_club_name) ?? clean(row.organization_name) ?? clean(row.club_name),
    logo_url: row.world_club_avatar_url ?? row.club_logo_url ?? null,
    benefit_labels: (row.benefits ?? [])
      .map(b => BENEFIT_LABELS[b.toLowerCase()] ?? null)
      .filter((b): b is string => !!b)
      .slice(0, 4),
    deadline: row.application_deadline ?? null,
    navigate_to: `/opportunities/${row.id}`,
  }
}

/** "midfielder roles", "head coach roles", "open roles" — plural noun phrase. */
export function describeRoleNoun(criteria: OpportunityCriteria): { plural: string; singular: string } {
  const pos = criteria.positions.map(p => labelForInline(p))
  const head = pos.length === 0 ? 'open'
    : pos.length === 1 ? pos[0]
      : `${pos.slice(0, -1).join(', ')} or ${pos[pos.length - 1]}`
  const cat = criteria.genders.length === 1 && criteria.genders[0] !== 'Mixed'
    ? `${labelForInline(criteria.genders[0] === 'Men' ? 'adult_men' : criteria.genders[0] === 'Women' ? 'adult_women' : criteria.genders[0].toLowerCase())} `
    : ''
  return { plural: `${cat}${head} roles`, singular: `${cat}${head} role` }
}

function benefitsPhrase(criteria: OpportunityCriteria): string {
  if (!criteria.benefits.length) return ''
  const labels = criteria.benefits.map(b => (BENEFIT_LABELS[b] ?? b).toLowerCase())
  const joined = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
  return ` with ${joined}`
}

/** Headline for a successful role search. Gender-neutral, count-of-roles only. */
export function buildOpportunityMessage(count: number, criteria: OpportunityCriteria, geoLabel: string | null): string {
  const noun = describeRoleNoun(criteria)
  const n = count === 1 ? noun.singular : noun.plural
  const where = geoLabel ? ` in ${geoLabel}` : ''
  return `I found ${count} ${n}${where}${benefitsPhrase(criteria)} you can apply to.`
}

/** Copy when nothing matched even after widening geography. */
export function buildNoOpportunitiesMessage(criteria: OpportunityCriteria, geoLabel: string | null): string {
  const noun = describeRoleNoun(criteria)
  const where = geoLabel ? ` in ${geoLabel}` : ''
  const hasNarrowing = criteria.positions.length > 0 || criteria.benefits.length > 0 || criteria.genders.length > 0
  return hasNarrowing
    ? `There are no ${noun.plural}${where}${benefitsPhrase(criteria)} you can apply to right now. New roles are posted all the time — you can widen the search or browse every open role.`
    : `There are no open roles${where} you can apply to right now. New roles are posted all the time — keep your profile up to date so clubs can find you too.`
}

// ── Orchestration (pure) ───────────────────────────────────────────────────

export type LandedStep = 'original' | 'region' | 'worldwide'

export interface OpportunitySearchOutcome {
  criteria: OpportunityCriteria
  /** Every match on the rung we landed on, ordered for display. */
  matched: OpportunityRow[]
  landed: LandedStep
  /** The geography the user asked for ("Spain", "Europe"), or null. */
  askedLabel: string | null
  /** The region we widened into, when landed === 'region'. */
  widenedRegion: string | null
}

/**
 * Parse → filter → widen empty geography (country → its region →
 * worldwide; a region asked directly → worldwide). Only geography is ever
 * widened — position, category and package filters are kept, so the answer
 * never drifts from what was asked.
 */
export function runOpportunitySearch(
  query: string,
  rows: OpportunityRow[],
  countries: CountryRef[],
  viewer: Viewer,
  today: string,
): OpportunitySearchOutcome {
  const criteria = parseOpportunityQuery(query, viewer, countries)
  // "for my position" → the viewer's own position(s).
  if (!criteria.positions.length && /\bmy (?:position|role)s?\b/i.test(query) && viewer.position) {
    criteria.positions = [viewer.position, viewer.secondaryPosition].filter((p): p is string => !!p)
  }

  const rungs: Array<{ step: LandedStep; names: string[]; region: string | null }> = []
  let askedLabel: string | null = null
  if (criteria.countryNames.length) {
    askedLabel = criteria.countryLabel
    rungs.push({ step: 'original', names: criteria.countryNames, region: null })
    const region = countries.find(c =>
      [c.name, c.common_name].some(n => n && criteria.countryNames.includes(n.toLowerCase())),
    )?.region ?? null
    if (region) rungs.push({ step: 'region', names: regionCountryNames(region, countries), region })
    rungs.push({ step: 'worldwide', names: [], region: null })
  } else if (criteria.regionLabel) {
    askedLabel = criteria.regionLabel
    rungs.push({ step: 'original', names: regionCountryNames(criteria.regionLabel, countries), region: null })
    rungs.push({ step: 'worldwide', names: [], region: null })
  } else {
    rungs.push({ step: 'original', names: [], region: null })
  }

  let matched: OpportunityRow[] = []
  let landed = rungs[0]
  for (const rung of rungs) {
    matched = filterOpportunities(rows, criteria, viewer, { countryNames: rung.names }, today)
    landed = rung
    if (matched.length > 0) break
  }
  if (matched.length === 0) landed = rungs[0]

  return {
    criteria,
    matched: orderOpportunities(matched, viewer),
    landed: landed.step,
    askedLabel,
    widenedRegion: landed.step === 'region' ? landed.region : null,
  }
}
