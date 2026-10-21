/**
 * Sign-in on a dropped connection (Sentry JAVASCRIPT-REACT-CV, 2026-10-21):
 * supabase-js returns the fetch failure as `AuthRetryableFetchError` instead
 * of throwing, and the screen used to answer "Incorrect email or password."
 * and count it as bad credentials. It now names the connection, and the
 * funnel counts it as `network`. A real bad password still reads as before.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  trackLoginFailed: vi.fn(),
  resetCaptcha: vi.fn(),
}))

vi.mock('@/lib/oauthSignIn', () => ({ startOAuthSignIn: vi.fn() }))
vi.mock('@/hooks/useFacebookLoginEnabled', () => ({ useFacebookLoginEnabled: () => false }))
vi.mock('@/lib/inAppBrowser', () => ({
  supportsReliableOAuth: () => true,
  supportsOAuthProvider: () => true,
  facebookLoginEnabled: () => false,
  detectInAppBrowser: () => ({ isInAppBrowser: false, browserName: null }),
}))
vi.mock('@/lib/analytics', () => ({
  trackLogin: vi.fn(),
  trackLoginFailed: mocks.trackLoginFailed,
  trackSignUpStart: vi.fn(),
  trackSignUp: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({
  useAuthStore: () => ({ user: null, profile: null, profileStatus: 'idle', loading: false }),
}))
vi.mock('@/lib/magicLink', () => ({ sendMagicLink: vi.fn() }))
vi.mock('@/lib/rateLimit', () => ({
  checkLoginRateLimit: vi.fn(() => Promise.resolve(null)),
  checkSignupRateLimit: vi.fn(),
  formatRateLimitError: vi.fn(),
}))
vi.mock('@/lib/captcha', () => ({
  getCaptchaToken: vi.fn(() => Promise.resolve('token')),
  warmCaptcha: vi.fn(),
  resetCaptcha: mocks.resetCaptcha,
  CAPTCHA_FAILED_COPY: 'We couldn’t finish the security check. Check your connection and try again.',
  captchaErrorMessage: (m?: string) => (m && /captcha/i.test(m) ? 'captcha' : null),
}))
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { signInWithPassword: mocks.signInWithPassword, signInWithOAuth: vi.fn() } },
}))
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ search: '', pathname: '/signin', hash: '' }),
  Link: ({ children, to, className }: { children: React.ReactNode; to: string; className?: string }) => <a href={to} className={className}>{children}</a>,
}))

import AuthScreen from '@/pages/AuthScreen'

async function submit(email = 'member@example.com', password = 'secret-password') {
  const user = userEvent.setup()
  render(<AuthScreen />)
  await user.type(screen.getByPlaceholderText('you@example.com'), email)
  await user.type(screen.getByLabelText('Password'), password)
  await user.click(screen.getByRole('button', { name: /^log in$/i }))
}

describe('AuthScreen — sign-in on a failed connection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('names the connection when the request never reached Supabase, and counts it as network', async () => {
    const error = Object.assign(new Error('Failed to fetch'), { name: 'AuthRetryableFetchError', status: 0 })
    mocks.signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error })
    await submit()
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t reach HOCKIA. Check your connection and try again.'))
    expect(mocks.trackLoginFailed).toHaveBeenCalledWith('password', 'network')
    expect(screen.queryByText('Incorrect email or password.')).not.toBeInTheDocument()
  })

  it('keeps "Incorrect email or password." for a real credentials error', async () => {
    const error = Object.assign(new Error('Invalid login credentials'), { name: 'AuthApiError', status: 400 })
    mocks.signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error })
    await submit()
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Incorrect email or password.'))
    expect(mocks.trackLoginFailed).toHaveBeenCalledWith('password', 'bad_credentials')
  })

  it('a refused bot check is not a dead end: Try again resets the widget and signs in', async () => {
    const error = Object.assign(new Error('captcha protection: request disallowed (no captcha response)'), { name: 'AuthApiError', status: 400 })
    mocks.signInWithPassword.mockResolvedValueOnce({ data: { user: null, session: null }, error })
    mocks.signInWithPassword.mockResolvedValueOnce({ data: { user: { id: 'u1' }, session: {} }, error: null })
    await submit()
    const card = await screen.findByTestId('captcha-failed')
    expect(card).toHaveTextContent('We couldn’t finish the security check. Check your connection and try again.')
    expect(card).toHaveTextContent('You can also continue with Apple or Google above.')
    expect(mocks.trackLoginFailed).toHaveBeenCalledWith('password', 'captcha')
    expect(screen.queryByText('Incorrect email or password.')).not.toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(mocks.signInWithPassword).toHaveBeenCalledTimes(2))
    expect(mocks.resetCaptcha).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByTestId('captcha-failed')).not.toBeInTheDocument())
  })

  it('names the connection when the call throws a network TypeError (Safari "Load failed")', async () => {
    mocks.signInWithPassword.mockRejectedValue(new TypeError('Load failed'))
    await submit()
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t reach HOCKIA. Check your connection and try again.'))
    expect(mocks.trackLoginFailed).toHaveBeenCalledWith('password', 'network')
  })
})
