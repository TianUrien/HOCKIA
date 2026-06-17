import { describe, it, expect } from 'vitest'
import { isEuEligible } from '@/lib/euEligibility'
import { availabilityFilterLabel } from '@/lib/availabilityLabel'

// Pretend ids 10/11 are EU member states, 99 is non-EU.
const EU = new Set<number>([10, 11])

describe('isEuEligible (dual-aware, keep-unknown)', () => {
  it('keeps a member with no nationality on file (incomplete profile never hides someone)', () => {
    expect(isEuEligible(null, null, EU)).toBe(true)
    expect(isEuEligible(undefined, undefined, EU)).toBe(true)
  })

  it('keeps when the PRIMARY nationality is EU', () => {
    expect(isEuEligible(10, 99, EU)).toBe(true)
  })

  it('keeps when only the SECONDARY nationality is EU (the case the old filter missed)', () => {
    expect(isEuEligible(99, 11, EU)).toBe(true)
  })

  it('keeps when only one slot is filled and it is EU', () => {
    expect(isEuEligible(11, null, EU)).toBe(true)
    expect(isEuEligible(null, 10, EU)).toBe(true)
  })

  it('drops when BOTH known nationalities are non-EU', () => {
    expect(isEuEligible(99, 98, EU)).toBe(false)
  })

  it('drops when the only known nationality is non-EU', () => {
    expect(isEuEligible(99, null, EU)).toBe(false)
  })
})

describe('availabilityFilterLabel (role-aware chip copy)', () => {
  it('uses the role-correct verb per role', () => {
    expect(availabilityFilterLabel('player')).toBe('Open to play')
    expect(availabilityFilterLabel('coach')).toBe('Open to coach')
    expect(availabilityFilterLabel('umpire')).toBe('Open to umpire')
    expect(availabilityFilterLabel('club')).toBe('Recruiting')
    expect(availabilityFilterLabel('brand')).toBe('Open to partnerships')
  })

  it('falls back to the generic label for the "all"/mixed tab', () => {
    expect(availabilityFilterLabel('all')).toBe('Open to opportunities')
    expect(availabilityFilterLabel(null)).toBe('Open to opportunities')
    expect(availabilityFilterLabel(undefined)).toBe('Open to opportunities')
  })
})
