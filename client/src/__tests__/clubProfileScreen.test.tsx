import { describe, it, expect } from 'vitest'
import { clubLeagueLine, openRoleLine } from '@/lib/clubProfileCopy'

// Figma 04 Club › Club profile (337:372 / 337:588): the league fact row and
// the public open-role card's second line.
describe('clubLeagueLine', () => {
  it('merges an identical men and women league', () => {
    expect(clubLeagueLine('Leinster Division 1A', 'Leinster Division 1A')).toBe('Leinster Division 1A · men & women')
    expect(clubLeagueLine('Premier Division', ' premier division ')).toBe('Premier Division · men & women')
  })
  it('names each side when they differ', () => {
    expect(clubLeagueLine('Premier Division', 'Serie A1')).toBe('Premier Division · men, Serie A1 · women')
  })
  it('handles one side and none', () => {
    expect(clubLeagueLine('Premier Division', null)).toBe('Premier Division · men')
    expect(clubLeagueLine(null, 'Serie A1')).toBe('Serie A1 · women')
    expect(clubLeagueLine('', undefined)).toBeNull()
  })
})

describe('openRoleLine', () => {
  it('reads "Open role · from Sep 1 · 7 months"', () => {
    expect(openRoleLine({ startDate: '2026-09-01T00:00:00Z', durationText: '7' })).toBe('Open role · from Sep 1 · 7 months')
  })
  it('drops the parts it does not have', () => {
    expect(openRoleLine({ startDate: null, durationText: null })).toBe('Open role')
    expect(openRoleLine({ startDate: null, durationText: 'Permanent ' })).toBe('Open role · Permanent')
  })
})
