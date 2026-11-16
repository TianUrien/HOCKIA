import type { Vacancy, Profile } from './supabase'
import { isEuCountryCode, type Country } from '@/hooks/useCountries'
import { computeInterest } from './interestFit'
import { specialistSkillLabel } from './specialistSkills'
import { tOpportunities } from '@/i18n/ns/opportunities'
import { intlLocale } from '@/i18n/format'

/**
 * Whether a user may submit an application to an opportunity, and — when
 * they can't — a short, non-judgmental reason to show them.
 *
 * Two rules, mirrored by the `check_application_eligibility` DB trigger:
 *  A. EU passport — opportunities flagged `eu_passport_required` are open
 *     only to users whose nationality is an EU member state.
 *  B. Gender / team category — a women's (Women/Girls) player opportunity
 *     is closed to men, a men's (Men/Boys) one to women. Mixed is open to
 *     all. Coach opportunities are never gender-gated (a coach's own
 *     gender doesn't restrict which team they can coach).
 *
 * Missing profile data never blocks: if we can't verify a rule because
 * the user hasn't filled in their nationality or gender, we allow the
 * application and nudge them to complete their profile instead.
 */
export interface EligibilityResult {
  /** Whether the user is allowed to submit an application. */
  eligible: boolean
  /** Why the user is blocked — present only when `eligible` is false. */
  reason?: string
  /** The rule behind `reason`, for code that must tell the rules apart
   *  (the words change with the interface language). */
  code?: 'eu_passport' | 'womens_team' | 'mens_team'
  /** Set when eligibility could not be fully verified because the user's
   *  profile is incomplete. The user is still allowed to apply; the UI
   *  uses this to nudge them to fill the missing fields in. */
  incompleteProfile?: string
}

function normalizeGender(raw: string | null | undefined): 'men' | 'women' | null {
  const g = (raw || '').trim().toLowerCase()
  if (g === 'men' || g === 'man' || g === 'male') return 'men'
  if (g === 'women' || g === 'woman' || g === 'female') return 'women'
  return null
}

export function checkOpportunityEligibility(
  vacancy: Vacancy,
  profile: Profile | null | undefined,
  countries: Country[],
): EligibilityResult {
  // No profile (signed-out preview) — the read-only path stays open; the
  // server trigger and the sign-in gate enforce eligibility on submit.
  if (!profile) return { eligible: true }

  let missingNationality = false
  let missingGender = false

  // ── Rule A — EU passport ──
  if (vacancy.eu_passport_required === true) {
    const nationalityIds = [profile.nationality_country_id, profile.nationality2_country_id]
      .filter((id): id is number => typeof id === 'number')
    const codes = nationalityIds
      .map((id) => countries.find((c) => c.id === id)?.code)
      .filter((c): c is string => Boolean(c))

    if (codes.length === 0) {
      missingNationality = true
    } else if (!codes.some(isEuCountryCode)) {
      return { eligible: false, code: 'eu_passport', reason: tOpportunities('eligibility.euPassport') }
    }
  }

  // ── Rule B — gender / team category (player opportunities only) ──
  if (vacancy.opportunity_type === 'player' && vacancy.gender && vacancy.gender !== 'Mixed') {
    const requiresWomen = vacancy.gender === 'Women' || vacancy.gender === 'Girls'
    const requiresMen = vacancy.gender === 'Men' || vacancy.gender === 'Boys'
    const userGender = normalizeGender(profile.gender)

    if (!userGender) {
      missingGender = true
    } else if (requiresWomen && userGender === 'men') {
      return { eligible: false, code: 'womens_team', reason: tOpportunities('eligibility.womensTeams') }
    } else if (requiresMen && userGender === 'women') {
      return { eligible: false, code: 'mens_team', reason: tOpportunities('eligibility.mensTeams') }
    }
  }

  if (missingNationality || missingGender) {
    return {
      eligible: true,
      incompleteProfile: missingNationality && missingGender
        ? tOpportunities('eligibility.addNationalityAndGender')
        : missingNationality ? tOpportunities('eligibility.addNationality') : tOpportunities('eligibility.addGender'),
    }
  }

  return { eligible: true }
}

/** "This opening is unpaid / development, but your profile says you're looking for paid." */
function compensationWarning(compensation: string | null | undefined): string {
  switch (compensation) {
    case 'paid': return tOpportunities('mustHave.compensation.paid')
    case 'unpaid_development': return tOpportunities('mustHave.compensation.unpaidDevelopment')
    case 'either': return tOpportunities('mustHave.compensation.either')
    default: return compensation
      ? tOpportunities('mustHave.compensation.other', { compensation: compensation.toLowerCase() })
      : tOpportunities('mustHave.compensation.notStated')
  }
}

/** Title-case an opportunity_position value for candidate-facing copy. */
function positionLabel(position: string): string {
  return position
    .trim()
    .split(/[\s_-]+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ')
}

/**
 * Phase 3f — candidate-facing MUST-HAVE advisory. Returns the criteria the
 * applying candidate EXPLICITLY fails on this opportunity, in candidate
 * voice. This is a WARNING ONLY — the candidate can still apply (the recruiter
 * verdict would read them "Out of scope", so we set expectations rather than
 * block). A BLANK candidate field never warns (honest-absence), inherited from
 * the lens predicates. Player opportunities only (must-haves are player-opps).
 *
 * Reuses computeInterest per-dimension (compensation / location / availability)
 * so the predicate stays a single source of truth with the recruiter verdict
 * and nl-search; position + specialists are simple inline checks. LEVEL is
 * intentionally NOT warned here — it needs proven-band (club→league)
 * resolution and is the least candidate-intuitive dimension; the verdict +
 * search still enforce it.
 *
 * Keep the predicates in sync with clubFit.ts / interestFit.ts must-have logic.
 */
export function opportunityMustHaveWarnings(
  vacancy: Vacancy,
  profile: Profile | null | undefined,
  countryName: (id: number) => string | undefined,
): string[] {
  if (!profile || vacancy.opportunity_type !== 'player') return []
  const warnings: string[] = []

  // ── Interest-lens dims (compensation / location / availability) ──
  // Isolate each by setting ONLY its *Required flag, so computeInterest.hardFail
  // reports exactly which dimension fails (reusing the exact predicate, incl.
  // the comp clash, mobility exclusion/home-only, and availability checks).
  const interestCandidate = {
    role: 'player' as const,
    relocation_willingness: profile.relocation_willingness ?? null,
    relocation_countries_open: profile.relocation_countries_open ?? null,
    relocation_countries_excluded: profile.relocation_countries_excluded ?? null,
    available_from: profile.available_from ?? null,
    home_country_id: profile.base_country_id ?? profile.nationality_country_id ?? null,
    proven_level_band: null, // level is not warned here (needs band resolution)
    level_target: null,
    opportunity_preference: profile.opportunity_preference ?? null,
  }
  const baseOpts = {
    targetRole: 'player' as const,
    targetLocationCountry: vacancy.location_country ?? null,
    targetStartDate: vacancy.start_date ?? null,
    targetLevel: null,
    targetCompensation: vacancy.compensation ?? null,
    countryName,
  }
  const fmtDate = (iso: string) => {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(intlLocale(), { month: 'short', year: 'numeric' })
  }

  if (vacancy.compensation_required && computeInterest(interestCandidate, { ...baseOpts, compensationRequired: true }).hardFail) {
    warnings.push(compensationWarning(vacancy.compensation))
  }
  if (vacancy.location_required && computeInterest(interestCandidate, { ...baseOpts, locationRequired: true }).hardFail) {
    warnings.push(tOpportunities('mustHave.location', { country: vacancy.location_country }))
  }
  if (vacancy.availability_required && computeInterest(interestCandidate, { ...baseOpts, availabilityRequired: true }).hardFail) {
    warnings.push(vacancy.start_date
      ? tOpportunities('mustHave.startsIn', { date: fmtDate(vacancy.start_date) })
      : tOpportunities('mustHave.startsBefore'))
  }

  // ── Fit-lens dims (position / specialists) — simple inline checks ──
  if (vacancy.position_required && vacancy.position && profile.position) {
    const target = vacancy.position.trim().toLowerCase()
    const primary = profile.position.trim().toLowerCase()
    const secondary = (profile.secondary_position ?? '').trim().toLowerCase()
    if (primary !== target && secondary !== target) {
      warnings.push(tOpportunities('mustHave.position', { wanted: positionLabel(vacancy.position), own: positionLabel(profile.position) }))
    }
  }
  // .filter(Boolean) mirrors clubFit.ts so an empty-string entry can't yield a
  // "wants , which…" warning (keeps this predicate in sync with the lens).
  const soughtSpecialists = (vacancy.specialist_skills_wanted ?? []).filter(Boolean)
  const heldSpecialists = (profile.specialist_skills ?? []).filter(Boolean)
  if (vacancy.specialists_required && soughtSpecialists.length > 0 && heldSpecialists.length > 0) {
    const held = new Set(heldSpecialists.map((s) => s.toLowerCase()))
    if (!soughtSpecialists.some((s) => held.has(s.toLowerCase()))) {
      warnings.push(tOpportunities('mustHave.specialists', { skills: soughtSpecialists.map(specialistSkillLabel).join(', ') }))
    }
  }

  return warnings
}
