import { describe, it, expect } from 'vitest'
import { formatDurationText, whenLine, startsLine } from '@/lib/opportunityCopy'

// duration_text is free text; the old form also stored bare numbers meaning
// months. Founder ruling 2026-09-23: format on display, no data migration.
describe('formatDurationText', () => {
  it('turns a bare number into months', () => {
    expect(formatDurationText('7')).toBe('7 months')
    expect(formatDurationText(' 3 ')).toBe('3 months')
    expect(formatDurationText('1')).toBe('1 month')
  })

  it('trims free text and shows it as written', () => {
    expect(formatDurationText('Permanent ')).toBe('Permanent')
    expect(formatDurationText('3 month')).toBe('3 month')
    expect(formatDurationText('Season  March-September')).toBe('Season March-September')
    expect(formatDurationText('6-7 months')).toBe('6-7 months')
  })

  it('returns null for empty values', () => {
    expect(formatDurationText(null)).toBeNull()
    expect(formatDurationText(undefined)).toBeNull()
    expect(formatDurationText('   ')).toBeNull()
  })
})

describe('when / starts lines use the formatter', () => {
  it('whenLine', () => {
    expect(whenLine({ start_date: null, duration_text: '7' })).toBe('7 months')
    expect(whenLine({ start_date: null, duration_text: null })).toBe('Starts immediately')
  })
  it('startsLine', () => {
    expect(startsLine({ start_date: null, duration_text: '3' })).toBe('Starts immediately · 3 months')
    expect(startsLine({ start_date: '2026-09-16', duration_text: 'Permanent ' })).toBe('Starts Sep 16, 2026 · Permanent')
  })
})
