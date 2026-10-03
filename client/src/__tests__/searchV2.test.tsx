import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Search v2 (Figma 42:195, founder rulings 2026-10-03): the phone /search
 * screen is one flat ranked list of members with a role pill per row, an
 * "Ask Hockia AI about …" row that prefills Hockia AI, recent searches on
 * an empty query, and a "No members match" state. Rows never carry fit,
 * level, score, counts or reply times.
 */

// ── mocks ───────────────────────────────────────────────────────────────────
let rpcResults: unknown[] = []
let rpcPeopleCount = 0
const rpc = vi.fn(async () => ({
  data: {
    results: rpcResults,
    total: rpcPeopleCount,
    type_counts: { posts: 0, people: rpcPeopleCount, clubs: 0, brands: 0, opportunities: 0 },
  },
  error: null,
}))
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...args: unknown[]) => rpc(...(args as [])) } }))
vi.mock('@/hooks/useMemberFlags', () => ({
  useMemberFlags: () => ({ 'p-1': { id: 1, code: 'IT', name: 'Italy', flag_emoji: '🇮🇹' } }),
}))
vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => true }))
vi.mock('@/lib/trackDbEvent', () => ({ trackDbEvent: vi.fn() }))
vi.mock('@/lib/analytics', () => ({ trackSearch: vi.fn() }))

import { SearchV2Screen } from '@/components/search/SearchV2Screen'
import { memberMetaLine, memberProfilePath, seeAllMembersLabel } from '@/lib/searchV2'

const RECENT_KEY = 'hockia_recent_searches'

function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="location">{loc.pathname + loc.search}</div>
}

function renderSearch(initial = '/search') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/search" element={<><SearchV2Screen /><LocationProbe /></>} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const members = [
  { result_type: 'person', profile_id: 'c-1', full_name: 'Lazio Hockey', avatar_url: null, role: 'club', bio: null, position: null, base_location: 'Roma, Italy', current_club: null },
  { result_type: 'person', profile_id: 'p-1', full_name: 'Gino Romani', avatar_url: null, role: 'player', bio: null, position: 'forward', base_location: 'Roma', current_club: 'Lazio Hockey' },
  { result_type: 'person', profile_id: 'k-1', full_name: 'Marco Bianchi', avatar_url: null, role: 'coach', bio: null, position: 'head_coach', base_location: null, current_club: 'Lazio Hockey' },
  { result_type: 'person', profile_id: 'u-1', full_name: 'Dana Rossi', avatar_url: null, role: 'umpire', bio: null, position: null, base_location: 'Milano, Italy', current_club: null },
  { result_type: 'person', profile_id: 'b-1', full_name: 'Stick Co', avatar_url: null, role: 'brand', bio: null, position: null, base_location: 'Torino, Italy', current_club: null },
]

beforeEach(() => {
  rpc.mockClear()
  rpcResults = members
  rpcPeopleCount = 9
  localStorage.clear()
})

describe('Search v2 — results', () => {
  it('asks the people branch of search_content and renders one ranked list with a role pill per row', async () => {
    renderSearch('/search?q=Lazio')
    const list = await screen.findByTestId('search-v2-results')
    expect(rpc).toHaveBeenCalledWith('search_content', expect.objectContaining({ p_query: 'Lazio', p_type: 'people' }))

    const rows = within(list).getAllByTestId('search-v2-row')
    expect(rows).toHaveLength(5)
    // RPC order is the ranking: every role lives in the same list.
    expect(rows.map((r) => r.querySelector('span.block.font-semibold')?.textContent)).toEqual([
      'Lazio Hockey', 'Gino Romani', 'Marco Bianchi', 'Dana Rossi', 'Stick Co',
    ])
    expect(rows.map((r) => within(r).getByText(/^(Player|Coach|Club|Brand|Umpire)$/).textContent)).toEqual([
      'Club', 'Player', 'Coach', 'Umpire', 'Brand',
    ])
    // Second line: position/role · club (+ flag), location for organisations.
    expect(within(rows[1]).getByText('Forward · Lazio Hockey')).toBeInTheDocument()
    expect(within(rows[1]).getByAltText('Italy')).toBeInTheDocument()
    expect(within(rows[2]).getByText('Head coach · Lazio Hockey')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Roma, Italy')).toBeInTheDocument()
  })

  it('rows never show counts, fit, level, score or reply times', async () => {
    renderSearch('/search?q=Lazio')
    const list = await screen.findByTestId('search-v2-results')
    expect(list.textContent).not.toMatch(/\d/)
    expect(list.textContent).not.toMatch(/fit|level|score|repl(y|ies)|views?|followers?|match(es)?\b/i)
    expect(list.querySelector('[data-testid="fit-chip"]')).toBeNull()
  })

  it('"See all N members" opens Community with the query', async () => {
    renderSearch('/search?q=Lazio')
    const seeAll = await screen.findByTestId('search-v2-see-all')
    expect(seeAll).toHaveTextContent('See all 9 members')
    fireEvent.click(seeAll)
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/community?q=Lazio'))
    expect(JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')).toEqual(['Lazio'])
  })

  it('tapping a row opens the member’s public profile by role', async () => {
    renderSearch('/search?q=Lazio')
    const list = await screen.findByTestId('search-v2-results')
    fireEvent.click(within(list).getAllByTestId('search-v2-row')[0])
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/clubs/id/c-1?ref=search'))
  })
})

describe('Search v2 — Ask Hockia AI', () => {
  it('shows the row as soon as there is a query and opens Hockia AI with it prefilled', async () => {
    renderSearch('/search?q=Lazio')
    const ai = await screen.findByTestId('search-v2-ask-ai')
    expect(ai).toHaveTextContent('Ask Hockia AI about “Lazio”')
    expect(ai).toHaveTextContent('Players, coaches, clubs, brands and umpires')
    fireEvent.click(ai)
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/discover?q=Lazio'))
  })

  it('stays available when nothing matches, under the no-results copy', async () => {
    rpcResults = []
    rpcPeopleCount = 0
    renderSearch('/search?q=Zzzq')
    expect(await screen.findByTestId('search-v2-empty')).toHaveTextContent('No members match “Zzzq”')
    expect(screen.getByTestId('search-v2-ask-ai')).toBeInTheDocument()
    expect(screen.queryByTestId('search-v2-see-all')).toBeNull()
  })
})

describe('Search v2 — empty query', () => {
  it('lists recent searches (max 5) with Clear, and re-runs one on tap', async () => {
    localStorage.setItem(RECENT_KEY, JSON.stringify(['Lazio', 'Amsterdam', 'Goalkeeper']))
    renderSearch('/search')
    expect(screen.getByText('Players, coaches, clubs, brands and umpires')).toBeInTheDocument()
    expect(screen.queryByTestId('search-v2-ask-ai')).toBeNull()
    const recent = screen.getByRole('region', { name: 'Recent searches' })
    expect(within(recent).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Lazio', 'Amsterdam', 'Goalkeeper'])
    expect(rpc).not.toHaveBeenCalled()

    fireEvent.click(within(recent).getByText('Amsterdam'))
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('search_content', expect.objectContaining({ p_query: 'Amsterdam' })))
    expect(screen.getByTestId('search-v2-input')).toHaveValue('Amsterdam')
  })

  it('Clear empties the list and the storage', () => {
    localStorage.setItem(RECENT_KEY, JSON.stringify(['Lazio']))
    renderSearch('/search')
    fireEvent.click(screen.getByText('Clear'))
    expect(screen.queryByRole('region', { name: 'Recent searches' })).toBeNull()
    expect(JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')).toEqual([])
  })

  it('shows the scope line and no list without recent searches', () => {
    renderSearch('/search')
    expect(screen.getByText('Players, coaches, clubs, brands and umpires')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Recent searches' })).toBeNull()
    expect(screen.queryByTestId('search-v2-results')).toBeNull()
  })
})

describe('Search v2 — helpers and wiring', () => {
  it('memberMetaLine: people read position · club, organisations read location, nothing is padded', () => {
    expect(memberMetaLine({ role: 'player', position: 'midfielder', currentClub: 'HC Rotterdam' })).toBe('Midfielder · HC Rotterdam')
    expect(memberMetaLine({ role: 'coach', position: 'Head Coach', currentClub: null, baseLocation: 'Lima' })).toBe('Head Coach')
    expect(memberMetaLine({ role: 'club', position: null, currentClub: null, baseLocation: 'Roma, Italy' })).toBe('Roma, Italy')
    expect(memberMetaLine({ role: 'umpire', position: null, baseLocation: 'Milano' })).toBe('Milano')
    expect(memberMetaLine({ role: 'player', position: null, currentClub: null, baseLocation: null })).toBe('')
  })

  it('memberProfilePath keeps the id fallback routes and the search ref', () => {
    expect(memberProfilePath('brand', 'b1')).toBe('/brands/id/b1?ref=search')
    expect(memberProfilePath('umpire', 'u1')).toBe('/umpires/id/u1?ref=search')
    expect(memberProfilePath('coach', 'k1')).toBe('/coaches/id/k1?ref=search')
    expect(memberProfilePath('nonsense', 'x1')).toBe('/players/id/x1?ref=search')
    expect(seeAllMembersLabel(1)).toBe('See 1 member in Community')
  })

  it('/search switches on the phone breakpoint; the header icon opens /search', () => {
    const page = readFileSync(resolve(__dirname, '../pages/SearchPage.tsx'), 'utf8')
    expect(page).toMatch(/useMediaQuery\('\(max-width: 1023px\)'\)/)
    expect(page).toMatch(/isPhone \? <SearchV2Screen \/> : <DesktopSearchPage \/>/)
    const header = readFileSync(resolve(__dirname, '../components/Header.tsx'), 'utf8')
    expect(header).toMatch(/handleNavigate\('\/search'\)/)
    expect(header).not.toMatch(/openSearchOverlay/)
  })
})
