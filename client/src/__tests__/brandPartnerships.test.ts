import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))

import { HANDLE_RE, followersLabel, handleFromSocial } from '@/lib/brandPartnerships'

// Brand partnerships (2026-11-07): followers are always shown as declared.
describe('brand partnerships helpers', () => {
  it('labels declared followers, never as verified', () => {
    expect(followersLabel(850)).toBe('850 followers (declared)')
    expect(followersLabel(1200)).toBe('1.2k followers (declared)')
    expect(followersLabel(12_400)).toBe('12k followers (declared)')
    expect(followersLabel(2_000_000)).toBe('2M followers (declared)')
    expect(followersLabel(null)).toBeNull()
  })
  it('reads the handle from the profile’s Instagram link', () => {
    expect(handleFromSocial({ instagram: 'https://instagram.com/valen.hockey' })).toBe('valen.hockey')
    expect(handleFromSocial({ instagram: '@goalie_9' })).toBe('goalie_9')
    expect(handleFromSocial({})).toBeNull()
    expect(handleFromSocial(null)).toBeNull()
  })
  it('accepts Instagram usernames only', () => {
    expect(HANDLE_RE.test('@valen.hockey')).toBe(true)
    expect(HANDLE_RE.test('valen hockey')).toBe(false)
  })
})
