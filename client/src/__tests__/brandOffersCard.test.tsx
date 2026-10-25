import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))

import { OffersCard } from '@/components/profile/v2/BrandOffersCard'

describe('brand dashboard Offers card (Figma B0 / B0b)', () => {
  it('B0: no offers → one Primary that opens the editor', () => {
    const onCreate = vi.fn()
    render(<OffersCard offers={[]} totals={null} onCreate={onCreate} onOpen={vi.fn()} />)
    expect(screen.getByText('Bring something useful to members where they live. Free, and live as soon as you publish.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Create your first offer' }))
    expect(onCreate).toHaveBeenCalled()
  })

  it('B0b: counts live offers and opens the list', () => {
    const onOpen = vi.fn()
    render(<OffersCard offers={[{ status: 'live' }, { status: 'live' }, { status: 'draft' }]} totals={null} onCreate={vi.fn()} onOpen={onOpen} />)
    expect(screen.getByText('2 of 5 live')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('brand-offers-link'))
    expect(onOpen).toHaveBeenCalled()
  })

  it('says what is waiting when nothing is live yet', () => {
    render(<OffersCard offers={[{ status: 'draft' }, { status: 'in_review' }, { status: 'in_review' }]} totals={null} onCreate={vi.fn()} onOpen={vi.fn()} />)
    expect(screen.getByText('0 of 5 live · 3 drafts')).toBeInTheDocument()
  })

  it('hides the 30-day tiles while every number is zero or unknown', () => {
    const { rerender } = render(<OffersCard offers={[{ status: 'live' }]} totals={{ shown: 0, opened: 0, contacted: 0 }} onCreate={vi.fn()} onOpen={vi.fn()} />)
    expect(screen.queryByTestId('brand-offers-tiles')).toBeNull()
    rerender(<OffersCard offers={[{ status: 'live' }]} totals={null} onCreate={vi.fn()} onOpen={vi.fn()} />)
    expect(screen.queryByTestId('brand-offers-tiles')).toBeNull()
  })

  it('shows the tiles once any number is above zero, without a reply row or See results yet', () => {
    render(<OffersCard offers={[{ status: 'live' }]} totals={{ shown: 158, opened: 31, contacted: 0 }} onCreate={vi.fn()} onOpen={vi.fn()} />)
    expect(screen.getByText('158')).toBeInTheDocument()
    expect(screen.getByText('Shown to')).toBeInTheDocument()
    expect(screen.getByText('Last 30 days')).toBeInTheDocument()
    expect(screen.queryByText(/waiting for your reply/)).toBeNull()
    expect(screen.queryByText('See results')).toBeNull()
  })
})
