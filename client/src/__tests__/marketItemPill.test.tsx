import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))

import { OfferPill } from '@/components/marketplace/MarketParts'

/**
 * Founder 2026-11-22: a campaign says what it is. Before, every campaign
 * carried "Offer" on the member side, also one that only asks for questions.
 */
describe('the pill on a brand campaign, member side', () => {
  const text = () => screen.getByTestId('market-item-pill').textContent
  it('names the kind of campaign', () => {
    const { rerender } = render(<OfferPill objective="ask" />)
    expect(text()).toBe('Questions')
    rerender(<OfferPill objective="product" />)
    expect(text()).toBe('Product')
    rerender(<OfferPill objective="ambassador" />)
    expect(text()).toBe('Ambassadors')
  })
  it('an offer shows its perk, or "Offer" when it has none', () => {
    const { rerender } = render(<OfferPill objective="offer" perk="15% off" />)
    expect(text()).toBe('15% off')
    rerender(<OfferPill objective="offer" perk="  " />)
    expect(text()).toBe('Offer')
  })
  it('a server that does not say the objective yet keeps the old pill', () => {
    const { rerender } = render(<OfferPill perk="Free delivery" />)
    expect(text()).toBe('Free delivery')
    rerender(<OfferPill />)
    expect(text()).toBe('Offer')
  })
  it('a question campaign never shows a perk left on its row', () => {
    render(<OfferPill objective="ask" perk="15% off" />)
    expect(text()).toBe('Questions')
  })
})
