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

import { tOnboarding } from '@/i18n/ns/onboarding'
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
  formData: OnboardingFormSubset,
  /** Defaults to the interface language; pass the English translator for analytics values. */
  t: typeof tOnboarding = tOnboarding,
): string | null {
  if (step === 1) {
    if (!formData.fullName?.trim()) return t('validation.fullName')
    if (!formData.nationalityCountryId) return t('validation.nationality')
    return null
  }

  if (step === 2) {
    if (!formData.city?.trim()) return t('validation.location')
    // DOB lives on this step for every person role. Gate it here so the
    // requirement surfaces in place — previously it was only enforced at final
    // submit on step 3, stranding OAuth signups (which collect no DOB at
    // sign-up) on an error for a field two steps back. The 18+ check itself
    // remains server-authoritative (declare_date_of_birth).
    if (!formData.dateOfBirth) {
      return t('validation.dateOfBirth')
    }
    return null
  }

  // step === 3: role-specific last-step gates
  if (role === 'player') {
    if (!formData.position) return t('validation.position')
    if (!isValidPlayingCategory(formData.playingCategory)) {
      return t('validation.playingCategory')
    }
    if (
      formData.secondaryPosition &&
      formData.secondaryPosition === formData.position
    ) {
      return t('validation.positionsDiffer')
    }
    return null
  }

  if (role === 'coach') {
    if (!formData.coachingCategories || formData.coachingCategories.length === 0) {
      return t('validation.coachCategories')
    }
    if (!isValidCategoryArray(formData.coachingCategories)) {
      return t('validation.coachCategoriesInvalid')
    }
    if (!formData.coachSpecialization) {
      return t('validation.coachSpecialization')
    }
    if (
      formData.coachSpecialization === 'other' &&
      !formData.coachSpecializationCustom?.trim()
    ) {
      return t('validation.coachRoleTitle')
    }
    return null
  }

  // role === 'umpire' — categories are optional but if present must be valid
  if (
    formData.umpiringCategories &&
    formData.umpiringCategories.length > 0 &&
    !isValidCategoryArray(formData.umpiringCategories)
  ) {
    return t('validation.umpireCategoriesInvalid')
  }
  if (!formData.umpireLevel?.trim()) {
    return t('validation.umpireLevel')
  }
  if (!formData.federation?.trim()) {
    return t('validation.federation')
  }
  if (!formData.officiatingSpecialization) {
    return t('validation.officiating')
  }
  // Languages are deliberately required — officiating across the hockey
  // ecosystem is bilingual by default, and leaving this blank produces
  // a much weaker profile. At least one language keeps the bar low.
  if (!formData.languages || formData.languages.length === 0) {
    return t('validation.languages')
  }
  return null
}
