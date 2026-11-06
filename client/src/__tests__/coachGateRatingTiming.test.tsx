import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'

const rpc = vi.fn()
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a), from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }) } }))
vi.mock('@/lib/trackDbEvent', () => ({ trackDbEvent: vi.fn() }))
vi.mock('@/lib/appRating', async (orig) => ({ ...(await orig<typeof import('@/lib/appRating')>()), APP_RATING_ENABLED: true }))
vi.mock('@/components/club/PostRoleScreen', () => ({ default: () => <div data-testid="post-role" /> }))

type P = { id: string; role: string; coach_recruits_for_team?: boolean }
const auth: { profile: P | null } = { profile: null }
vi.mock('@/lib/auth', () => ({ useAuthStore: (sel: (s: unknown) => unknown) => sel({ profile: auth.profile, refreshProfile: vi.fn() }) }))

import { PostRoleEntry } from '@/pages/ClubRecruitingRoutes'
import AppRatingPrompt, { RATING_SESSION_DELAY_MS } from '@/components/AppRatingPrompt'

const renderPost = () => render(
  <MemoryRouter initialEntries={['/dashboard/opportunities/new']}>
    <Routes><Route path="/dashboard/opportunities/new" element={<PostRoleEntry />} /></Routes>
  </MemoryRouter>,
)

describe('Post an opportunity: a coach who only looks for a role confirms first (iOS audit 2026-11-06)', () => {
  it('a candidate coach sees "Do you recruit players for a team?", not the form', async () => {
    auth.profile = { id: 'c1', role: 'coach', coach_recruits_for_team: false }
    renderPost()
    expect(await screen.findByTestId('recruit-confirm', {}, { timeout: 8000 })).toBeInTheDocument()
    expect(screen.queryByTestId('post-role')).toBeNull()
  })
  it('a recruiting coach and a club go straight to the form', async () => {
    auth.profile = { id: 'c2', role: 'coach', coach_recruits_for_team: true }
    const { unmount } = renderPost()
    expect(await screen.findByTestId('post-role', {}, { timeout: 8000 })).toBeInTheDocument()
    unmount()
    auth.profile = { id: 'k1', role: 'club' }
    renderPost()
    expect(await screen.findByTestId('post-role', {}, { timeout: 8000 })).toBeInTheDocument()
  })
})

describe('Rating prompt waits for a settled session (iOS audit 2026-11-06)', () => {
  beforeEach(() => { vi.useFakeTimers(); rpc.mockReset(); rpc.mockResolvedValue({ data: { show: false }, error: null }) })
  afterEach(() => vi.useRealTimers())

  let go: (to: string) => void = () => {}
  function Nav() { const n = useNavigate(); go = (to) => n(to); return null }
  const renderPrompt = () => render(<MemoryRouter initialEntries={['/home']}><Nav /><AppRatingPrompt /></MemoryRouter>)
  const asked = () => rpc.mock.calls.some((c) => c[0] === 'should_show_app_rating_prompt')

  it('never asks on the first screen right after opening the app', () => {
    renderPrompt()
    act(() => { vi.advanceTimersByTime(RATING_SESSION_DELAY_MS + 1000) })
    expect(asked()).toBe(false)
  })
  it('asks once the member has moved on and a minute has passed', () => {
    renderPrompt()
    act(() => { go('/community') })
    act(() => { vi.advanceTimersByTime(RATING_SESSION_DELAY_MS - 1000) })
    expect(asked()).toBe(false)
    act(() => { vi.advanceTimersByTime(2000) })
    expect(asked()).toBe(true)
  })
})
