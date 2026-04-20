/**
 * onboardingValidation.ts
 *
 * Pure, unit-testable per-step validation for the staged CompleteProfile
 * wizard (player + coach roles). Kept separate from the component so the
 * gating rules can be exercised without mounting the full 1,300-line
 * onboarding page and mocking its auth / supabase / location-autocomplete
 * dependencies.
 *
 * Step 1 (identity):  full name + nationality
 * Step 2 (where):     base location + gender
 * Step 3 (role):      player → position (+ distinct secondary)
 *                     coach  → specialization (+ custom text when "other")
 */

export type WizardStep = 1 | 2 | 3

export type OnboardingRole = 'player' | 'coach'

export interface OnboardingFormSubset {
  fullName?: string
  nationalityCountryId?: number | null
  city?: string
  gender?: string
  position?: string
  secondaryPosition?: string
  coachSpecialization?: string
  coachSpecializationCustom?: string
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
    if (!formData.gender) return 'Gender is required.'
    return null
  }

  // step === 3: role-specific last-step gates
  if (role === 'player') {
    if (!formData.position) return 'Position is required.'
    if (
      formData.secondaryPosition &&
      formData.secondaryPosition === formData.position
    ) {
      return 'Primary and secondary positions must be different.'
    }
    return null
  }

  // role === 'coach'
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
