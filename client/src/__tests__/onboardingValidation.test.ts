import {
  validateOnboardingStep,
  type OnboardingFormSubset,
  type OnboardingRole,
} from '@/lib/onboardingValidation'

// A "fully valid" form fixture for each role. Individual tests strip
// fields to confirm each validation gate flips. Phase 3: gender is gone,
// hockey categories take its place.
const validPlayer: OnboardingFormSubset = {
  fullName: 'Alex Player',
  nationalityCountryId: 202,
  city: 'Amsterdam',
  dateOfBirth: '2000-01-01',
  position: 'midfielder',
  secondaryPosition: 'defender',
  playingCategory: 'adult_men',
}

const validCoach: OnboardingFormSubset = {
  fullName: 'Casey Coach',
  nationalityCountryId: 5,
  city: 'Brussels',
  dateOfBirth: '2000-01-01',
  coachSpecialization: 'head_coach',
  coachSpecializationCustom: '',
  coachingCategories: ['adult_women'],
}

const validUmpire: OnboardingFormSubset = {
  fullName: 'Umi Umpire',
  nationalityCountryId: 11,
  city: 'London',
  dateOfBirth: '2000-01-01',
  umpireLevel: 'FIH International',
  federation: 'FIH',
  officiatingSpecialization: 'outdoor',
  languages: ['English', 'Spanish'],
  // umpiringCategories deliberately omitted — optional in Phase 3.
}

describe('validateOnboardingStep', () => {
  describe('step 1 — identity', () => {
    it.each<OnboardingRole>(['player', 'coach'])(
      'returns null when fullName + nationality are present (%s)',
      (role) => {
        const form = role === 'player' ? validPlayer : validCoach
        expect(validateOnboardingStep(1, role, form)).toBeNull()
      }
    )

    it('returns an error when fullName is missing', () => {
      expect(
        validateOnboardingStep(1, 'player', { ...validPlayer, fullName: '' })
      ).toMatch(/full name is required/i)
    })

    it('treats whitespace-only fullName as missing', () => {
      expect(
        validateOnboardingStep(1, 'player', { ...validPlayer, fullName: '   ' })
      ).toMatch(/full name is required/i)
    })

    it('returns an error when nationalityCountryId is missing', () => {
      expect(
        validateOnboardingStep(1, 'coach', {
          ...validCoach,
          nationalityCountryId: null,
        })
      ).toMatch(/nationality is required/i)
    })
  })

  describe('step 2 — where you are based', () => {
    it.each<OnboardingRole>(['player', 'coach', 'umpire'])(
      'returns null when city is present (%s)',
      (role) => {
        const form =
          role === 'player' ? validPlayer : role === 'coach' ? validCoach : validUmpire
        expect(validateOnboardingStep(2, role, form)).toBeNull()
      }
    )

    it('returns an error when city is missing', () => {
      expect(
        validateOnboardingStep(2, 'player', { ...validPlayer, city: '' })
      ).toMatch(/base location is required/i)
    })

    it('treats whitespace-only city as missing', () => {
      expect(
        validateOnboardingStep(2, 'coach', { ...validCoach, city: '   ' })
      ).toMatch(/base location is required/i)
    })

    // DOB is collected on step 2 for every person role and must gate advancing
    // here — otherwise the requirement only surfaces at final submit on step 3
    // (which stranded OAuth signups, who collect no DOB at sign-up).
    it.each<OnboardingRole>(['player', 'coach', 'umpire'])(
      'returns an error when dateOfBirth is missing (%s)',
      (role) => {
        const form =
          role === 'player' ? validPlayer : role === 'coach' ? validCoach : validUmpire
        expect(
          validateOnboardingStep(2, role, { ...form, dateOfBirth: '' })
        ).toMatch(/date of birth is required/i)
      }
    )

    // Phase 3: gender is no longer collected at step 2 for any role. The
    // hockey-category replacement lives in step 3 (per role).
  })

  describe('step 3 — player role', () => {
    it('returns null when position + playing_category are filled', () => {
      expect(validateOnboardingStep(3, 'player', validPlayer)).toBeNull()
    })

    it('returns null when secondary is not set', () => {
      expect(
        validateOnboardingStep(3, 'player', {
          ...validPlayer,
          secondaryPosition: '',
        })
      ).toBeNull()
    })

    it('returns an error when position is missing', () => {
      expect(
        validateOnboardingStep(3, 'player', { ...validPlayer, position: '' })
      ).toMatch(/position is required/i)
    })

    it('returns an error when playing_category is missing', () => {
      expect(
        validateOnboardingStep(3, 'player', { ...validPlayer, playingCategory: '' })
      ).toMatch(/playing category/i)
    })

    it('returns an error when primary and secondary positions match', () => {
      expect(
        validateOnboardingStep(3, 'player', {
          ...validPlayer,
          secondaryPosition: validPlayer.position,
        })
      ).toMatch(/must be different/i)
    })
  })

  describe('step 3 — coach role', () => {
    it('returns null when categories + specialization are selected', () => {
      expect(validateOnboardingStep(3, 'coach', validCoach)).toBeNull()
    })

    it("accepts the [any] sentinel for coaching_categories", () => {
      expect(
        validateOnboardingStep(3, 'coach', {
          ...validCoach,
          coachingCategories: ['any'],
        })
      ).toBeNull()
    })

    it('returns an error when coaching_categories is empty', () => {
      expect(
        validateOnboardingStep(3, 'coach', {
          ...validCoach,
          coachingCategories: [],
        })
      ).toMatch(/at least one coaching category/i)
    })

    it('returns an error when no specialization is selected', () => {
      expect(
        validateOnboardingStep(3, 'coach', {
          ...validCoach,
          coachSpecialization: '',
        })
      ).toMatch(/please select your coaching specialization/i)
    })

    it('requires a custom title when specialization is "other"', () => {
      expect(
        validateOnboardingStep(3, 'coach', {
          ...validCoach,
          coachSpecialization: 'other',
          coachSpecializationCustom: '',
        })
      ).toMatch(/please enter your role title/i)
    })

    it('accepts a non-empty custom title when specialization is "other"', () => {
      expect(
        validateOnboardingStep(3, 'coach', {
          ...validCoach,
          coachSpecialization: 'other',
          coachSpecializationCustom: 'Umpire Coach',
        })
      ).toBeNull()
    })
  })

  describe('step 1 — umpire', () => {
    it('returns null when fullName + nationality are present', () => {
      expect(validateOnboardingStep(1, 'umpire', validUmpire)).toBeNull()
    })

    it('returns an error when fullName is missing (umpire)', () => {
      expect(
        validateOnboardingStep(1, 'umpire', { ...validUmpire, fullName: '' })
      ).toMatch(/full name is required/i)
    })

    it('returns an error when nationality is missing (umpire)', () => {
      expect(
        validateOnboardingStep(1, 'umpire', { ...validUmpire, nationalityCountryId: null })
      ).toMatch(/nationality is required/i)
    })
  })

  describe('step 3 — umpire', () => {
    it('returns null for a complete umpire credentials step', () => {
      expect(validateOnboardingStep(3, 'umpire', validUmpire)).toBeNull()
    })

    it('does NOT require umpiring_categories (optional in Phase 3)', () => {
      // Even when the array is undefined or empty, advancement is allowed.
      expect(
        validateOnboardingStep(3, 'umpire', { ...validUmpire, umpiringCategories: undefined })
      ).toBeNull()
      expect(
        validateOnboardingStep(3, 'umpire', { ...validUmpire, umpiringCategories: [] })
      ).toBeNull()
    })

    it('accepts valid umpiring_categories when set', () => {
      expect(
        validateOnboardingStep(3, 'umpire', {
          ...validUmpire,
          umpiringCategories: ['adult_women', 'girls'],
        })
      ).toBeNull()
    })

    it('rejects invalid umpiring_categories combinations', () => {
      // 'any' must be exclusive — not allowed alongside specific categories.
      expect(
        validateOnboardingStep(3, 'umpire', {
          ...validUmpire,
          umpiringCategories: ['any', 'adult_women'],
        })
      ).toMatch(/invalid/i)
    })

    it('requires umpire level', () => {
      expect(
        validateOnboardingStep(3, 'umpire', { ...validUmpire, umpireLevel: '' })
      ).toMatch(/umpire level/i)
    })

    it('treats a whitespace-only umpire level as missing', () => {
      expect(
        validateOnboardingStep(3, 'umpire', { ...validUmpire, umpireLevel: '   ' })
      ).toMatch(/umpire level/i)
    })

    it('requires federation', () => {
      expect(
        validateOnboardingStep(3, 'umpire', { ...validUmpire, federation: '' })
      ).toMatch(/federation/i)
    })

    it('requires specialization (outdoor / indoor / both)', () => {
      expect(
        validateOnboardingStep(3, 'umpire', { ...validUmpire, officiatingSpecialization: '' })
      ).toMatch(/outdoor, indoor, or both/i)
    })

    it('requires at least one language', () => {
      expect(
        validateOnboardingStep(3, 'umpire', { ...validUmpire, languages: [] })
      ).toMatch(/language/i)
    })

    it('treats missing languages as missing (undefined)', () => {
      expect(
        validateOnboardingStep(3, 'umpire', { ...validUmpire, languages: undefined })
      ).toMatch(/language/i)
    })

    it('accepts a single language as the minimum bar', () => {
      expect(
        validateOnboardingStep(3, 'umpire', { ...validUmpire, languages: ['English'] })
      ).toBeNull()
    })
  })
})
