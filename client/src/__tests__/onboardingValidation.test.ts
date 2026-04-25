import {
  validateOnboardingStep,
  type OnboardingFormSubset,
  type OnboardingRole,
} from '@/lib/onboardingValidation'

// A "fully valid" form fixture for both roles. Individual tests strip
// fields to confirm each validation gate flips.
const validPlayer: OnboardingFormSubset = {
  fullName: 'Alex Player',
  nationalityCountryId: 202,
  city: 'Amsterdam',
  gender: 'Men',
  position: 'midfielder',
  secondaryPosition: 'defender',
}

const validCoach: OnboardingFormSubset = {
  fullName: 'Casey Coach',
  nationalityCountryId: 5,
  city: 'Brussels',
  gender: 'Women',
  coachSpecialization: 'head_coach',
  coachSpecializationCustom: '',
}

const validUmpire: OnboardingFormSubset = {
  fullName: 'Umi Umpire',
  nationalityCountryId: 11,
  city: 'London',
  gender: 'Women',
  umpireLevel: 'FIH International',
  federation: 'FIH',
  officiatingSpecialization: 'outdoor',
  languages: ['English', 'Spanish'],
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
    it.each<OnboardingRole>(['player', 'coach'])(
      'returns null when city + gender are present (%s)',
      (role) => {
        const form = role === 'player' ? validPlayer : validCoach
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

    it('returns an error when gender is empty', () => {
      expect(
        validateOnboardingStep(2, 'player', { ...validPlayer, gender: '' })
      ).toMatch(/gender is required/i)
    })
  })

  describe('step 3 — player role', () => {
    it('returns null when position is filled and secondary is different', () => {
      expect(validateOnboardingStep(3, 'player', validPlayer)).toBeNull()
    })

    it('returns null when position is filled and secondary is not set', () => {
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
    it('returns null when a specialization is selected', () => {
      expect(validateOnboardingStep(3, 'coach', validCoach)).toBeNull()
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

    it('treats whitespace-only custom title as missing for "other"', () => {
      expect(
        validateOnboardingStep(3, 'coach', {
          ...validCoach,
          coachSpecialization: 'other',
          coachSpecializationCustom: '   ',
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

  describe('step 2 — umpire', () => {
    it('returns null when city + gender are present', () => {
      expect(validateOnboardingStep(2, 'umpire', validUmpire)).toBeNull()
    })

    it('returns an error when gender is missing (umpire)', () => {
      expect(
        validateOnboardingStep(2, 'umpire', { ...validUmpire, gender: '' })
      ).toMatch(/gender is required/i)
    })
  })

  describe('step 3 — umpire', () => {
    it('returns null for a complete umpire credentials step', () => {
      expect(validateOnboardingStep(3, 'umpire', validUmpire)).toBeNull()
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
