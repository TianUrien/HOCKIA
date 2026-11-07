import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))

import { EMPTY_OFFER, audienceLine, offerMissing, offerReasonLine, reachLine } from '@/lib/brandOffers'
import { detailReasonLine, offerForLine } from '@/lib/memberOffers'

// Brand evaluation 2026-11-07, P0: Everywhere, regions and the reach line.
const base = { ...EMPTY_OFFER, title: 'Kit', body: '15% off', link_url: 'https://shop.example.com', roles: ['player' as const] }

describe('where an offer reaches', () => {
  it('needs a place: Everywhere, a region or a country', () => {
    expect(offerMissing(base)).toBe('Choose where members live')
    expect(offerMissing({ ...base, everywhere: true })).toBeNull()
    expect(offerMissing({ ...base, regions: ['Europe'] })).toBeNull()
    expect(offerMissing({ ...base, country_ids: [48] })).toBeNull()
  })

  it('list rows and the offer page name the place', () => {
    expect(audienceLine([], ['player'], { everywhere: true })).toBe('Everywhere · Players')
    expect(audienceLine(['Argentina'], ['player', 'coach'], { regions: ['Europe'] })).toBe('Europe, Argentina · Players, coaches')
    expect(offerForLine(['player'], [], { everywhere: true })).toBe('Players everywhere')
    expect(offerForLine(['player'], ['United Kingdom'], { regions: ['Oceania'] })).toBe('Players who live in Oceania or the United Kingdom')
  })

  it('an Everywhere offer never claims where the member lives', () => {
    expect(offerReasonLine('England', 'player', true)).toBe('You see this because you play. It is for members everywhere.')
    expect(offerReasonLine('England', 'player')).toBe('You see this because you live in England and play.')
    expect(detailReasonLine('England', true)).toBe('You see this because it is for members everywhere.')
  })
})

describe('reachLine', () => {
  it('shows real counts and hides anything under 5', () => {
    expect(reachLine({ total: 38, without_country: null, by_role: { player: 32, club: 6 }, by_country: [] }, ['player', 'club'])).toBe('Reaches 38 members today (32 players, 6 clubs).')
    expect(reachLine({ total: 38, without_country: null, by_role: { player: 35, club: null }, by_country: [] }, ['player', 'club'])).toBe('Reaches 38 members today.')
    expect(reachLine({ total: null, without_country: null, by_role: {}, by_country: [] }, ['player'])).toBe('Fewer than 5 members match this today.')
    expect(reachLine(null, ['player'])).toBeNull()
  })
})
