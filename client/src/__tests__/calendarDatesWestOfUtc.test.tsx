/**
 * Calendar dates west of UTC (found 2026-11-20).
 *
 * DATE columns (opportunities.start_date, profiles.available_from) arrive as
 * "2026-09-01". Read with `new Date()` that is midnight UTC, which is still
 * 31 August in the Americas: a role starting on 1 September showed "from
 * 31 Aug" and "Aug 2026" to members in Argentina. A date-only value is a
 * calendar day and reads the same everywhere.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// roleDetailShared imports the Supabase client, which needs env values CI does not have.
vi.mock('@/lib/supabase', () => ({ supabase: {} }))

import { shortDayOf } from '@/lib/signing'
import { openRoleLine } from '@/lib/clubProfileCopy'
import { roleDates } from '@/components/opportunities/roleDetailShared'
import type { Vacancy } from '@/lib/supabase'

const NOW = new Date('2026-08-20T15:00:00Z')

// [zone, the local day on which midnight UTC of 1 September falls]
describe.each([['America/Argentina/Buenos_Aires', 31], ['America/Los_Angeles', 31], ['UTC', 1], ['Pacific/Auckland', 1]] as const)('calendar dates in %s', (zone, utcMidnightDay) => {
  const before = process.env.TZ
  beforeAll(() => { process.env.TZ = zone })
  afterAll(() => { process.env.TZ = before })

  it('the zone is in effect', () => {
    expect(new Date('2026-09-01T00:00:00Z').getDate()).toBe(utcMidnightDay)
  })

  it('a date-only value keeps its day', () => {
    expect(shortDayOf('2026-09-01', NOW)).toBe('1 Sep')
    expect(shortDayOf('2026-12-31', NOW)).toBe('31 Dec')
    expect(openRoleLine({ startDate: '2026-09-01', durationText: '7' })).toBe('Open opportunity, from 1 Sep, 7 months')
  })

  it('a role starting on the first of the month shows that month', () => {
    const dates = roleDates({ start_date: '2026-09-01', duration_text: null, application_deadline: null } as unknown as Vacancy)
    expect(dates.startsValue).toMatch(/^Sept? 2026$/)
  })
})
