import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * Launch-screen flicker (founder report, 2026-08-17): a signed-in member
 * opening the app saw the unauthenticated welcome ("Create account") for
 * <1s before the redirect fired, because the welcome rendered while the
 * auth store was still hydrating the persisted session.
 *
 * The contract under test — first frame chosen from SYNCHRONOUS evidence:
 *   hydrating + stored session  → splash continuation, NEVER the welcome
 *   hydrating + nothing stored  → welcome immediately (fresh install)
 *   resolved  + user            → splash while redirecting, never welcome
 *   resolved  + no user         → welcome (expired/invalid stored session)
 * No timers, no artificial delay — the gate is the persisted-session check.
 */
const mocks = vi.hoisted(() => ({
  auth: {
    user: null as { id: string } | null,
    profile: null as { id: string } | null,
    profileStatus: 'idle',
    loading: true,
  },
  navigate: vi.fn(),
  trackDbEvent: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ useAuthStore: () => mocks.auth }))
vi.mock('@/lib/nativeUi', () => ({ setStatusBarForBackground: vi.fn(() => Promise.resolve()) }))
vi.mock('@/lib/analytics', () => ({ trackSignupCtaClick: vi.fn() }))
vi.mock('@/lib/trackDbEvent', () => ({ trackDbEvent: mocks.trackDbEvent }))
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => mocks.navigate }
})

import NativeWelcome from '@/pages/NativeWelcome'
import { AUTH_STORAGE_KEY } from '@/lib/supabase'

const storeSession = () =>
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_at: 0 }))

const renderWelcome = () =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <NativeWelcome />
    </MemoryRouter>,
  )

const welcomeVisible = () => screen.queryByRole('link', { name: /create account/i }) !== null
const splashVisible = () => screen.queryByTestId('native-launch-splash') !== null

describe('NativeWelcome — launch frame selection', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    vi.clearAllMocks()
    mocks.auth.user = null
    mocks.auth.profile = null
    mocks.auth.profileStatus = 'idle'
    mocks.auth.loading = true
  })

  it('COLD LAUNCH, signed in: hydrating + stored session → splash, never the welcome', () => {
    storeSession()
    renderWelcome()
    expect(splashVisible()).toBe(true)
    expect(welcomeVisible()).toBe(false)
    // and no welcome page_view is logged for a member passing through
    expect(mocks.trackDbEvent).not.toHaveBeenCalledWith(
      'page_view', undefined, undefined, expect.objectContaining({ surface: 'native_welcome' }),
    )
  })

  it('COLD LAUNCH, fresh install: hydrating + nothing stored → welcome immediately, zero delay', () => {
    renderWelcome()
    expect(welcomeVisible()).toBe(true)
    expect(splashVisible()).toBe(false)
    expect(mocks.trackDbEvent).toHaveBeenCalledWith(
      'page_view', undefined, undefined, expect.objectContaining({ surface: 'native_welcome' }),
    )
  })

  it('RESOLVED, authenticated: splash while the redirect runs — welcome never paints', () => {
    storeSession()
    mocks.auth.loading = false
    mocks.auth.user = { id: 'u1' }
    mocks.auth.profile = { id: 'u1' }
    renderWelcome()
    expect(splashVisible()).toBe(true)
    expect(welcomeVisible()).toBe(false)
    expect(mocks.navigate).toHaveBeenCalledWith('/dashboard/profile', { replace: true })
  })

  it('RESOLVED, authenticated, pre-login redirect stashed: goes THERE, still no welcome', () => {
    storeSession()
    sessionStorage.setItem('hockia-redirect-after-login', '/opportunities')
    mocks.auth.loading = false
    mocks.auth.user = { id: 'u1' }
    mocks.auth.profile = { id: 'u1' }
    renderWelcome()
    expect(welcomeVisible()).toBe(false)
    expect(mocks.navigate).toHaveBeenCalledWith('/opportunities', { replace: true })
  })

  it('EXPIRED/REVOKED stored session: hydration resolves signed-out → welcome, no redirect loop', () => {
    storeSession() // token was stored…
    mocks.auth.loading = false // …but hydration finished and produced no user
    renderWelcome()
    expect(welcomeVisible()).toBe(true)
    expect(splashVisible()).toBe(false)
    expect(mocks.navigate).not.toHaveBeenCalled()
  })

  it('garbage in storage reads as no session → welcome during hydration', () => {
    localStorage.setItem(AUTH_STORAGE_KEY, '{not json')
    renderWelcome()
    expect(welcomeVisible()).toBe(true)
  })

  it('half-signed-up (user, no profile): no welcome; routed to onboarding once resolved', () => {
    storeSession()
    mocks.auth.loading = false
    mocks.auth.user = { id: 'u1' }
    mocks.auth.profileStatus = 'missing'
    renderWelcome()
    expect(welcomeVisible()).toBe(false)
    expect(mocks.navigate).toHaveBeenCalledWith('/complete-profile', { replace: true })
  })
})
