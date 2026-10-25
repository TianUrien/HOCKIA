import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const rpc = vi.fn()
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }))
vi.mock('@/lib/trackDbEvent', () => ({ trackDbEvent: vi.fn() }))
vi.mock('@/hooks/useCountryNames', () => ({ useCountryNames: () => (ids: number[] | null | undefined) => (ids ?? []).map(() => 'England') }))
vi.mock('@/hooks/useCountries', () => ({ useCountries: () => ({ countries: [], getCountryById: () => ({ id: 202, name: 'England', common_name: null }) }) }))
let role = 'player'
vi.mock('@/lib/auth', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ user: { id: 'u1' }, profile: { role, base_country_id: 202 } }),
}))

import { needOrder, itemsByNeed, sortForList, type MarketItem } from '@/lib/marketplace'
import { MarketplaceHub } from '@/components/marketplace/MarketplaceHub'

let n = 0
const item = (kind: 'offer' | 'product', need: MarketItem['need'], at = '2026-10-20T00:00:00Z'): MarketItem => ({
  kind, id: `i${++n}`, brand_id: `b${n % 3}`, brand_name: `Brand ${n % 3}`, brand_slug: 's', brand_logo_url: null, brand_profile_id: `p${n % 3}`,
  brand_category: 'equipment', title: `${kind} ${need} ${n}`, body: null, image_url: null, link_url: 'https://example.com', need, created_at: at, country_id: 202, base_country_id: 202,
})

const wrap = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={['/community/brands']}><MarketplaceHub /></MemoryRouter>
  </QueryClientProvider>,
)

beforeEach(() => { rpc.mockReset(); role = 'player' })

describe('marketplace rules (MK1)', () => {
  it('orders rails by what the member most likely needs', () => {
    expect(needOrder('player', ['play_abroad'])[0]).toBe('moving_abroad')
    expect(needOrder('club', [])[0]).toBe('for_clubs')
    expect(needOrder('coach', ['grow_coach'])[0]).toBe('gear')
  })
  it('lists offers first, then newest', () => {
    const a = item('product', 'gear', '2026-10-24T00:00:00Z')
    const b = item('offer', 'gear', '2026-10-01T00:00:00Z')
    const c = item('product', 'gear', '2026-10-25T00:00:00Z')
    expect(sortForList([a, b, c]).map((x) => x.id)).toEqual([b.id, c.id, a.id])
    expect(itemsByNeed([a, b, c]).get('gear')).toHaveLength(3)
  })
})

describe('the hub', () => {
  const answer = (items: MarketItem[]) => rpc.mockImplementation(async (fn: string) => (fn === 'get_marketplace' ? { data: items, error: null } : { data: [], error: null }))

  it('little supply: one honest list and Suggest a brand, no rails (MK3)', async () => {
    answer([item('offer', 'gear'), item('product', 'gear'), item('product', 'training_recovery')])
    wrap()
    await screen.findByTestId('market-low-supply')
    expect(screen.getAllByTestId('market-row')).toHaveLength(3)
    expect(screen.getByTestId('market-suggest-brand')).toBeInTheDocument()
    expect(screen.queryByTestId('market-rail-gear')).toBeNull()
  })

  it('enough supply: offers rail, a rail per need with 2+ items, singles fold into Near you', async () => {
    answer([
      item('offer', 'gear'), item('offer', 'moving_abroad'),
      item('product', 'gear'), item('product', 'gear'),
      item('product', 'moving_abroad'), item('product', 'moving_abroad'),
      item('product', 'training_recovery'),
    ])
    wrap()
    await screen.findByTestId('market-rail-offers')
    expect(screen.getByTestId('market-rail-gear')).toBeInTheDocument()
    expect(screen.getByTestId('market-rail-moving_abroad')).toBeInTheDocument()
    expect(screen.queryByTestId('market-rail-training_recovery')).toBeNull()
    expect(screen.getByTestId('market-near-you')).toBeInTheDocument()
    // Need chips only for needs that have items.
    expect(screen.getByTestId('market-need-chip-training_recovery')).toBeInTheDocument()
    expect(screen.queryByTestId('market-need-chip-for_clubs')).toBeNull()
  })

  it('brands never get the hub', async () => {
    role = 'brand'
    answer([item('offer', 'gear')])
    const { container } = wrap()
    await new Promise((r) => setTimeout(r, 20))
    expect(container.querySelector('[data-testid="marketplace-hub"]')).toBeNull()
    await waitFor(() => expect(rpc).not.toHaveBeenCalledWith('get_marketplace', expect.anything()))
  })
})
