/**
 * AuthScreen — pins the localStorage stash that survives the OAuth round-trip.
 *
 * Background: Vincent (Android Closed Testing) reported that after picking a
 * role and tapping "Continue with Google", the signup flow looped back to
 * the role selection screen. SignUp.tsx kept `selectedRole` only in React
 * state, which was wiped when Capacitor's Chrome Custom Tab → Google →
 * deep-link callback round-tripped through a fresh component mount.
 *
 * Fix: handleOAuth writes `pending_role` (and `pending_email` if typed) to
 * localStorage before initiating OAuth, mirroring the existing
 * password-signup path. CompleteProfile reads this back via its role
 * fallback chain.
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'

// vi.mock factories are hoisted to the top of the file, so any helper they
// reference must also be hoisted. vi.hoisted() is the canonical workaround.
const mocks = vi.hoisted(() => ({
  startOAuthSignIn: vi.fn(() => Promise.resolve()),
  trackSignUpStart: vi.fn(),
  trackLogin: vi.fn(),
}))

vi.mock('@/lib/oauthSignIn', () => ({ startOAuthSignIn: mocks.startOAuthSignIn }))
vi.mock('@/lib/inAppBrowser', () => ({
  supportsReliableOAuth: () => true,
  detectInAppBrowser: () => ({ isInAppBrowser: false, browserName: null }),
}))
vi.mock('@/lib/analytics', () => ({
  trackLogin: mocks.trackLogin,
  trackSignUpStart: mocks.trackSignUpStart,
  trackSignUp: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({
  useAuthStore: () => ({
    user: null,
    profile: null,
    profileStatus: 'idle',
    loading: false,
  }),
}))
vi.mock('@/lib/magicLink', () => ({ sendMagicLink: vi.fn() }))
vi.mock('@/lib/rateLimit', () => ({
  checkLoginRateLimit: vi.fn(),
  checkSignupRateLimit: vi.fn(),
  formatRateLimitError: vi.fn(),
}))
vi.mock('@/lib/sentryHelpers', () => ({ reportAuthFlowError: vi.fn() }))
vi.mock('@/lib/siteUrl', () => ({ getAuthRedirectUrl: () => 'http://localhost/auth/callback' }))
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      signUp: vi.fn(),
      signInWithPassword: vi.fn(),
      signInWithOAuth: vi.fn(),
    },
  },
}))
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))
vi.mock('@sentry/react', () => ({
  setTag: vi.fn(),
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}))
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ search: '', pathname: '/signup', hash: '' }),
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))

import AuthScreen from '@/pages/AuthScreen'

describe('AuthScreen — handleOAuth stashes role across the redirect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('writes pending_role to localStorage when signup OAuth starts (so the role survives the Google round-trip)', async () => {
    const user = userEvent.setup()
    render(<AuthScreen mode="signup" role="player" />)

    await user.click(screen.getByRole('button', { name: /continue with google/i }))

    expect(localStorage.getItem('pending_role')).toBe('player')
    expect(mocks.startOAuthSignIn).toHaveBeenCalledWith('google')
  })

  it('also stashes pending_email when the user has typed one before clicking Google', async () => {
    const user = userEvent.setup()
    render(<AuthScreen mode="signup" role="coach" />)

    // Email field is shared between magic-link and OAuth flows.
    await user.type(screen.getByPlaceholderText('you@example.com'), 'tester@example.com')
    await user.click(screen.getByRole('button', { name: /continue with google/i }))

    expect(localStorage.getItem('pending_role')).toBe('coach')
    expect(localStorage.getItem('pending_email')).toBe('tester@example.com')
  })

  it('does NOT stash pending_role for SIGN-IN OAuth (existing users already have a role on their profile)', async () => {
    const user = userEvent.setup()
    render(<AuthScreen mode="signin" />)

    await user.click(screen.getByRole('button', { name: /continue with google/i }))

    expect(localStorage.getItem('pending_role')).toBeNull()
    expect(mocks.trackLogin).toHaveBeenCalledWith('google')
    expect(mocks.trackSignUpStart).not.toHaveBeenCalled()
  })

  it('stashes for Apple OAuth too, not just Google', async () => {
    const user = userEvent.setup()
    render(<AuthScreen mode="signup" role="umpire" />)

    await user.click(screen.getByRole('button', { name: /continue with apple/i }))

    expect(localStorage.getItem('pending_role')).toBe('umpire')
    expect(mocks.startOAuthSignIn).toHaveBeenCalledWith('apple')
  })
})
