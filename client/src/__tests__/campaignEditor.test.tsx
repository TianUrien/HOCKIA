import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn(() => Promise.resolve({ data: null, error: null })) } }))
vi.mock('@/hooks/useCountries', () => ({ useCountries: () => ({ countries: [] }) }))
vi.mock('@/hooks/useCountryNames', () => ({ useCountryNames: () => () => [] }))

import { OfferEditor } from '@/components/brands/offers/OfferEditor'
import { EMPTY_OFFER, offerShownFields, type BrandOffer, type OfferFields } from '@/lib/brandOffers'

/**
 * Campaign editor (founder 2026-11-21, proposal brand-promotion.md, phase 1):
 * the brand first says what it wants members to do; that objective sets the
 * fields and the window is 7 to 15 days.
 */
function renderEditor(over: { openToPartners?: boolean; onSave?: (f: OfferFields, submit: boolean) => void } = {}) {
  const onSave = over.onSave ?? vi.fn()
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <OfferEditor offer={null} initial={EMPTY_OFFER} brandName="Northline" openToPartners={over.openToPartners} userId="u1" saving={null} onSave={onSave} need={null} onNeedChange={() => undefined} onCancel={() => undefined} layout="desktop" />
    </QueryClientProvider>,
  )
  return onSave
}

describe('campaign editor', () => {
  it('asks for the objective first and shows nothing else until one is chosen', () => {
    renderEditor()
    expect(screen.getByText('What do you want members to do?')).toBeTruthy()
    expect(screen.getAllByRole('radio')).toHaveLength(4)
    expect(screen.queryByLabelText('Title')).toBeNull()
    fireEvent.click(screen.getByTestId('offer-send'))
    expect(screen.getByRole('alert').textContent).toBe('Choose what you want members to do')
  })

  it('"Ask you a question": no perk, no code, the link is optional, and the window starts at 14 days', () => {
    renderEditor()
    fireEvent.click(screen.getByTestId('offer-objective-ask'))
    expect(screen.getByTestId('offer-objective-ask').getAttribute('aria-checked')).toBe('true')
    expect(screen.getByLabelText('What you can help with')).toBeTruthy()
    expect(screen.queryByTestId('offer-perk-input')).toBeNull()
    expect(screen.queryByTestId('offer-code-input')).toBeNull()
    expect(screen.getByText('A page with more detail, if you have one. Members write to you from the campaign.')).toBeTruthy()
    const end = screen.getByTestId<HTMLInputElement>('offer-end-input')
    const days = Math.round((Date.parse(`${end.value}T00:00:00Z`) - Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)) / 86_400_000)
    expect(days).toBe(14)
    expect(Math.round((Date.parse(`${end.max}T00:00:00Z`) - Date.parse(`${end.min}T00:00:00Z`)) / 86_400_000)).toBe(8)
  })

  it('"Use an offer" keeps the perk and the code', () => {
    renderEditor()
    fireEvent.click(screen.getByTestId('offer-objective-offer'))
    expect(screen.getByTestId('offer-perk-input')).toBeTruthy()
    expect(screen.getByTestId('offer-code-input')).toBeTruthy()
    expect(screen.getByLabelText('What members get')).toBeTruthy()
  })

  it('"Become an ambassador" is for players and needs Open to partners', () => {
    const onSave = renderEditor({ openToPartners: false })
    fireEvent.click(screen.getByTestId('offer-objective-ambassador'))
    expect(screen.getByTestId('offer-ambassador-note').textContent).toBe('Turn on "Open to partners" in your profile first, so players can apply.')
    expect(screen.queryByRole('button', { name: 'Clubs' })).toBeNull()
    fireEvent.click(screen.getByTestId('offer-send'))
    expect(onSave).not.toHaveBeenCalled()
  })

  it('a draft keeps the objective and the player-only audience', () => {
    const onSave = vi.fn()
    renderEditor({ openToPartners: true, onSave })
    fireEvent.click(screen.getByTestId('offer-objective-ambassador'))
    expect(screen.getByTestId('offer-ambassador-note').textContent).toBe('Players. Only players can be ambassadors.')
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ objective: 'ambassador', roles: ['player'] }), false)
  })

  const days = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000)
  const today = () => new Date().toISOString().slice(0, 10)
  const existing = (over: Partial<BrandOffer>): BrandOffer => ({
    id: 'o1', status: 'live', title: 'Kit', body: 'Body', image_url: 'https://cdn.example.com/k.jpg', link_url: 'https://shop.example.com',
    country_ids: [], area: null, roles: ['player'], starts_at: null, ends_at: null, everywhere: true, regions: [], perk: null, promo_code: null, objective: 'offer',
    pending: null, pending_status: null, review_note: null, submitted_at: null, live_at: null, ended_at: null,
    created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', shown: 0, opened: 0, contacted: 0, not_useful: 0, store_visits: 0, ...over,
  })
  const renderExisting = (offer: BrandOffer) => render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <OfferEditor offer={offer} initial={offerShownFields(offer)} brandName="Northline" userId="u1" saving={null} onSave={vi.fn()} need={null} onNeedChange={() => undefined} onCancel={() => undefined} layout="desktop" />
    </QueryClientProvider>,
  )
  const ago = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

  it('a campaign published again after a take-down starts a new window today, not from the day it first went live', () => {
    renderExisting(existing({ status: 'not_approved', live_at: ago(20), starts_at: ago(20), ends_at: ago(6) }))
    const end = screen.getByTestId<HTMLInputElement>('offer-end-input')
    expect(days(end.min, today())).toBe(7)
    expect(days(end.max, today())).toBe(15)
  })

  it('a running campaign keeps its own window when edited', () => {
    renderExisting(existing({ status: 'live', live_at: ago(10), starts_at: ago(10), ends_at: new Date(Date.now() + 4 * 86_400_000).toISOString() }))
    const end = screen.getByTestId<HTMLInputElement>('offer-end-input')
    expect(days(end.max, today())).toBe(5)
  })

  it('a live campaign from before the window existed (no end date) starts its window at the edit', () => {
    renderExisting(existing({ status: 'live', live_at: ago(40), starts_at: null, ends_at: null }))
    const end = screen.getByTestId<HTMLInputElement>('offer-end-input')
    expect(days(end.min, today())).toBe(7)
    expect(days(end.max, today())).toBe(15)
  })
})
