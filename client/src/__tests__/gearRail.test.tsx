import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const rpc = vi.fn()
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }))
vi.mock('@/lib/trackDbEvent', () => ({ trackDbEvent: vi.fn() }))
vi.mock('@/hooks/useCountryNames', () => ({ useCountryNames: () => (ids: number[] | null | undefined) => (ids ?? []).map(() => 'Netherlands') }))
vi.mock('@/lib/auth', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ user: { id: 'u1' }, profile: { role: 'player', base_country_id: 30 } }),
}))

import { GearRail } from '@/components/offers/GearRail'

const tile = (kind: 'offer' | 'product', id: string) => ({
  kind, id, brand_id: 'b1', brand_name: 'Northline Hockey', brand_slug: 'northline', brand_logo_url: null, brand_profile_id: 'pb',
  title: `${kind} ${id}`, image_url: null, link_url: 'https://example.com', member_country_id: 30,
})
const wrap = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><GearRail /></MemoryRouter></QueryClientProvider>,
)

beforeEach(() => { rpc.mockReset(); try { localStorage.clear() } catch { /* */ } })

describe('Gear and deals near you (HR1)', () => {
  it('shows offers with an Offer pill and products, with the country in the subtitle', async () => {
    rpc.mockResolvedValue({ data: [tile('offer', 'o1'), tile('product', 'p1')], error: null })
    wrap()
    await screen.findByTestId('home-gear-rail')
    expect(screen.getByText('From brands that sell in the Netherlands')).toBeInTheDocument()
    expect(screen.getAllByTestId('home-gear-tile')).toHaveLength(2)
    expect(screen.getAllByText('Offer')).toHaveLength(1)
  })

  it('hides below two tiles (one product alone shows nothing)', async () => {
    rpc.mockResolvedValue({ data: [tile('product', 'p1')], error: null })
    const { container } = wrap()
    await waitFor(() => expect(rpc).toHaveBeenCalled())
    expect(container.querySelector('[data-testid="home-gear-rail"]')).toBeNull()
  })

  it('one offer and nothing else falls back to the single offer card', async () => {
    rpc.mockImplementation(async (fn: string) => fn === 'get_home_gear_rail'
      ? { data: [tile('offer', 'o1')], error: null }
      : { data: [{ ...tile('offer', 'o1'), body: 'What members get', country_ids: [30], roles: ['player'], area: null, ends_at: null, brand_category: null, brand_country_id: 30, brand_open_to_partners: false }], error: null })
    wrap()
    await screen.findByTestId('home-gear-single')
    expect(screen.getByText('What members get')).toBeInTheDocument()
  })

  it('stays hidden for 7 days after Show fewer of these', async () => {
    localStorage.setItem('hockia-home-rail-hidden-until', String(Date.now() + 86_400_000))
    rpc.mockResolvedValue({ data: [tile('offer', 'o1'), tile('product', 'p1')], error: null })
    const { container } = wrap()
    await new Promise((r) => setTimeout(r, 20))
    expect(rpc).not.toHaveBeenCalled()
    expect(container.querySelector('[data-testid="home-gear-rail"]')).toBeNull()
  })
})
