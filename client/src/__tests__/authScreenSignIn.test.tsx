/**
 * AuthScreen is sign-in only since the account-first onboarding
 * (2026-10-03); layout per Figma "Landing v3" Log in 127:2141 / 127:2204
 * (6 Oct 2026). These pin:
 *   - OAuth first, email form visible IMMEDIATELY (no collapse link — a
 *     returning member with a password must not pay an extra tap),
 *   - "Forgot password?" present,
 *   - OAuth on sign-in tracks `login` and never stashes a pending_role,
 *   - no sign-up Terms line, no role / DOB fields.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'

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
  trackLoginFailed: vi.fn(),
  trackSignUpStart: mocks.trackSignUpStart,
  trackSignUp: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({
  useAuthStore: () => ({ user: null, profile: null, profileStatus: 'idle', loading: false }),
}))
vi.mock('@/lib/magicLink', () => ({ sendMagicLink: vi.fn() }))
vi.mock('@/lib/rateLimit', () => ({
  checkLoginRateLimit: vi.fn(),
  checkSignupRateLimit: vi.fn(),
  formatRateLimitError: vi.fn(),
}))
vi.mock('@/lib/sentryHelpers', () => ({ reportAuthFlowError: vi.fn() }))
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { signInWithPassword: vi.fn(), signInWithOAuth: vi.fn() } },
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

describe('AuthScreen — Log in (Figma 114:477)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('OAuth first, email + password visible immediately, Forgot password present', () => {
    render(<AuthScreen />)
    const buttons = screen.getAllByRole('button')
    expect(buttons[1]).toHaveTextContent(/continue with apple/i)
    expect(buttons[2]).toHaveTextContent(/continue with google/i)
    expect(screen.getByPlaceholderText('you@example.com')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    const forgot = screen.getByRole('link', { name: /forgot password/i })
    expect(forgot).toHaveAttribute('href', '/forgot-password')
    // Web v3 Link button: brand text, 14 semibold, on the password label row.
    expect(forgot).toHaveClass('text-brand-primary', 'font-semibold')
    // One Primary Large (52 pill), full width.
    expect(screen.getByRole('button', { name: /^log in$/i })).toHaveClass('h-[52px]', 'w-full', 'rounded-full', 'bg-brand-primary')
    // OAuth pills: Apple black, Google white with the 1.5 px line-strong border.
    expect(buttons[1]).toHaveClass('h-[52px]', 'rounded-full', 'bg-surface-inverse')
    expect(buttons[2]).toHaveClass('h-[52px]', 'rounded-full', 'border-line-strong')
    // Fields: surface-muted, radius 14, 52 tall, no border; "Show" toggle inside.
    expect(screen.getByLabelText('Password')).toHaveClass('h-[52px]', 'rounded-[14px]', 'bg-surface-muted')
    expect(screen.getByRole('button', { name: /show password/i })).toHaveTextContent('Show')
    // Phone top bar: back = Ghost icon button 44 with the chevron; centred logo.
    expect(screen.getByRole('button', { name: /back to start/i })).toHaveClass('h-11', 'w-11', 'rounded-full')
    expect(screen.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument()
    expect(screen.getByText('Log in to your Hockia profile.')).toBeInTheDocument()
    // Sign-up-only things never appear here.
    expect(screen.queryByText(/by continuing, you agree/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/date of birth/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /sign up with email/i })).not.toBeInTheDocument()
  })

  it('OAuth on sign-in tracks login and does NOT stash pending_role', async () => {
    const user = userEvent.setup()
    render(<AuthScreen />)
    await user.click(screen.getByRole('button', { name: /continue with google/i }))
    expect(localStorage.getItem('pending_role')).toBeNull()
    expect(mocks.startOAuthSignIn).toHaveBeenCalledWith('google')
    expect(mocks.trackLogin).toHaveBeenCalledWith('google')
    expect(mocks.trackSignUpStart).not.toHaveBeenCalled()
  })

  it('offers the magic-link fallback and the sign-up link', async () => {
    const user = userEvent.setup()
    render(<AuthScreen />)
    expect(screen.getByRole('link', { name: /create an account/i })).toHaveAttribute('href', '/signup')
    expect(screen.getByText(/New to HOCKIA\?/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /email me a link instead/i }))
    expect(screen.getByRole('button', { name: /email me a sign-in link/i })).toBeInTheDocument()
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
  })
})
