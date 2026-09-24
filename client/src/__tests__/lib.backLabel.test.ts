import { describe, it, expect } from 'vitest'
import { backLabelFrom } from '@/lib/backLabel'
import { applicationStatusPill } from '@/lib/opportunityCopy'

// Leaf 4 review, 2026-09-24: back labels name where the player came from,
// and players only ever see "Not selected".
describe('backLabelFrom', () => {
  it('names the screen the player came from', () => {
    expect(backLabelFrom({ from: '/opportunities/applications' }, 'Opportunities')).toBe('My applications')
    expect(backLabelFrom({ from: '/opportunities' }, 'X')).toBe('Opportunities')
    expect(backLabelFrom({ from: '/opportunities/5f2c' }, 'X')).toBe('Role')
    expect(backLabelFrom({ from: '/dashboard/profile?tab=media' }, 'X')).toBe('Profile')
    expect(backLabelFrom({ from: '/home' }, 'X')).toBe('Home')
  })

  it('prefers an explicit label and falls back to the parent', () => {
    expect(backLabelFrom({ from: '/home', fromLabel: 'Midfielder' }, 'X')).toBe('Midfielder')
    expect(backLabelFrom(null, 'Opportunities')).toBe('Opportunities')
    expect(backLabelFrom({ from: '/somewhere/else' }, 'Opportunities')).toBe('Opportunities')
  })
})

describe('player-facing status', () => {
  it('says "Not selected", never "Declined"', () => {
    expect(applicationStatusPill('rejected', null, true).label).toBe('Not selected')
  })
})
