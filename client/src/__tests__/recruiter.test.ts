import { describe, expect, it } from 'vitest'
import { fullMatchVisibilityOf, isRecruiterProfile } from '@/lib/recruiter'

describe('isRecruiterProfile (mirrors SQL is_recruiter)', () => {
  it('counts every club', () => {
    expect(isRecruiterProfile({ role: 'club' })).toBe(true)
  })
  it('counts a coach only when they recruit for a team', () => {
    expect(isRecruiterProfile({ role: 'coach', coach_recruits_for_team: true })).toBe(true)
    expect(isRecruiterProfile({ role: 'coach', coach_recruits_for_team: false })).toBe(false)
    expect(isRecruiterProfile({ role: 'coach' })).toBe(false)
  })
  it('never counts players, brands, umpires or guests', () => {
    expect(isRecruiterProfile({ role: 'player', coach_recruits_for_team: true })).toBe(false)
    expect(isRecruiterProfile({ role: 'brand' })).toBe(false)
    expect(isRecruiterProfile({ role: 'umpire' })).toBe(false)
    expect(isRecruiterProfile(null)).toBe(false)
    expect(isRecruiterProfile(undefined)).toBe(false)
  })
})

describe('fullMatchVisibilityOf', () => {
  it('reads public only when explicitly public; everything else is the private default', () => {
    expect(fullMatchVisibilityOf({ full_match_visibility: 'public' })).toBe('public')
    expect(fullMatchVisibilityOf({ full_match_visibility: 'recruiters' })).toBe('recruiters')
    expect(fullMatchVisibilityOf({ full_match_visibility: null })).toBe('recruiters')
    expect(fullMatchVisibilityOf({})).toBe('recruiters')
    expect(fullMatchVisibilityOf(null)).toBe('recruiters')
  })
})
