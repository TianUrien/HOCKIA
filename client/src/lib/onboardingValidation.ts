/**
 * onboardingValidation.ts
 *
 * Pure, unit-testable per-step validation for the staged CompleteProfile
 * wizard (player + coach + umpire roles). Kept separate from the component
 * so the gating rules can be exercised without mounting the full 1,300-line
 * onboarding page and mocking its auth / supabase / location-autocomplete
 * dependencies.
 *
 * Step 1 (identity):  full name + nationality
 * Step 2 (where):     base location
 * Step 3 (role):      player → position (+ distinct secondary) + playing_category
 *                     coach  → coaching_categories + specialization
 *                              (+ custom text when "other")
 *                     umpire → level + federation + specialization + ≥ 1 language
 *                              (umpiring_categories optional)
 */

import type { PlayingCategory, CoachUmpireCategory } from './hockeyCategories'
import { isValidCategoryArray, isValidPlayingCategory } from './hockeyCategories'

export type WizardStep = 1 | 2 | 3

export type OnboardingRole = 'player' | 'coach' | 'umpire'

export interface OnboardingFormSubset {
  fullName?: string
  nationalityCountryId?: number | null
  city?: string
  /** ISO date (YYYY-MM-DD). Collected on step 2 for all person roles;
   *  the 18+ age check itself is enforced server-side by declare_date_of_birth. */
  dateOfBirth?: string
  position?: string
  secondaryPosition?: string
  coachSpecialization?: string
  coachSpecializationCustom?: string
  /** Phase 3 hockey categories — replaces gender. */
  playingCategory?: PlayingCategory | ''
  coachingCategories?: CoachUmpireCategory[]
  umpiringCategories?: CoachUmpireCategory[]
  // Umpire-specific fields (v1 — free text for level + federation)
  umpireLevel?: string
  federation?: string
  officiatingSpecialization?: 'outdoor' | 'indoor' | 'both' | ''
  languages?: string[]
}

/**
 * Returns an error string when the user shouldn't be allowed to advance
 * (or submit) from the given step — or `null` when the step's required
 * fields are all filled correctly.
 */
export function validateOnboardingStep(
  step: WizardStep,
  role: OnboardingRole,
  formData: OnboardingFormSubset
): string | null {
  if (step === 1) {
    if (!formData.fullName?.trim()) return 'Full name is required.'
    if (!formData.nationalityCountryId) return 'Nationality is required.'
    return null
  }

  if (step === 2) {
    if (!formData.city?.trim()) return 'Base location is required.'
    // DOB lives on this step for every person role. Gate it here so the
    // requirement surfaces in place — previously it was only enforced at final
    // submit on step 3, stranding OAuth signups (which collect no DOB at
    // sign-up) on an error for a field two steps back. The 18+ check itself
    // remains server-authoritative (declare_date_of_birth).
    if (!formData.dateOfBirth) {
      return 'Date of birth is required — HOCKIA is an 18+ platform.'
    }
    return null
  }

  // step === 3: role-specific last-step gates
  if (role === 'player') {
    if (!formData.position) return 'Position is required.'
    if (!isValidPlayingCategory(formData.playingCategory)) {
      return 'Please select your playing category.'
    }
    if (
      formData.secondaryPosition &&
      formData.secondaryPosition === formData.position
    ) {
      return 'Primary and secondary positions must be different.'
    }
    return null
  }

  if (role === 'coach') {
    if (!formData.coachingCategories || formData.coachingCategories.length === 0) {
      return 'Please select at least one coaching category.'
    }
    if (!isValidCategoryArray(formData.coachingCategories)) {
      return 'Coaching categories are invalid.'
    }
    if (!formData.coachSpecialization) {
      return 'Please select your coaching specialization.'
    }
    if (
      formData.coachSpecialization === 'other' &&
      !formData.coachSpecializationCustom?.trim()
    ) {
      return 'Please enter your role title.'
    }
    return null
  }

  // role === 'umpire' — categories are optional but if present must be valid
  if (
    formData.umpiringCategories &&
    formData.umpiringCategories.length > 0 &&
    !isValidCategoryArray(formData.umpiringCategories)
  ) {
    return 'Umpiring categories are invalid.'
  }
  if (!formData.umpireLevel?.trim()) {
    return 'Please add your umpire level.'
  }
  if (!formData.federation?.trim()) {
    return 'Please add the federation you officiate with.'
  }
  if (!formData.officiatingSpecialization) {
    return 'Please choose outdoor, indoor, or both.'
  }
  // Languages are deliberately required — officiating across the hockey
  // ecosystem is bilingual by default, and leaving this blank produces
  // a much weaker profile. At least one language keeps the bar low.
  if (!formData.languages || formData.languages.length === 0) {
    return 'Please add at least one language you can officiate in.'
  }
  return null
}
