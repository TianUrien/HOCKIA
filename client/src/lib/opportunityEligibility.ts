import type { Vacancy, Profile } from './supabase'
import { isEuCountryCode, type Country } from '@/hooks/useCountries'

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

  const missing: string[] = []

  // ── Rule A — EU passport ──
  if (vacancy.eu_passport_required === true) {
    const nationalityIds = [profile.nationality_country_id, profile.nationality2_country_id]
      .filter((id): id is number => typeof id === 'number')
    const codes = nationalityIds
      .map((id) => countries.find((c) => c.id === id)?.code)
      .filter((c): c is string => Boolean(c))

    if (codes.length === 0) {
      missing.push('your nationality')
    } else if (!codes.some(isEuCountryCode)) {
      return { eligible: false, reason: 'This opportunity requires an EU passport.' }
    }
  }

  // ── Rule B — gender / team category (player opportunities only) ──
  if (vacancy.opportunity_type === 'player' && vacancy.gender && vacancy.gender !== 'Mixed') {
    const requiresWomen = vacancy.gender === 'Women' || vacancy.gender === 'Girls'
    const requiresMen = vacancy.gender === 'Men' || vacancy.gender === 'Boys'
    const userGender = normalizeGender(profile.gender)

    if (!userGender) {
      missing.push('your gender')
    } else if (requiresWomen && userGender === 'men') {
      return { eligible: false, reason: "This opportunity is for women's teams." }
    } else if (requiresMen && userGender === 'women') {
      return { eligible: false, reason: "This opportunity is for men's teams." }
    }
  }

  if (missing.length > 0) {
    return {
      eligible: true,
      incompleteProfile: `Add ${missing.join(' and ')} to your profile so clubs can confirm you're a fit for this opportunity.`,
    }
  }

  return { eligible: true }
}
