import { describe, expect, it } from 'vitest'
import { deadlineBounds, deadlineError } from '@/lib/roleLifecycle'

const NOW = new Date(2026, 9, 11, 12) // 11 Oct 2026, local noon

describe('application deadline rule', () => {
  it('bounds run from today to two years ahead', () => {
    expect(deadlineBounds(NOW)).toEqual({ min: '2026-10-11', max: '2028-10-11' })
  })
  it('rejects the production typo year 0026', () => {
    expect(deadlineError('0026-10-01', NOW)).toBe('The deadline can’t be in the past.')
  })
  it('rejects past dates and dates beyond two years', () => {
    expect(deadlineError('2026-10-10', NOW)).toBe('The deadline can’t be in the past.')
    expect(deadlineError('2028-10-12', NOW)).toBe('The deadline must be within 2 years.')
  })
  it('accepts today, the last allowed day and no deadline at all', () => {
    expect(deadlineError('2026-10-11', NOW)).toBeNull()
    expect(deadlineError('2028-10-11', NOW)).toBeNull()
    expect(deadlineError(null, NOW)).toBeNull()
  })
})
