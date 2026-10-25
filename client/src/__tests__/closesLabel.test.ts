/**
 * Design audit 2026-10-21, A5: one shared deadline label. "Closes in N days"
 * only at 14 days or fewer, otherwise "Closes 13 Feb"; today/tomorrow named.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))
import { closesLabel, closesSoonLabel, deadlineDaysLeft, postedOnlyLine } from '@/lib/opportunityCopy'
import { roleStatus } from '@/lib/opportunityRails'
import { roleStatusLine } from '@/lib/profileV2'

const now = new Date(2026, 9, 21, 15, 0) // 21 Oct 2026, 15:00 local

describe('closesLabel', () => {
  it('names today and tomorrow', () => {
    expect(closesLabel('2026-10-21', now)).toBe('Closes today')
    expect(closesLabel('2026-10-22', now)).toBe('Closes tomorrow')
  })
  it('counts down only at 14 days or fewer', () => {
    expect(closesLabel('2026-10-23', now)).toBe('Closes in 2 days')
    expect(closesLabel('2026-11-04', now)).toBe('Closes in 14 days')
    expect(closesLabel('2026-11-05', now)).toBe('Closes 5 Nov')
  })
  it('adds the year only for a deadline close to a year away', () => {
    expect(closesLabel('2027-02-13', now)).toBe('Closes 13 Feb')
    expect(closesLabel('2027-10-01', now)).toBe('Closes 1 Oct 2027')
  })
  it('is null with no deadline or a passed one', () => {
    expect(closesLabel(null, now)).toBeNull()
    expect(closesLabel('2026-10-20', now)).toBeNull()
  })
  it('never contains an em dash', () => {
    expect(closesLabel('2026-12-01', now)).not.toContain('—')
  })
})

describe('closesSoonLabel', () => {
  it('is the countdown only, for a line that already shows the date', () => {
    expect(closesSoonLabel('2026-10-25', now)).toBe('Closes in 4 days')
    expect(closesSoonLabel('2026-12-25', now)).toBeNull()
  })
})

describe('deadlineDaysLeft', () => {
  it('counts calendar days', () => {
    expect(deadlineDaysLeft('2026-10-21', now)).toBe(0)
    expect(deadlineDaysLeft('2026-10-31', now)).toBe(10)
  })
})

describe('every surface uses the shared label', () => {
  it('role cards (roleStatus)', () => {
    expect(roleStatus({ created_at: '2026-01-01T00:00:00Z', application_deadline: '2027-02-13' }, now)?.label).toBe('Closes 13 Feb')
    expect(roleStatus({ created_at: '2026-01-01T00:00:00Z', application_deadline: '2026-10-25' }, now)?.label).toBe('Closes in 4 days')
  })
  it('profile open-role rows (roleStatusLine) no longer count down past 14 days', () => {
    expect(roleStatusLine('2026-11-15', '2026-01-01T00:00:00Z', now)).toBe('Closes 15 Nov')
    expect(roleStatusLine('2026-10-22', '2026-01-01T00:00:00Z', now)).toBe('Closes tomorrow')
  })
})

describe('postedOnlyLine', () => {
  it('never repeats the deadline (the opportunity page shows it in the chip and the Apply-by tile)', () => {
    const line = postedOnlyLine({ created_at: new Date(2026, 9, 16).toISOString() }, now)
    expect(line).toBe('Posted 5 days ago')
    expect(line).not.toMatch(/Apply by|Closes/)
  })
})
