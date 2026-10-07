/**
 * Release audit 2026-10-05 · a failed profile load is not "not onboarded".
 *
 * lib/auth sets profileStatus 'error' on any fetch failure and leaves profile
 * null. CompleteProfile read `!profile?.onboarding_completed` as "start
 * set-up", so a member whose fetch failed (expired token, flaky network;
 * Landing and DashboardRouter both route that case here) saw the set-up
 * wizard, and its step 1 then overwrote full_name / position and nulled
 * avatar_url and secondary_position. Now: a retry screen, and no set-up flow
 * ever mounts without a loaded row.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const user = { id: 'u-1', email: 'member@example.com', created_at: '2026-10-01T00:00:00Z', user_metadata: { role: 'player' } }
  const state = {
    profile: null as Record<string, unknown> | null,
    profileStatus: 'error' as 'idle' | 'fetching' | 'missing' | 'loaded' | 'error',
  }
  const updates: Record<string, unknown>[] = []
  return {
    user,
    state,
    updates,
    fetchProfile: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      update: (patch: Record<string, unknown>) => ({ eq: async () => { updates.push(patch); return { error: null } } }),
    })),
  }
})

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { refreshSession: async () => ({ error: null }) },
    rpc: vi.fn(async () => ({ data: null, error: null })),
    from: mocks.from,
    storage: { from: () => ({ upload: vi.fn(), getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
  },
  SUPABASE_URL: 'http://localhost',
  AUTH_STORAGE_KEY: 'hockia-auth',
}))
vi.mock('@/lib/auth', () => {
  const state = () => ({
    user: mocks.user,
    profile: mocks.state.profile,
    profileStatus: mocks.state.profileStatus,
    loading: false,
    profileFetchedAt: 1,
    fetchProfile: mocks.fetchProfile,
    setProfile: vi.fn(),
    refreshProfile: vi.fn(),
    signOut: mocks.signOut,
  })
  const useAuthStore = Object.assign((selector?: (s: ReturnType<typeof state>) => unknown) => (selector ? selector(state()) : state()), {
    getState: state,
    subscribe: () => () => undefined,
  })
  return { useAuthStore }
})
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }))
vi.mock('@/lib/analytics', () => ({ trackRoleSelected: vi.fn(), trackOnboardingStart: vi.fn(), trackOnboardingComplete: vi.fn() }))
vi.mock('@/lib/trackDbEvent', () => ({ trackDbEvent: vi.fn(), consumeWallIntent: () => null }))
vi.mock('@/lib/attribution', () => ({ getAttributionSnapshot: () => null, getAttributionState: () => null, submitSignupAttribution: vi.fn() }))
vi.mock('@/lib/profile', () => ({ invalidateProfile: vi.fn(async () => undefined) }))
vi.mock('@/hooks/useCountries', () => ({ useCountries: () => ({ countries: [], loading: false, getCountryById: () => undefined }) }))
vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => true }))
vi.mock('@/hooks/usePendingStorageCleanup', () => ({ usePendingStorageCleanup: () => ({ queue: vi.fn(), unqueue: vi.fn(), flush: vi.fn(async () => undefined) }) }))
vi.mock('@/components/onboarding/PlayerSetupFlow', () => ({ default: () => <div data-testid="player-setup">PLAYER SET-UP</div> }))
vi.mock('@/components/onboarding/CoachSetupFlow', () => ({ default: () => <div data-testid="coach-setup">COACH SET-UP</div> }))
vi.mock('@/components/club/ClubSetupFlow', () => ({ default: () => <div data-testid="club-setup">CLUB SET-UP</div> }))
vi.mock('@/components', () => ({
  InAppBrowserWarning: () => null,
  Input: (p: Record<string, unknown>) => <input {...(p as object)} />,
  Button: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
  CountrySelect: () => null,
  LocationAutocomplete: () => null,
  MultiCategorySelector: () => null,
  DateOfBirthPicker: () => null,
}))
vi.mock('@/components/ClubClaimStep', () => ({ default: () => null }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn(), addBreadcrumb: vi.fn(), setTag: vi.fn() }))

import CompleteProfile from '@/pages/CompleteProfile'

const mount = () =>
  render(
    <MemoryRouter initialEntries={['/complete-profile']}>
      <Routes>
        <Route path="/complete-profile" element={<CompleteProfile />} />
        <Route path="/" element={<div>LANDING</div>} />
        <Route path="/dashboard/profile" element={<div>DASHBOARD</div>} />
        <Route path="/signup" element={<div>SIGNUP</div>} />
      </Routes>
    </MemoryRouter>,
  )

beforeEach(() => {
  mocks.state.profile = null
  mocks.state.profileStatus = 'error'
  mocks.updates.length = 0
  mocks.fetchProfile.mockClear()
  mocks.signOut.mockClear()
  localStorage.clear()
})

describe('CompleteProfile when the profile row failed to load', () => {
  it('shows a retry screen — not Choose your role, not a set-up flow', () => {
    mount()
    expect(screen.getByTestId('profile-load-error')).toBeInTheDocument()
    expect(screen.getByText('We couldn’t load your profile')).toBeInTheDocument()
    expect(screen.queryByText('Choose your role')).toBeNull()
    expect(screen.queryByTestId('player-setup')).toBeNull()
    expect(screen.queryByText(/Complete .* Profile/)).toBeNull()
  })

  it('even when a role is known from user_metadata or a stale pending_role', () => {
    localStorage.setItem('pending_role', 'player')
    mount()
    expect(screen.getByTestId('profile-load-error')).toBeInTheDocument()
    expect(screen.queryByTestId('player-setup')).toBeNull()
  })

  it('Retry forces a fresh profile fetch for this user', async () => {
    mount()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(mocks.fetchProfile).toHaveBeenCalledWith('u-1', { force: true })
  })

  it('offers Sign out as the other way out', async () => {
    mount()
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(mocks.signOut).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('LANDING')).toBeInTheDocument()
  })

  it('writes nothing to profiles', () => {
    mount()
    expect(mocks.updates).toEqual([])
  })
})

describe('CompleteProfile with no profile row at all', () => {
  it("'missing' with a stale pending_role still asks for the role instead of mounting the set-up flow", () => {
    mocks.state.profileStatus = 'missing'
    localStorage.setItem('pending_role', 'player')
    mount()
    expect(screen.getByText('Choose your role')).toBeInTheDocument()
    expect(screen.queryByTestId('player-setup')).toBeNull()
    expect(mocks.updates).toEqual([])
  })

  it("'fetching' shows the loading state, nothing else", () => {
    mocks.state.profileStatus = 'fetching'
    mount()
    expect(screen.getByText('Loading your profile...')).toBeInTheDocument()
    expect(screen.queryByText('Choose your role')).toBeNull()
    expect(screen.queryByTestId('profile-load-error')).toBeNull()
  })
})

describe('CompleteProfile with a loaded row', () => {
  it('a player who has not finished onboarding gets the player set-up (lazy-loaded)', async () => {
    mocks.state.profile = { id: 'u-1', role: 'player', onboarding_completed: false }
    mocks.state.profileStatus = 'loaded'
    mount()
    expect(await screen.findByTestId('player-setup')).toBeInTheDocument()
    expect(screen.queryByTestId('profile-load-error')).toBeNull()
  })
})
