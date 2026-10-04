/**
 * Onboarding QA 2026-10-04, club set-up step 1 (ClubSetupFlow):
 *  - the country picker was a dropdown inside a ~144 px bottom sheet, so its
 *    list opened below the screen edge. It is now a tall sheet (85dvh) with
 *    the search pinned and the list in the sheet's own scroll.
 *  - City suggestions floated (absolute) inside the sheet's scroll container
 *    and were clipped after the second result. They are now in the flow and
 *    scroll inside their own box.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => vi.fn() }
})
vi.mock('@/lib/toast', () => ({ useToastStore: (sel: (s: { addToast: () => void }) => unknown) => sel({ addToast: vi.fn() }) }))
vi.mock('@/lib/trackDbEvent', () => ({ trackDbEvent: vi.fn(), consumeWallIntent: () => null }))
const COUNTRIES = [
  { id: 104, code: 'IE', name: 'Ireland', common_name: null, nationality_name: 'Irish', flag_emoji: '🇮🇪' },
  { id: 10, code: 'AR', name: 'Argentina', common_name: null, nationality_name: 'Argentine', flag_emoji: '🇦🇷' },
  { id: 150, code: 'NL', name: 'Netherlands', common_name: null, nationality_name: 'Dutch', flag_emoji: '🇳🇱' },
]
vi.mock('@/hooks/useCountries', () => ({
  useCountries: () => ({
    countries: COUNTRIES,
    loading: false,
    getCountryById: (id: number | null) => COUNTRIES.find((c) => c.id === id),
    getCountryByCode: (code: string) => COUNTRIES.find((c) => c.code === code),
  }),
}))
vi.mock('@/hooks/useGooglePlaces', () => ({
  useGooglePlaces: () => ({
    isLoaded: true,
    loadError: false,
    getAutocompletePredictions: () =>
      Promise.resolve(
        ['Kilkenny', 'Kildare', 'Killarney', 'Kilcock', 'Kilrush'].map((c, i) => ({
          placeId: `p${i}`,
          description: `${c}, Ireland`,
          mainText: c,
          secondaryText: 'Ireland',
        })),
      ),
    getPlaceDetails: vi.fn(),
  }),
}))
vi.mock('@/lib/supabase', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn(), auth: { refreshSession: vi.fn() }, storage: { from: vi.fn() } },
}))
const auth = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))
vi.mock('@/lib/auth', () => ({
  useAuthStore: Object.assign(
    (sel?: (s: Record<string, unknown>) => unknown) => (sel ? sel(auth.state) : auth.state),
    { getState: () => auth.state },
  ),
}))

import ClubSetupFlow from '@/components/club/ClubSetupFlow'

const newClub = {
  id: 'u1', role: 'club', full_name: 'Kilkenny Hockey Club', avatar_url: null, nationality_country_id: null,
  base_location: null, base_city: null, base_country_id: null, year_founded: null,
  onboarding_completed: false, org_attested_18plus_at: null,
}

describe('ClubSetupFlow step 1 sheets', () => {
  beforeEach(() => {
    // jsdom has no scrollIntoView (the picker scrolls the highlighted option).
    Element.prototype.scrollIntoView = vi.fn()
    auth.state = { user: { id: 'u1', email: 'club@example.com' }, profile: { ...newClub }, fetchProfile: vi.fn() }
  })

  it('the country picker is a tall sheet: search pinned, full list in the sheet scroll', () => {
    render(<ClubSetupFlow onFinished={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /^Country:/ }))
    const sheet = screen.getByRole('dialog', { name: 'Country' })
    expect(sheet.className).toContain('h-[85dvh]')

    const search = within(sheet).getByPlaceholderText('Search countries...')
    expect(search.closest('.sticky')).not.toBeNull()

    const list = within(sheet).getByRole('listbox')
    // Not a floating dropdown and no inner height cap: the sheet scrolls it.
    expect(list.closest('.absolute')).toBeNull()
    expect(list.className).not.toContain('max-h')
    expect(within(list).getAllByRole('option')).toHaveLength(COUNTRIES.length)
    // No trigger button inside the sheet — the list is the picker.
    expect(within(sheet).queryByRole('button', { expanded: false })).toBeNull()
  })

  it('picking a country closes the sheet and fills the field', () => {
    render(<ClubSetupFlow onFinished={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /^Country:/ }))
    const sheet = screen.getByRole('dialog', { name: 'Country' })
    fireEvent.change(within(sheet).getByPlaceholderText('Search countries...'), { target: { value: 'neth' } })
    fireEvent.click(within(sheet).getByRole('option', { name: /Netherlands/ }))
    expect(screen.queryByRole('dialog', { name: 'Country' })).toBeNull()
    expect(screen.getByRole('button', { name: /^Country:.*Netherlands/ })).toBeTruthy()
  })

  it('city suggestions sit in the flow (not clipped by the sheet) and scroll', async () => {
    render(<ClubSetupFlow onFinished={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /^City:/ }))
    const sheet = screen.getByRole('dialog', { name: 'City' })
    fireEvent.change(within(sheet).getByPlaceholderText('Where the club plays'), { target: { value: 'Kil' } })
    const list = await within(sheet).findByRole('listbox', {}, { timeout: 2000 })
    await waitFor(() => expect(within(list).getAllByRole('option')).toHaveLength(5))
    const box = list.parentElement as HTMLElement
    expect(box.dataset.placement).toBe('inline')
    expect(box.className).not.toContain('absolute')
    expect(list.className).toContain('overflow-y-auto')
  })
})
