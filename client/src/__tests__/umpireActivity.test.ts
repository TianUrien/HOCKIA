import { describe, expect, it } from 'vitest'
import { getUmpireActivity } from '@/lib/umpireActivity'

// Fixed clock so the test doesn't drift with real time. Chosen mid-year to
// avoid month-length edge cases.
const NOW = new Date('2026-07-15T12:00:00Z')

describe('getUmpireActivity', () => {
  it('returns null when last_officiated_at is missing', () => {
    expect(getUmpireActivity(null, NOW)).toBeNull()
    expect(getUmpireActivity(undefined, NOW)).toBeNull()
    expect(getUmpireActivity('', NOW)).toBeNull()
  })

  it('returns null for an unparseable date', () => {
    expect(getUmpireActivity('not-a-date', NOW)).toBeNull()
  })

  it('labels a recent appointment (<= 6 months) as Active this season', () => {
    const threeMonthsAgo = '2026-04-15'
    expect(getUmpireActivity(threeMonthsAgo, NOW)).toEqual({
      state: 'active',
      label: 'Active this season',
    })
  })

  it('labels todays appointment as Active this season', () => {
    expect(getUmpireActivity('2026-07-15', NOW)).toEqual({
      state: 'active',
      label: 'Active this season',
    })
  })

  it('labels 6-24 month old appointment as recent with month + year', () => {
    const result = getUmpireActivity('2025-09-01', NOW)
    expect(result?.state).toBe('recent')
    // Locale-aware, so just assert it contains the year and a month abbreviation.
    expect(result?.label).toMatch(/Last officiated:/)
    expect(result?.label).toMatch(/2025/)
  })

  it('labels older than 24 months as distant with year only', () => {
    const result = getUmpireActivity('2023-01-01', NOW)
    expect(result).toEqual({
      state: 'distant',
      label: 'Last officiated: 2023',
    })
  })

  it('does not drift by a day when the viewer is in a non-UTC timezone', () => {
    // Date-only strings from Postgres are '2024-01-01'. If we parsed them
    // with local time they could slip into 2023-12-31 for UTC-9 viewers.
    // Regardless of the machine zone, the year in the label should be 2024.
    const result = getUmpireActivity('2024-01-01', NOW)
    expect(result?.label).toMatch(/2024/)
  })
})
