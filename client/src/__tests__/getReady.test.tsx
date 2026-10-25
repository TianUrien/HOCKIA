import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
const select = vi.fn()
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a), from: () => ({ select: (...a: unknown[]) => select(...a) }) } }))
vi.mock('@/lib/trackDbEvent', () => ({ trackDbEvent: vi.fn() }))

import { maybeShowGetReady, useGetReady } from '@/components/marketplace/getReadyStore'

const item = (need: string, id: string) => ({ kind: 'offer', id, brand_id: 'b', brand_name: 'Fieldcover', brand_slug: 's', brand_logo_url: null, brand_profile_id: 'p', brand_category: null, title: id, body: null, image_url: null, link_url: null, need, created_at: '2026-10-25', country_id: 81, base_country_id: 46 })

beforeEach(() => {
  rpc.mockReset(); select.mockReset(); localStorage.clear(); useGetReady.getState().close()
  select.mockResolvedValue({ data: [{ id: 46, name: 'United Kingdom', common_name: null }, { id: 81, name: 'Germany', common_name: null }], error: null })
})

describe('Get ready for <Country> (MK4)', () => {
  it('never for a role in the member’s own country', async () => {
    expect(await maybeShowGetReady({ userId: 'u', baseCountryId: 46, roleCountry: 'United Kingdom', clubName: 'X' })).toBe(false)
    expect(rpc).not.toHaveBeenCalled()
  })
  it('only with at least one Moving abroad item there', async () => {
    rpc.mockResolvedValue({ data: [item('gear', 'g1')], error: null })
    expect(await maybeShowGetReady({ userId: 'u', baseCountryId: 46, roleCountry: 'Germany', clubName: 'Hamburger Polo Club' })).toBe(false)
  })
  it('opens once per destination with up to two items', async () => {
    rpc.mockResolvedValue({ data: [item('moving_abroad', 'a'), item('moving_abroad', 'b'), item('moving_abroad', 'c')], error: null })
    expect(await maybeShowGetReady({ userId: 'u', baseCountryId: 46, roleCountry: 'germany', clubName: 'Hamburger Polo Club' })).toBe(true)
    const s = useGetReady.getState()
    expect(s.open).toBe(true)
    expect(s.countryName).toBe('Germany')
    expect(s.items.map((i) => i.id)).toEqual(['a', 'b'])
    s.close()
    expect(await maybeShowGetReady({ userId: 'u', baseCountryId: 46, roleCountry: 'Germany', clubName: 'Hamburger Polo Club' })).toBe(false)
  })
})
