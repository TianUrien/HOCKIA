import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))

import { agoLine, changeLine, nextStep, type BrandResults, type OfferResult } from '@/lib/brandResults'

const funnel = { shown: 0, opened: 0, store_visits: 0, code_copies: 0, contacted: 0, not_useful: 0 }
const offer = (o: Partial<OfferResult> = {}): OfferResult => ({ id: 'o1', title: 'Kit', status: 'live', image_url: null, live_at: null, ...funnel, ...o })
const results = (o: Partial<BrandResults> = {}): BrandResults => ({
  days: 30, totals: funnel, previous: { shown: 0, contacted: 0, store_visits: 0 }, offers: [offer()],
  by_country: [], by_role: [], by_surface: [], seen_total: 0, contacts: [], waiting: { count: 0, oldest_at: null },
  market: [], market_total: null, products: [], community: { ambassadors: 0, invites_sent: 0, invites_accepted: 0, new_followers: 0 }, ...o,
})
const names = (id: number) => ({ 48: 'Argentina' } as Record<number, string>)[id] ?? null

// Brand Results (2026-11-07): one next step from real counts, never invented.
describe('nextStep', () => {
  it('asks for a first offer when nothing is live', () => {
    expect(nextStep(results({ offers: [] }), names)?.action).toBe('Create an offer')
  })
  it('names a country the brand sells to but no offer reaches', () => {
    expect(nextStep(results({ market: [{ country_id: 48, n: 32, covered: false }] }), names)?.text).toBe('32 members live in Argentina and none of your offers reach them.')
    expect(nextStep(results({ market: [{ country_id: 48, n: null, covered: false }] }), names)).toBeNull()
  })
  it('flags an offer shown a lot and never opened, then one marked not useful', () => {
    expect(nextStep(results({ offers: [offer({ shown: 40 })] }), names)?.action).toBe('Edit offer')
    expect(nextStep(results({ offers: [offer({ shown: 10, opened: 1, not_useful: 5 })] }), names)?.action).toBe('Edit audience')
  })
  it('says nothing when nothing needs doing', () => {
    expect(nextStep(results({ offers: [offer({ shown: 40, opened: 9 })] }), names)).toBeNull()
  })
})

describe('changeLine and agoLine', () => {
  it('compares with the previous period in words', () => {
    expect(changeLine(6, 2)).toBe('4 more than before')
    expect(changeLine(1, 3)).toBe('2 fewer than before')
    expect(changeLine(2, 2)).toBe('Same as before')
    expect(changeLine(0, 0)).toBeNull()
  })
  it('reads the wait in days', () => {
    const now = new Date('2026-11-07T12:00:00Z')
    expect(agoLine('2026-11-05T10:00:00Z', now)).toBe('2 days ago')
    expect(agoLine('2026-11-07T08:00:00Z', now)).toBe('today')
  })
})
