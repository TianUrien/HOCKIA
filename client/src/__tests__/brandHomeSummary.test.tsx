import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

let role = 'brand'
vi.mock('@/lib/auth', () => ({ useAuthStore: (sel: (s: unknown) => unknown) => sel({ profile: { id: 'b1', role } }) }))
vi.mock('@/hooks/useCountryNames', () => ({ useCountryNames: () => (ids: number[]) => ids.map(() => 'Argentina') }))
const funnel = { shown: 12, opened: 4, store_visits: 3, code_copies: 1, contacted: 2, not_useful: 0 }
vi.mock('@/lib/brandResults', async (orig) => ({
  ...(await orig<typeof import('@/lib/brandResults')>()),
  fetchBrandResults: async () => ({
    days: 30, totals: funnel, previous: { shown: 0, contacted: 0, store_visits: 0 }, offers: [{ id: 'o1', title: 'Kit', status: 'live', image_url: null, live_at: null, ...funnel, shown: 12, opened: 4 }],
    by_country: [], by_role: [], by_surface: [], seen_total: 12, contacts: [], waiting: { count: 2, oldest_at: new Date().toISOString() },
    market: [{ country_id: 48, n: 32, covered: false }], market_total: 40, products: [], community: { ambassadors: 0, invites_sent: 0, invites_accepted: 0, new_followers: 0 },
  }),
}))

import { BrandHomeSummary } from '@/components/home/BrandHomeSummary'

const wrap = () => render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><BrandHomeSummary /></MemoryRouter></QueryClientProvider>)

// Brands open Home on their own results (2026-11-07).
describe('BrandHomeSummary', () => {
  it('shows who is waiting, the 30-day numbers, the market and one next step', async () => {
    role = 'brand'
    wrap()
    expect(await screen.findByText('2 people are waiting for your reply')).toBeInTheDocument()
    expect(screen.getByText('40 members live where you sell')).toBeInTheDocument()
    expect(screen.getByText('To your store')).toBeInTheDocument()
    expect(screen.getByText('32 members live in Argentina and none of your offers reach them.')).toBeInTheDocument()
  })
  it('renders nothing for other roles', () => {
    role = 'player'
    const { container } = wrap()
    expect(container).toBeEmptyDOMElement()
  })
})
