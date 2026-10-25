/**
 * Draft autosave never writes personal details to localStorage (CodeQL
 * js/clear-text-storage-of-sensitive-data #32–#36, 2026-10-25): date of
 * birth is owner/server-only (age gate), nationality / passports stay out
 * too. A draft saved before the change no longer restores them either.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SENSITIVE_DRAFT_FIELDS, withoutRoleGender, withoutSensitiveDraftFields } from '@/lib/draftPrivacy'
import { parseCoachDraft, parseWizardDraft, serializeCoachDraft, serializeWizardDraft, type CoachSetupDraft } from '@/lib/onboardingV2'
import { loadProfileDraft, saveProfileDraft } from '@/lib/profileDrafts'

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }))

const DOB = '1994-03-07'
const now = Date.parse('2026-10-25T10:00:00Z')

/** True when the stored text holds a sensitive key or the DOB value. */
const leaks = (raw: string | null) =>
  raw === null ? false : raw.includes(DOB) || SENSITIVE_DRAFT_FIELDS.some((field) => raw.includes(`"${field}"`))

const coachDraft: CoachSetupDraft = {
  fullName: 'Sam Rivera', dateOfBirth: DOB, nationalityCountryId: 30, nationality2CountryId: 44, location: 'Amsterdam, Netherlands',
  baseCity: 'Amsterdam', baseCountryId: 30, locationSelected: true, specialization: 'head_coach', specializationCustom: '',
  categories: ['adult_women'], currentClub: 'HC Bloemendaal', currentWorldClubId: 'wc-1', recruitsForTeam: true, openToCoach: true,
}

beforeEach(() => localStorage.clear())

describe('withoutSensitiveDraftFields', () => {
  it('drops DOB, nationalities and passports and keeps everything else', () => {
    const out = withoutSensitiveDraftFields({
      fullName: 'Sam', position: 'midfielder', currentClub: 'HC', bio: 'Text',
      dateOfBirth: DOB, date_of_birth: DOB, nationality: 'Dutch', nationality_name: 'Dutch',
      nationalityCountryId: 30, nationality2CountryId: 44, nationality_country_id: 30, nationality2_country_id: 44,
      passport1: 30, passport2: 44, showSecondPassport: true,
    })
    expect(out).toEqual({ fullName: 'Sam', position: 'midfielder', currentClub: 'HC', bio: 'Text' })
  })

  it('drops the role category from an opportunity draft', () => {
    expect(withoutRoleGender({ title: 'First XI', position: 'forward', gender: 'Women' })).toEqual({ title: 'First XI', position: 'forward' })
  })
})

describe('coach set-up draft', () => {
  it('serialises without DOB or nationalities; name, club and coaching still restore', () => {
    const raw = serializeCoachDraft(coachDraft, now)
    expect(leaks(raw)).toBe(false)
    const restored = parseCoachDraft(raw, now)
    expect(restored).toMatchObject({ fullName: 'Sam Rivera', currentClub: 'HC Bloemendaal', categories: ['adult_women'], recruitsForTeam: true })
    expect(restored).not.toHaveProperty('dateOfBirth')
    expect(restored).not.toHaveProperty('nationalityCountryId')
  })

  it('ignores DOB and nationalities in a draft saved before the change (v2 and legacy wizard shapes)', () => {
    const v2 = JSON.stringify({ draft: coachDraft, savedAt: new Date(now).toISOString() })
    const legacy = JSON.stringify({
      step: 1, savedAt: new Date(now).toISOString(),
      formData: { fullName: 'Sam Rivera', dateOfBirth: DOB, nationalityCountryId: 30, nationality2CountryId: 44, currentClub: 'HC' },
    })
    for (const raw of [v2, legacy]) {
      const restored = parseCoachDraft(raw, now)
      expect(restored).toMatchObject({ fullName: 'Sam Rivera' })
      expect(restored).not.toHaveProperty('dateOfBirth')
      expect(restored).not.toHaveProperty('nationalityCountryId')
      expect(restored).not.toHaveProperty('nationality2CountryId')
    }
  })
})

describe('3-step wizard draft (CompleteProfile)', () => {
  it('serialises and restores the form without DOB or nationalities', () => {
    const formData = { fullName: 'Ana Ruiz', position: 'goalkeeper', nationality: 'Spanish', nationalityCountryId: 12, nationality2CountryId: null, dateOfBirth: DOB }
    const raw = serializeWizardDraft(2, formData, now)
    expect(leaks(raw)).toBe(false)
    expect(parseWizardDraft(raw, now)).toEqual({ step: 2, formData: { fullName: 'Ana Ruiz', position: 'goalkeeper' } })
    const old = JSON.stringify({ step: 2, formData, savedAt: new Date(now).toISOString() })
    expect(parseWizardDraft(old, now)?.formData).toEqual({ fullName: 'Ana Ruiz', position: 'goalkeeper' })
  })
})

describe('profile edit draft (EditProfileModal)', () => {
  it('stores only the non-sensitive fields and restores them', () => {
    saveProfileDraft('u1', 'player', {
      full_name: 'Ana Ruiz', position: 'goalkeeper', current_club: 'Club de Campo', bio: 'Keeper',
      date_of_birth: DOB, nationality: 'Spanish', nationality_country_id: 12, nationality2_country_id: 44,
    })
    const raw = localStorage.getItem('profileDraft:player:u1')
    expect(raw).not.toBeNull()
    expect(leaks(raw)).toBe(false)
    expect(loadProfileDraft('u1', 'player')).toEqual({ full_name: 'Ana Ruiz', position: 'goalkeeper', current_club: 'Club de Campo', bio: 'Keeper' })
  })

  it('does not restore DOB or nationality from a draft saved before the change', () => {
    localStorage.setItem('profileDraft:player:u1', JSON.stringify({
      data: { full_name: 'Ana Ruiz', date_of_birth: DOB, nationality_country_id: 12 }, updatedAt: '', role: 'player', userId: 'u1',
    }))
    expect(loadProfileDraft('u1', 'player')).toEqual({ full_name: 'Ana Ruiz' })
  })
})
