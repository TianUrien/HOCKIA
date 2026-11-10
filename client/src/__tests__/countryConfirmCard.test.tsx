import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'

const eq = vi.fn(async () => ({ error: null }))
const update = vi.fn(() => ({ eq }))
vi.mock('@/lib/supabase', () => ({ supabase: { from: () => ({ update }) } }))
vi.mock('@/hooks/useCountries', () => ({
  useCountries: () => ({ countries: [{ id: 48, code: 'AR', code_alpha3: 'ARG', name: 'Argentina', common_name: null, nationality_name: 'Argentine', region: 'South America', flag_emoji: null }] }),
}))
const refreshProfile = vi.fn(async () => {})
let profile: Record<string, unknown> | null = null
let connectionCode: string | null = null
const fetchConnectionCountryCode = vi.fn(async () => connectionCode)
vi.mock('@/lib/connectionCountry', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/connectionCountry')>()), fetchConnectionCountryCode: () => fetchConnectionCountryCode() }))
vi.mock('@/lib/auth', () => ({ useAuthStore: (sel: (s: unknown) => unknown) => sel({ profile, refreshProfile }) }))

import { CountryConfirmCard } from '@/components/home/CountryConfirmCard'

// One QueryClient per render; rerender keeps the same one.
function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrap = (node: ReactElement) => <QueryClientProvider client={client}>{node}</QueryClientProvider>
  const r = rtlRender(wrap(ui))
  return { ...r, rerender: (next: ReactElement) => r.rerender(wrap(next)) }
}

describe('CountryConfirmCard (members with no country, 2026-11-07)', () => {
  beforeEach(() => { localStorage.clear(); update.mockClear(); eq.mockClear(); connectionCode = null; fetchConnectionCountryCode.mockClear() })

  it('proposes the country from the location text and saves it only on Yes', async () => {
    profile = { id: 'p1', role: 'player', base_country_id: null, base_location: 'Buenos Aires' }
    render(<CountryConfirmCard />)
    expect(screen.getByText('Which country are you based in?')).toBeInTheDocument()
    expect(update).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('country-confirm-yes'))
    await waitFor(() => expect(update).toHaveBeenCalledWith({ base_country_id: 48 }))
    expect(eq).toHaveBeenCalledWith('id', 'p1')
  })

  it('is not shown when the member has a country, or is a brand', () => {
    profile = { id: 'p2', role: 'player', base_country_id: 48, base_location: 'Salta' }
    const { container, rerender } = render(<CountryConfirmCard />)
    expect(container).toBeEmptyDOMElement()
    profile = { id: 'b1', role: 'brand', base_country_id: null, base_location: null }
    rerender(<CountryConfirmCard />)
    expect(container).toBeEmptyDOMElement()
  })

  it('Not now hides it for two weeks', () => {
    profile = { id: 'p3', role: 'coach', base_country_id: null, base_location: 'Springfield' }
    const { container, unmount } = render(<CountryConfirmCard />)
    expect(screen.queryByTestId('country-confirm-yes')).toBeNull()
    fireEvent.click(screen.getByTestId('country-confirm-later'))
    expect(container).toBeEmptyDOMElement()
    unmount()
    expect(render(<CountryConfirmCard />).container).toBeEmptyDOMElement()
  })

  // 2026-11-09: no location text → the connection's country is the suggestion.
  it('with no location text, suggests the country of the connection and saves it only on Yes', async () => {
    connectionCode = 'AR'
    profile = { id: 'p4', role: 'player', base_country_id: null, base_location: null }
    render(<CountryConfirmCard />)
    expect(await screen.findByText('Yes, Argentina')).toBeInTheDocument()
    expect(screen.getByText(/It looks like you’re in Argentina/)).toBeInTheDocument()
    expect(update).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('country-confirm-yes'))
    await waitFor(() => expect(update).toHaveBeenCalledWith({ base_country_id: 48 }))
  })

  it('what the member wrote wins: no connection lookup when the text names a country', () => {
    connectionCode = 'NZ'
    profile = { id: 'p5', role: 'player', base_country_id: null, base_location: 'Buenos Aires' }
    render(<CountryConfirmCard />)
    expect(screen.getByText('Yes, Argentina')).toBeInTheDocument()
    expect(fetchConnectionCountryCode).not.toHaveBeenCalled()
  })

  it('an unknown connection country leaves the card asking', async () => {
    connectionCode = 'ZZ'
    profile = { id: 'p6', role: 'coach', base_country_id: null, base_location: null }
    render(<CountryConfirmCard />)
    await waitFor(() => expect(fetchConnectionCountryCode).toHaveBeenCalled())
    expect(screen.queryByTestId('country-confirm-yes')).toBeNull()
    expect(screen.getByTestId('country-confirm-choose').textContent).toBe('Choose your country')
  })
})
