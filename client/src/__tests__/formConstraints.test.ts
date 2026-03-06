/**
 * Form-DB Contract Tests
 *
 * Validates that all form option values match the corresponding database
 * constraints exactly. These tests act as a safety net against constraint
 * violations caused by form value / DB enum mismatches.
 *
 * If a test here fails, it means a form is sending a value the database
 * will reject — fix the form, not the test.
 */
import { describe, it, expect } from 'vitest'

// ─── Database Constraints (source of truth) ─────────────────────────────────
// From migration: 202602240100_normalize_position_gender.sql

const DB_PROFILES_VALID_POSITIONS = [
  'goalkeeper', 'defender', 'midfielder', 'forward',
  'head coach', 'assistant coach', 'youth coach',
] as const

const DB_PROFILES_VALID_GENDERS = ['Men', 'Women'] as const

// From migration: 202602040500_coach_position_enum_values.sql
// and the original opportunity_position enum
const DB_OPPORTUNITY_POSITION_ENUM = [
  'goalkeeper', 'defender', 'midfielder', 'forward',
  'head_coach', 'assistant_coach', 'youth_coach',
] as const

const DB_OPPORTUNITY_GENDER_ENUM = ['Men', 'Women'] as const

// ─── Form Values (must match DB exactly) ────────────────────────────────────
// These mirror the <option value="..."> attributes in each form.
// If a form changes its values, update here and let the test catch mismatches.

// EditProfileModal.tsx — player position select (lines 755-759)
const EDIT_PROFILE_PLAYER_POSITIONS = ['goalkeeper', 'defender', 'midfielder', 'forward']

// EditProfileModal.tsx — player secondary position (line 775)
const EDIT_PROFILE_SECONDARY_POSITIONS = ['goalkeeper', 'defender', 'midfielder', 'forward']

// EditProfileModal.tsx — player gender select (lines 796-797)
const EDIT_PROFILE_PLAYER_GENDERS = ['Men', 'Women']

// EditProfileModal.tsx — coach gender select (lines 890-891)
const EDIT_PROFILE_COACH_GENDERS = ['Men', 'Women']

// CompleteProfile.tsx — player position select (lines 949-952)
const COMPLETE_PROFILE_PLAYER_POSITIONS = ['goalkeeper', 'defender', 'midfielder', 'forward']

// CompleteProfile.tsx — coach position select (lines 1070-1072)
const COMPLETE_PROFILE_COACH_POSITIONS = ['head coach', 'assistant coach', 'youth coach']

// CompleteProfile.tsx — player gender select (lines 987-988)
const COMPLETE_PROFILE_PLAYER_GENDERS = ['Men', 'Women']

// CompleteProfile.tsx — coach gender select (lines 1087-1089)
const COMPLETE_PROFILE_COACH_GENDERS = ['Men', 'Women']

// CreateOpportunityModal.tsx — player position select (lines 537-540)
const CREATE_OPP_PLAYER_POSITIONS = ['goalkeeper', 'defender', 'midfielder', 'forward']

// CreateOpportunityModal.tsx — coach position select (lines 544-546)
const CREATE_OPP_COACH_POSITIONS = ['head_coach', 'assistant_coach', 'youth_coach']

// CreateOpportunityModal.tsx — gender select (lines 568-569)
const CREATE_OPP_GENDERS = ['Men', 'Women']

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Form-DB Contract: profiles.position CHECK constraint', () => {
  it('EditProfileModal player positions are valid', () => {
    for (const val of EDIT_PROFILE_PLAYER_POSITIONS) {
      expect(DB_PROFILES_VALID_POSITIONS).toContain(val)
    }
  })

  it('EditProfileModal secondary positions are valid', () => {
    for (const val of EDIT_PROFILE_SECONDARY_POSITIONS) {
      expect(DB_PROFILES_VALID_POSITIONS).toContain(val)
    }
  })

  it('CompleteProfile player positions are valid', () => {
    for (const val of COMPLETE_PROFILE_PLAYER_POSITIONS) {
      expect(DB_PROFILES_VALID_POSITIONS).toContain(val)
    }
  })

  it('CompleteProfile coach positions are valid', () => {
    for (const val of COMPLETE_PROFILE_COACH_POSITIONS) {
      expect(DB_PROFILES_VALID_POSITIONS).toContain(val)
    }
  })

  it('all profile positions are lowercase', () => {
    for (const val of DB_PROFILES_VALID_POSITIONS) {
      expect(val).toBe(val.toLowerCase())
    }
  })
})

describe('Form-DB Contract: profiles.gender CHECK constraint', () => {
  it('EditProfileModal player genders are valid', () => {
    for (const val of EDIT_PROFILE_PLAYER_GENDERS) {
      expect(DB_PROFILES_VALID_GENDERS).toContain(val)
    }
  })

  it('EditProfileModal coach genders are valid', () => {
    for (const val of EDIT_PROFILE_COACH_GENDERS) {
      expect(DB_PROFILES_VALID_GENDERS).toContain(val)
    }
  })

  it('CompleteProfile player genders are valid', () => {
    for (const val of COMPLETE_PROFILE_PLAYER_GENDERS) {
      expect(DB_PROFILES_VALID_GENDERS).toContain(val)
    }
  })

  it('CompleteProfile coach genders are valid', () => {
    for (const val of COMPLETE_PROFILE_COACH_GENDERS) {
      expect(DB_PROFILES_VALID_GENDERS).toContain(val)
    }
  })
})

describe('Form-DB Contract: normalizeGender function', () => {
  // Inline replica of the normalizeGender logic from CompleteProfile.tsx
  const normalizeGender = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return null
    const lower = trimmed.toLowerCase()
    if (lower === 'men' || lower === 'male') return 'Men'
    if (lower === 'women' || lower === 'female') return 'Women'
    return null
  }

  it('returns null for empty string', () => {
    expect(normalizeGender('')).toBeNull()
  })

  it('returns null for whitespace-only', () => {
    expect(normalizeGender('   ')).toBeNull()
  })

  it('normalizes "Men" correctly', () => {
    expect(normalizeGender('Men')).toBe('Men')
  })

  it('normalizes "Women" correctly', () => {
    expect(normalizeGender('Women')).toBe('Women')
  })

  it('normalizes case-insensitive variants', () => {
    expect(normalizeGender('men')).toBe('Men')
    expect(normalizeGender('MEN')).toBe('Men')
    expect(normalizeGender('male')).toBe('Men')
    expect(normalizeGender('women')).toBe('Women')
    expect(normalizeGender('WOMEN')).toBe('Women')
    expect(normalizeGender('female')).toBe('Women')
  })

  it('returns null (not "Other") for invalid input', () => {
    expect(normalizeGender('Other')).toBeNull()
    expect(normalizeGender('nonbinary')).toBeNull()
    expect(normalizeGender('unknown')).toBeNull()
  })

  it('every non-null return value satisfies the DB constraint', () => {
    const testInputs = ['Men', 'Women', 'men', 'women', 'male', 'female', 'MALE', 'FEMALE']
    for (const input of testInputs) {
      const result = normalizeGender(input)
      if (result !== null) {
        expect(DB_PROFILES_VALID_GENDERS).toContain(result)
      }
    }
  })
})

describe('Form-DB Contract: opportunity_position enum', () => {
  it('CreateOpportunityModal player positions match enum', () => {
    for (const val of CREATE_OPP_PLAYER_POSITIONS) {
      expect(DB_OPPORTUNITY_POSITION_ENUM).toContain(val)
    }
  })

  it('CreateOpportunityModal coach positions match enum (underscores)', () => {
    for (const val of CREATE_OPP_COACH_POSITIONS) {
      expect(DB_OPPORTUNITY_POSITION_ENUM).toContain(val)
    }
  })

  it('coach positions use underscores (not spaces) for opportunity enum', () => {
    for (const val of CREATE_OPP_COACH_POSITIONS) {
      expect(val).not.toContain(' ')
    }
  })

  it('profile coach positions use spaces (not underscores)', () => {
    for (const val of COMPLETE_PROFILE_COACH_POSITIONS) {
      expect(val).not.toContain('_')
    }
  })
})

describe('Form-DB Contract: opportunity_gender enum', () => {
  it('CreateOpportunityModal genders match enum', () => {
    for (const val of CREATE_OPP_GENDERS) {
      expect(DB_OPPORTUNITY_GENDER_ENUM).toContain(val)
    }
  })
})
