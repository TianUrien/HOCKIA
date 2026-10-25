import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const rpc = vi.fn()
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }))
const track = vi.fn()
vi.mock('@/lib/trackDbEvent', () => ({ trackDbEvent: (...a: unknown[]) => track(...a) }))
vi.mock('@/hooks/useCountryNames', () => ({ useCountryNames: () => (ids: number[] | null | undefined) => (ids ?? []).map((id) => (id === 46 ? 'England' : 'Netherlands')) }))

import {
  detailReasonLine,
  hockiaAiOfferTopic,
  hockiaAiReasonLine,
  offerForLine,
  rememberOfferContact,
  reportOfferContactIfPending,
  storeLabel,
  type MemberOffer,
} from '@/lib/memberOffers'
import { MemberOfferCard } from '@/components/offers/MemberOfferCard'

const OFFER: MemberOffer = {
  id: 'o1', brand_id: 'b1', title: 'Kit for your first season abroad', body: '15% off your first full kit.', image_url: null,
  link_url: 'https://northlinehockey.com/hockia', country_ids: [46, 30], area: null, roles: ['player', 'coach'], ends_at: null,
  brand_name: 'Northline Hockey', brand_slug: 'northline', brand_logo_url: null, brand_category: 'Equipment', brand_country_id: 46,
  brand_profile_id: 'p-brand', brand_open_to_partners: true, member_country_id: 46,
}

beforeEach(() => { rpc.mockReset(); track.mockReset(); sessionStorage.clear() })

describe('Hockia AI: which questions may carry an offer (founder default topics)', () => {
  it('matches gear, kit, training, camps, physio and moving abroad', () => {
    expect(hockiaAiOfferTopic('What should I sort out before moving to England to play?')).toBe('moving abroad')
    expect(hockiaAiOfferTopic('Which stick should I buy as a defender?')).toBe('gear')
    expect(hockiaAiOfferTopic('Where can I get a club kit?')).toBe('kit')
    expect(hockiaAiOfferTopic('Good drills for drag flicks')).toBe('training')
    expect(hockiaAiOfferTopic('Any summer camps in Ireland?')).toBe('camps')
    expect(hockiaAiOfferTopic('I hurt my ankle, do I need physio?')).toBe('physio')
  })
  it('never on recruiting or people questions', () => {
    expect(hockiaAiOfferTopic('Find left-backs in Spain open to play')).toBeNull()
    expect(hockiaAiOfferTopic('Which clubs need a goalkeeper coach?')).toBeNull()
    expect(hockiaAiOfferTopic('')).toBeNull()
  })
  it('says the offer did not change the answer', () => {
    expect(hockiaAiReasonLine('moving abroad', 'England')).toBe('Shown because you asked about moving to England. It did not change the answer.')
    expect(hockiaAiReasonLine('physio', 'England')).toBe('Shown because you asked about physio. It did not change the answer.')
  })
})

describe('offer detail wording (OD1)', () => {
  it('For, Store and the reason line', () => {
    expect(offerForLine(['player', 'coach'], ['England', 'the Netherlands'])).toBe('Players and coaches who live in England or the Netherlands')
    expect(offerForLine(['player', 'coach', 'club', 'umpire'], ['England'])).toBe('Players, coaches, clubs and umpires who live in England')
    expect(storeLabel('https://www.northlinehockey.com/hockia/')).toBe('northlinehockey.com/hockia')
    expect(detailReasonLine('England')).toBe('You see this because you live in England. HOCKIA checked this offer before it went live.')
    expect(detailReasonLine(null)).toBe('HOCKIA checked this offer before it went live.')
  })
})

describe('"contacted" counts only a real first message to that brand', () => {
  it('reports once, for the same brand, and never for another member', () => {
    rememberOfferContact('p-brand', 'o1', 'home')
    reportOfferContactIfPending('someone-else')
    expect(track).not.toHaveBeenCalled()
    reportOfferContactIfPending('p-brand')
    expect(track).toHaveBeenCalledWith('brand_offer_contact', 'brand_offer', 'o1', { offer_id: 'o1', surface: 'home' })
    reportOfferContactIfPending('p-brand')
    expect(track).toHaveBeenCalledTimes(1)
  })
})

describe('Home card (H1-no-image) and Not useful (H2)', () => {
  const renderCard = () => render(<MemoryRouter><MemberOfferCard offer={OFFER} surface="home" visitId="v1" role="player" /></MemoryRouter>)

  it('shows From brands, the brand, and the location + role reason', () => {
    renderCard()
    expect(screen.getByText('From brands · Northline Hockey')).toBeInTheDocument()
    expect(screen.getByText('You see this because you live in England and play.')).toBeInTheDocument()
  })

  it('folds with Undo, records a reason, and Undo restores the card', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    renderCard()
    fireEvent.click(screen.getByTestId('member-offer-not-useful'))
    expect(screen.getByText('Got it. You’ll see fewer offers like this.')).toBeInTheDocument()
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('dismiss_brand_offer', { p_offer_id: 'o1', p_reason: null }))
    fireEvent.click(screen.getByRole('button', { name: 'Hide this brand' }))
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('dismiss_brand_offer', { p_offer_id: 'o1', p_reason: 'hide_brand' }))
    expect(track).toHaveBeenCalledWith('brand_offer_dismiss', 'brand_offer', 'o1', { offer_id: 'o1', surface: 'home', reason: 'hide_brand' })
    fireEvent.click(screen.getByTestId('member-offer-undo'))
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('undo_dismiss_brand_offer', { p_offer_id: 'o1' }))
    expect(screen.getByTestId('member-offer-card')).toBeInTheDocument()
  })
})
