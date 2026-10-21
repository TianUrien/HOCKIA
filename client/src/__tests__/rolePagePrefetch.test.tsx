/**
 * Role page speed (quick wins 2026-10-21): role cards warm the page's read
 * (lib/prefetchRole → lib/roleDetail), the page uses the warmed read, and a
 * failed read shows a retry state instead of "Opportunity Not Found".
 */
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ROLE_ID = '11111111-1111-4111-8111-111111111111'

const mocks = vi.hoisted(() => ({ single: vi.fn(), from: vi.fn() }))

vi.mock('@/lib/supabase', () => {
  const chain = { select: () => chain, eq: () => chain, single: mocks.single, maybeSingle: () => Promise.resolve({ data: null, error: null }) }
  mocks.from.mockImplementation(() => chain)
  return { supabase: { from: mocks.from } }
})
vi.mock('@/lib/auth', () => ({
  useAuthStore: (sel?: (s: unknown) => unknown) => {
    const state = { user: null, profile: null }
    return sel ? sel(state) : state
  },
}))
vi.mock('@/components/Header', () => ({ default: () => null }))
vi.mock('@/components/ApplyToOpportunityModal', () => ({ default: () => null }))
vi.mock('@/components/SignInPromptModal', () => ({ default: () => null }))
vi.mock('@/components/OpportunityJsonLd', () => ({ default: () => null }))
vi.mock('@/components/opportunities/OwnApplicationRoad', () => ({ default: () => null }))
vi.mock('@/components/opportunities/OpportunityDetailMobile', () => ({
  OpportunityDetailMobile: ({ vacancy }: { vacancy: { title: string } }) => <h1 data-testid="role-title">{vacancy.title}</h1>,
}))
vi.mock('@/components/opportunities/OpportunityDetailDesktop', () => ({ OpportunityDetailDesktop: () => null }))
vi.mock('@/hooks/useClubCrestColors', () => ({ useClubCrestPalettes: () => new Map(), useWorldClubCrestPalettes: () => new Map() }))
vi.mock('@/hooks/useDocumentTitle', () => ({ useDocumentTitle: () => {} }))
vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => false }))
vi.mock('@/lib/trackDbEvent', () => ({ trackDbEvent: vi.fn() }))
vi.mock('@/lib/analytics', () => ({ trackVacancyView: vi.fn(() => Promise.resolve()) }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn() } }))

import OpportunityDetailPage from '@/pages/OpportunityDetailPage'
import { __resetRoleDetailCache, loadRoleDetail, warmRoleDetail } from '@/lib/roleDetail'
import { __resetPrefetchRole, prefetchRole } from '@/lib/prefetchRole'

const role = {
  id: ROLE_ID, title: 'Goalkeeper for the first team', status: 'open', club_id: 'c1', opportunity_type: 'player', gender: 'Women',
  location_city: 'Dublin', location_country: 'Ireland', description: 'x',
  club: { id: 'c1', full_name: 'Test Club', avatar_url: null, is_test_account: false, role: 'club', current_club: null, coach_current_role: null, womens_league_division: null, mens_league_division: null },
  world_club: null,
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/opportunities/${ROLE_ID}`]}>
      <Routes><Route path="/opportunities/:id" element={<OpportunityDetailPage />} /></Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mocks.single.mockReset()
  __resetRoleDetailCache()
  __resetPrefetchRole()
})
afterEach(() => { vi.unstubAllGlobals() })

describe('role page prefetch', () => {
  it('dedupes: several triggers for one role make one read', async () => {
    mocks.single.mockResolvedValue({ data: role, error: null })
    prefetchRole(ROLE_ID, 'viewport')
    prefetchRole(ROLE_ID, 'hover')
    prefetchRole(ROLE_ID, 'press')
    await act(async () => { await Promise.resolve() })
    await warmRoleDetail(ROLE_ID)
    expect(mocks.single).toHaveBeenCalledTimes(1)
  })

  it('skips everything when the device asks to save data', () => {
    vi.stubGlobal('navigator', { ...navigator, connection: { saveData: true } })
    prefetchRole(ROLE_ID, 'press')
    expect(mocks.single).not.toHaveBeenCalled()
  })

  it('caps reads in flight at 2 and queues the rest', async () => {
    let release: () => void = () => {}
    mocks.single.mockImplementation(() => new Promise((r) => { release = () => r({ data: role, error: null }) }))
    prefetchRole('a', 'viewport'); prefetchRole('b', 'viewport'); prefetchRole('c', 'viewport')
    expect(mocks.single).toHaveBeenCalledTimes(2)
    release()
    await waitFor(() => expect(mocks.single).toHaveBeenCalledTimes(3))
  })

  it('a failed warm read is not kept: the page reads again', async () => {
    mocks.single.mockResolvedValueOnce({ data: null, error: { message: 'TypeError: Failed to fetch', code: '' } })
    await warmRoleDetail(ROLE_ID)
    mocks.single.mockResolvedValueOnce({ data: role, error: null })
    const r = await loadRoleDetail(ROLE_ID)
    expect(r.data).toEqual(role)
    expect(mocks.single).toHaveBeenCalledTimes(2)
  })

  it('the page renders from the warmed read without a second request', async () => {
    mocks.single.mockResolvedValue({ data: role, error: null })
    await warmRoleDetail(ROLE_ID)
    renderPage()
    expect(await screen.findByTestId('role-title')).toHaveTextContent('Goalkeeper for the first team')
    expect(mocks.single).toHaveBeenCalledTimes(1)
  })

  it('shows a layout-matched skeleton, not a spinner, while loading', async () => {
    mocks.single.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(screen.getByTestId('role-detail-skeleton')).toBeInTheDocument()
    expect(document.querySelector('.animate-spin')).toBeNull()
  })
})

describe('role page failed read', () => {
  it('a network failure shows the retry state, and Try again refetches', async () => {
    mocks.single.mockResolvedValueOnce({ data: null, error: { message: 'TypeError: Failed to fetch', details: '', hint: '', code: '' } })
    renderPage()
    const state = await screen.findByTestId('role-load-failed')
    expect(state).toHaveTextContent('Couldn’t reach HOCKIA. Check your connection and try again.')
    expect(screen.queryByText('Opportunity Not Found')).toBeNull()
    mocks.single.mockResolvedValueOnce({ data: role, error: null })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByTestId('role-title')).toHaveTextContent('Goalkeeper for the first team')
    expect(mocks.single).toHaveBeenCalledTimes(2)
  })

  it('a real missing role still reads as not found', async () => {
    mocks.single.mockResolvedValueOnce({ data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' } })
    renderPage()
    expect(await screen.findByText('Opportunity Not Found')).toBeInTheDocument()
    expect(screen.queryByTestId('role-load-failed')).toBeNull()
  })
})
