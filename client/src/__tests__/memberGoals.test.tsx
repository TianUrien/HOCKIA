import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const rpc = vi.fn()
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }))
const track = vi.fn()
vi.mock('@/lib/trackDbEvent', () => ({ trackDbEvent: (...a: unknown[]) => track(...a) }))
vi.mock('@/lib/haptics', () => ({ hapticLight: vi.fn() }))
vi.mock('@/hooks/useCountries', () => ({ useCountries: () => ({ getCountryById: () => ({ id: 46, name: 'United Kingdom', common_name: null }) }) }))
vi.mock('@/lib/auth', () => ({
  useAuthStore: (sel: (s: unknown) => unknown) => sel({ user: { id: 'u1' }, profile: { role: 'player', base_country_id: 46 } }),
}))

import { goalRows, goalTitle } from '@/lib/memberGoals'
import { GoalCard } from '@/components/home/goal/GoalCard'

const wrap = (ui: React.ReactNode) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>,
)

beforeEach(() => { rpc.mockReset(); track.mockReset() })

describe('goal card rows: real data only (Figma G3 / G5)', () => {
  it('player: roles abroad for their position; a row without data is hidden', () => {
    expect(goalRows('player', { options: ['play_abroad', 'get_sponsor'] }, { roles_abroad: 12, roles_home: 5, position: 'midfielder' }, 'United Kingdom'))
      .toEqual([{ key: 'abroad', goal: 'play_abroad', text: '12 open opportunities abroad for midfielders', action: 'See', to: '/opportunities' }])
    expect(goalRows('player', { options: ['play_abroad'] }, { roles_abroad: 0 }, 'England')).toEqual([])
    expect(goalRows('player', { options: ['club_near_me'] }, { roles_home: 1 }, 'Netherlands')[0].text).toBe('1 open opportunity in the Netherlands')
  })
  it('never shows the Phase 4 rows (sponsor, ambassadors)', () => {
    expect(goalRows('player', { options: ['get_sponsor'] }, { roles_abroad: 3 }, 'England')).toEqual([])
    expect(goalRows('brand', { options: ['find_ambassadors'] }, {}, 'England')).toEqual([])
  })
  it('club: open opportunities and applicants waiting, then post another; no roles = post a role', () => {
    const rows = goalRows('club', { options: ['fill_role'] }, { open_roles: 2, applicants_waiting: 4 }, null)
    expect(rows.map((r) => r.text)).toEqual(['2 open opportunities · 4 applicants waiting', 'Post another opportunity in under a minute'])
    expect(goalRows('club', { options: ['fill_role'] }, { open_roles: 0 }, null)[0].text).toBe('Post an opportunity in under a minute')
  })
  it('title joins the picks in option order, then the member’s words', () => {
    expect(goalTitle('player', { options: ['get_sponsor', 'play_abroad'], other_text: 'Play in Germany' })).toBe('Play abroad · Get a sponsor · Play in Germany')
  })
})

describe('goal ask card (G1)', () => {
  it('no disabled button: only Later until something is picked; at most three picks', async () => {
    rpc.mockImplementation(async (fn: string) => (fn === 'get_my_goal' ? { data: [{ options: [], other_text: null, set_at: null, later_count: 0, should_ask: true }], error: null } : { data: null, error: null }))
    wrap(<GoalCard />)
    await screen.findByTestId('home-goal-ask')
    expect(screen.queryByTestId('goal-save')).toBeNull()
    expect(screen.getByTestId('goal-later')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('goal-option-play_abroad'))
    fireEvent.click(screen.getByTestId('goal-option-move_up'))
    fireEvent.click(screen.getByTestId('goal-option-get_sponsor'))
    fireEvent.click(screen.getByTestId('goal-option-keep_playing'))
    expect(screen.getByTestId('goal-option-keep_playing')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('goal-save')).toHaveTextContent('That’s my goal · 3 of 3')
    fireEvent.click(screen.getByTestId('goal-save'))
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('set_my_goal', { p_options: ['play_abroad', 'move_up', 'get_sponsor'], p_other_text: null }))
    expect(track).toHaveBeenCalledWith('goal_set', 'member_goal', undefined, expect.objectContaining({ count: 3, has_text: false, role: 'player', surface: 'home' }))
  })

  it('Later hides the card and tells the server', async () => {
    rpc.mockImplementation(async (fn: string) => (fn === 'get_my_goal' ? { data: [{ options: [], other_text: null, set_at: null, later_count: 0, should_ask: true }], error: null } : { data: 1, error: null }))
    wrap(<GoalCard />)
    fireEvent.click(await screen.findByTestId('goal-later'))
    expect(screen.queryByTestId('home-goal-ask')).toBeNull()
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('goal_later'))
  })

  it('renders nothing when the member declined twice', async () => {
    rpc.mockResolvedValue({ data: [{ options: [], other_text: null, set_at: null, later_count: 2, should_ask: false }], error: null })
    const { container } = wrap(<GoalCard />)
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('get_my_goal'))
    expect(container.querySelector('[data-testid^="home-goal"]')).toBeNull()
  })
})
