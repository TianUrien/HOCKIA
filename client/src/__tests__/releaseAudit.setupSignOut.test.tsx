/**
 * Release audit 2026-10-05 · a way out of onboarding.
 *
 * While onboarding_completed is false the route gate sends every path,
 * /settings included, back to /complete-profile — and no set-up screen had a
 * sign-out. Someone who picked the wrong role (locked after the choice) or
 * the wrong Google account was stuck. Every set-up screen now carries a quiet
 * "Sign out" that calls the store's global sign-out and lands on the landing
 * page, where a fresh sign-in or sign-up is possible.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const user = { id: 'u-1', email: 'new@example.com', created_at: '2026-10-01T00:00:00Z', user_metadata: {} }
  const profile: { current: Record<string, unknown> | null } = { current: null }
  const signOut = vi.fn(async () => undefined)
  return { user, profile, signOut }
})

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { refreshSession: async () => ({ error: null }) },
    rpc: vi.fn(async () => ({ data: null, error: null })),
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'u-1' }, error: null }) }) }),
      update: () => ({ eq: async () => ({ error: null }) }),
    })),
    storage: { from: () => ({ upload: vi.fn(), getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
  },
  SUPABASE_URL: 'http://localhost',
  AUTH_STORAGE_KEY: 'hockia-auth',
}))
vi.mock('@/lib/auth', () => {
  const state = () => ({
    user: mocks.user,
    profile: mocks.profile.current,
    profileStatus: mocks.profile.current ? 'loaded' : 'missing',
    loading: false,
    profileFetchedAt: 1,
    fetchProfile: vi.fn(async () => undefined),
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
vi.mock('@/lib/analytics', () => ({
  trackRoleSelected: vi.fn(), trackOnboardingStart: vi.fn(), trackOnboardingComplete: vi.fn(),
}))
vi.mock('@/lib/trackDbEvent', () => ({ trackDbEvent: vi.fn(), consumeWallIntent: () => null }))
vi.mock('@/lib/attribution', () => ({ getAttributionSnapshot: () => null, getAttributionState: () => null, submitSignupAttribution: vi.fn() }))
vi.mock('@/lib/profile', () => ({ invalidateProfile: vi.fn(async () => undefined) }))
vi.mock('@/lib/toast', () => ({ useToastStore: (sel: (s: { addToast: () => void }) => unknown) => sel({ addToast: vi.fn() }) }))
vi.mock('@/lib/openToPlay', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/openToPlay')>()), setOpenToPlay: vi.fn() }))
vi.mock('@/hooks/useCountries', () => ({ useCountries: () => ({ countries: [], loading: false, getCountryById: () => undefined }) }))
vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => true }))
vi.mock('@/hooks/usePendingStorageCleanup', () => ({ usePendingStorageCleanup: () => ({ queue: vi.fn(), unqueue: vi.fn(), flush: vi.fn(async () => undefined) }) }))
vi.mock('@/components/LocationAutocomplete', () => ({ default: ({ label }: { label: string }) => <label>{label}<input /></label> }))
vi.mock('@/components/WorldClubSearch', () => ({ default: ({ label }: { label: string }) => <label>{label}<input /></label> }))
vi.mock('@/components/CountrySelect', () => ({ default: ({ label }: { label: string }) => <label>{label}<input /></label> }))
vi.mock('@/components/DateOfBirthPicker', () => ({ default: () => null }))
vi.mock('@/components/profile/mobile/PlayerLeagueField', () => ({ PlayerLeagueField: () => <p>League</p> }))
vi.mock('@/components/profile/mobile/LinkClubScreen', () => ({ default: () => <div>link club</div> }))
vi.mock('@/components', () => ({
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
import ChooseRoleScreen from '@/components/onboarding/ChooseRoleScreen'
import PlayerSetupFlow from '@/components/onboarding/PlayerSetupFlow'
import CoachSetupFlow from '@/components/onboarding/CoachSetupFlow'
import ClubSetupFlow from '@/components/club/ClubSetupFlow'
import { SetupSignOut } from '@/components/onboarding/SetupSignOut'

function LocationProbe() {
  const { pathname } = useLocation()
  return <div data-testid="loc">{pathname}</div>
}

const mount = (ui: React.ReactElement) =>
  render(
    <MemoryRouter initialEntries={['/complete-profile']}>
      <LocationProbe />
      <Routes>
        <Route path="/complete-profile" element={ui} />
        <Route path="/" element={<div>LANDING</div>} />
        <Route path="/signup" element={<div>SIGNUP</div>} />
      </Routes>
    </MemoryRouter>,
  )

beforeEach(() => {
  mocks.signOut.mockReset()
  mocks.signOut.mockResolvedValue(undefined)
  mocks.profile.current = null
  localStorage.clear()
})

describe('every set-up screen offers a quiet Sign out', () => {
  it('Choose your role', () => {
    mount(<ChooseRoleScreen onSelect={() => undefined} />)
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })

  it('player set-up, step 1', async () => {
    mocks.profile.current = { id: 'u-1', role: 'player', onboarding_completed: false }
    mount(<PlayerSetupFlow onFinished={() => undefined} />)
    expect(await screen.findByRole('heading', { name: 'About you' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })

  it('coach set-up, step 1', async () => {
    mocks.profile.current = { id: 'u-1', role: 'coach', onboarding_completed: false }
    mount(<CoachSetupFlow onFinished={() => undefined} />)
    expect(await screen.findByRole('heading', { name: 'About you' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })

  it('club set-up, step 1', async () => {
    mocks.profile.current = { id: 'u-1', role: 'club', onboarding_completed: false }
    mount(<ClubSetupFlow onFinished={() => undefined} />)
    expect(await screen.findByRole('heading', { name: 'About your club' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })

  it('the classic form (umpire)', async () => {
    mocks.profile.current = { id: 'u-1', role: 'umpire', onboarding_completed: false, email: 'new@example.com' }
    mount(<CompleteProfile />)
    expect(await screen.findByText('Complete Umpire Profile')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })
})

describe('the action itself', () => {
  it('signs out through the auth store and lands on the landing page', async () => {
    mount(<SetupSignOut />)
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(mocks.signOut).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('/'))
    expect(screen.getByText('LANDING')).toBeInTheDocument()
  })

  it('still leaves the screen when the global sign-out throws (the store has already cleared the local session)', async () => {
    mocks.signOut.mockRejectedValueOnce(new Error('network down'))
    mount(<SetupSignOut placement="footer" />)
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(screen.getByText('LANDING')).toBeInTheDocument())
  })
})
