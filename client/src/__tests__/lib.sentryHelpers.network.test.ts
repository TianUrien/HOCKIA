import { describe, it, expect } from 'vitest'
import { isNetworkFailureMessage } from '@/lib/sentryHelpers'

// Sentry triage 2026-09-24: browser network failures stay counted at info
// level and out of the error alerts. Real errors of the same family must
// still match nothing here.
describe('isNetworkFailureMessage', () => {
  it('matches the browsers\' network-failure wordings', () => {
    expect(isNetworkFailureMessage('SupabaseError: TypeError: Load failed (xtertgftujnebubxgqit.supabase.co)')).toBe(true)
    expect(isNetworkFailureMessage('TypeError: Failed to fetch')).toBe(true)
    expect(isNetworkFailureMessage('NetworkError when attempting to fetch resource.')).toBe(true)
    expect(isNetworkFailureMessage('The network connection was lost.')).toBe(true)
  })
  it('leaves real errors alone', () => {
    expect(isNetworkFailureMessage('permission denied for function compute_club_fit')).toBe(false)
    expect(isNetworkFailureMessage('Failed to fetch dynamically imported module: /assets/x.js')).toBe(true) // stale-chunk: handled by the reload guard before Sentry
    expect(isNetworkFailureMessage('AuthApiError: Email not confirmed')).toBe(false)
    expect(isNetworkFailureMessage(null)).toBe(false)
  })
})
