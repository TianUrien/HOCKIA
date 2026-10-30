/**
 * Hockia AI context chip (rebrand page 17, store screenshot 10): copy per
 * role and entry, real counts only, never "0 open", umpires never see
 * "appointments".
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))
import { aiContextChip, aiContextChipLabel, goalChipLabel, type AiChipInput } from '@/lib/hockiaAiContext'

const base: AiChipInput = { role: 'player', recruiter: false, entry: 'header', goalLabel: null }
const label = (i: Partial<AiChipInput>) => {
  const c = aiContextChip({ ...base, ...i })
  return c ? aiContextChipLabel(c) : null
}

describe('aiContextChip', () => {
  it('player: goal from the header, Opportunities from that screen, nothing without either', () => {
    expect(label({ goalLabel: 'Play abroad' })).toBe('Your goal · Play abroad')
    expect(aiContextChip({ ...base, goalLabel: 'Play abroad' })?.kind).toBe('goal')
    expect(label({ entry: 'opportunities', openOpportunities: 128, goalLabel: 'Play abroad' })).toBe('Opportunities · 128 open')
    expect(label({})).toBeNull()
  })

  it('per role: coach, club, brand, umpire', () => {
    expect(label({ role: 'coach', entry: 'opportunities', openOpportunities: 6 })).toBe('Coaching opportunities · 6 open')
    expect(label({ role: 'club', recruiter: true, myOpenRoles: 2 })).toBe('Your opportunities · 2 open')
    expect(label({ role: 'brand', liveOffers: 2 })).toBe('Your offers · 2 live')
    expect(label({ role: 'umpire', matchesOfficiated: 12 })).toBe('Your record · 12 matches officiated')
    expect(label({ role: 'umpire', matchesOfficiated: 1 })).toBe('Your record · 1 match officiated')
  })

  it('a count that is 0 or unknown drops the fact, never "0 open"', () => {
    expect(label({ entry: 'opportunities', openOpportunities: 0 })).toBe('Opportunities')
    expect(label({ role: 'club', recruiter: true, myOpenRoles: null })).toBe('Your opportunities')
    expect(label({ role: 'umpire' })).toBe('Your record')
    expect(label({ role: 'umpire', matchesOfficiated: 3 })).not.toMatch(/appointment/i)
  })
})

describe('goalChipLabel', () => {
  it('first pick in option order, else the member\'s own words', () => {
    expect(goalChipLabel('player', { options: ['get_sponsor', 'play_abroad'], other_text: null })).toBe('Play abroad')
    expect(goalChipLabel('player', { options: [], other_text: 'Play in Spain' })).toBe('Play in Spain')
    expect(goalChipLabel('player', { options: [], other_text: null })).toBeNull()
    expect(goalChipLabel(null, { options: ['play_abroad'], other_text: null })).toBeNull()
  })
})
