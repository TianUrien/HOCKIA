import { describe, expect, it } from 'vitest'
import { EXPECTED_SAMPLE_RATE, expectedErrorKey, isUnsampledMeasure } from '@/lib/sentryFilters'
import { tracesRateFor } from '@/lib/sentryInit'

describe('expected outcomes are counted, not hidden (2026-10-19)', () => {
  it('classifies member outcomes by kind', () => {
    expect(expectedErrorKey('AuthApiError: Invalid login credentials')).toBe('login_wrong_password')
    expect(expectedErrorKey('Request rate limit reached')).toBe('auth_rate_limit')
    expect(expectedErrorKey('Email rate limit exceeded')).toBe('auth_rate_limit')
    expect(expectedErrorKey('AuthSessionMissingError: Auth session missing!')).toBe('auth_session_missing')
    expect(expectedErrorKey('This user is not available for messaging right now.')).toBe('refusal')
    expect(expectedErrorKey('', { message: 'x', details: 'new_conversation_limit' })).toBe('refusal')
  })
  it('leaves real errors alone', () => {
    expect(expectedErrorKey('TypeError: Cannot read properties of undefined')).toBeNull()
    expect(expectedErrorKey('create_profile_for_new_user requires authentication')).toBeNull()
  })
  it('samples at a quarter', () => {
    expect(EXPECTED_SAMPLE_RATE).toBe(0.25)
  })
  it('never samples the captcha coverage measurement, though its message says captcha', () => {
    expect(expectedErrorKey('captcha coverage (login: missing)')).toBe('captcha_failed')
    expect(isUnsampledMeasure({ captcha_coverage: 'missing' })).toBe(true)
    expect(isUnsampledMeasure({ expected: 'captcha_failed' })).toBe(false)
    expect(isUnsampledMeasure(undefined)).toBe(false)
  })
})

describe('trace sampling by route', () => {
  it('traces sign-up fully, Home at half, the rest at 30 % in production', () => {
    expect(tracesRateFor('production', '/signup')).toBe(1)
    expect(tracesRateFor('production', '/signup/email')).toBe(1)
    expect(tracesRateFor('production', '/complete-profile')).toBe(1)
    expect(tracesRateFor('production', '/home')).toBe(0.5)
    expect(tracesRateFor('production', '/homepage-x')).toBe(0.3)
    expect(tracesRateFor('production', '/opportunities/abc')).toBe(0.3)
  })
  it('follows the parent decision and traces everything outside production', () => {
    expect(tracesRateFor('production', '/signup', false)).toBe(0)
    expect(tracesRateFor('production', '/opportunities', true)).toBe(1)
    expect(tracesRateFor('staging', '/opportunities')).toBe(1)
  })
})
