import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const h = vi.hoisted(() => ({ phone: false }))
vi.mock('@/lib/supabase', () => ({ supabase: {} }))
vi.mock('@/components/Header', () => ({ default: () => null }))
vi.mock('@/components/hockiaAi/HockiaAiButton', () => ({ HockiaAiButton: () => null }))
vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => h.phone }))
vi.mock('@/hooks/useCountryNames', () => ({ useCountryNames: () => () => [] }))
vi.mock('@/hooks/useMyBrand', () => ({ useMyBrand: () => ({ brand: { name: 'Northline', open_to_partners: false }, isLoading: false }) }))
vi.mock('@/lib/auth', () => ({ useAuthStore: () => ({ user: { id: 'u1' }, profile: { role: 'brand' } }) }))
vi.mock('@/lib/marketplace', async (orig) => ({ ...(await orig<typeof import('@/lib/marketplace')>()), fetchMyItemNeeds: () => Promise.resolve(new Map()) }))
vi.mock('@/hooks/useBrandOffers', () => ({
  useMyBrandOffers: () => ({
    isLoading: false,
    offers: [{ id: 'o1', status: 'draft', title: 'Kit', body: 'Body', image_url: null, link_url: null, country_ids: [], area: null, roles: ['player'], starts_at: null, ends_at: null, everywhere: true, regions: [], perk: null, promo_code: null, objective: 'ask', pending: null, pending_status: null, review_note: null, submitted_at: null, live_at: null, ended_at: null, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z', shown: 0, opened: 0, contacted: 0, not_useful: 0, store_visits: 0 }],
    save: { mutateAsync: vi.fn() }, setState: { mutateAsync: vi.fn() }, duplicate: { mutateAsync: vi.fn() },
  }),
}))
// The editor itself is covered in campaignEditor.test.tsx; here only whether the page opens it, and for which campaign.
vi.mock('@/components/brands/offers/OfferEditor', () => ({
  OfferEditor: ({ offer, layout }: { offer: { id: string } | null; layout: string }) => <div data-testid="editor-stub" data-offer={offer?.id ?? 'new'} data-layout={layout} />,
}))

import BrandOffersPage from '@/pages/BrandOffersPage'

/**
 * Desktop keeps the editor beside the list in page state. A link to
 * /dashboard/offers/:id/edit or /new (the report's "Edit campaign" and "Run
 * again", a notification) must open it there too: before 2026-11-21 only
 * phones read the route and desktop landed on the plain list.
 */
function renderAt(path: string) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/dashboard/offers" element={<BrandOffersPage />} />
          <Route path="/dashboard/offers/new" element={<BrandOffersPage mode="new" />} />
          <Route path="/dashboard/offers/:offerId/edit" element={<BrandOffersPage mode="edit" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('campaigns page, desktop width', () => {
  beforeEach(() => { h.phone = false })

  it('opens the editor for the campaign in the address', async () => {
    renderAt('/dashboard/offers/o1/edit')
    const editor = await screen.findByTestId('editor-stub')
    expect(editor.getAttribute('data-offer')).toBe('o1')
    expect(editor.getAttribute('data-layout')).toBe('desktop')
    // The list stays beside it.
    expect(screen.getByTestId('offer-row')).toBeTruthy()
  })

  it('opens a new campaign from /dashboard/offers/new', async () => {
    renderAt('/dashboard/offers/new')
    expect((await screen.findByTestId('editor-stub')).getAttribute('data-offer')).toBe('new')
  })

  it('the plain list opens no editor', () => {
    renderAt('/dashboard/offers')
    expect(screen.queryByTestId('editor-stub')).toBeNull()
  })

  it('a phone still gets the editor as its own screen', async () => {
    h.phone = true
    renderAt('/dashboard/offers/o1/edit')
    const editor = await screen.findByTestId('editor-stub')
    expect(editor.getAttribute('data-layout')).toBe('phone')
    expect(screen.queryByTestId('offer-row')).toBeNull()
  })
})
