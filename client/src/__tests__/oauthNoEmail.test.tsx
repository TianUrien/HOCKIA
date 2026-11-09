import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, afterEach } from 'vitest'

/**
 * Facebook accounts made with a phone number have no email, and Supabase
 * refuses to create the account ("Error getting user email from external
 * provider"). Retrying never helps, so the member is told why and offered
 * email sign-up (2026-11-09, before Facebook sign-in goes live).
 */
vi.mock('@/lib/supabase', () => ({
  AUTH_STORAGE_KEY: 'hockia-auth',
  supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: null }, error: null })), onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })) } },
}))
vi.mock('@/lib/auth', () => {
  const state = { user: null, profile: null, loading: false, profileStatus: 'idle' }
  const useAuthStore = (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state)
  useAuthStore.getState = () => state
  useAuthStore.subscribe = () => () => {}
  return { useAuthStore, AUTH_STORAGE_KEY: 'hockia-auth' }
})
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), debug: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/sentryHelpers', () => ({ reportSupabaseError: vi.fn() }))

import { oauthErrorMessage, NO_EMAIL_MESSAGE } from '@/lib/oauthErrorMessage'
import AuthCallback from '@/pages/AuthCallback'

describe('oauthErrorMessage', () => {
  it('names the missing email for the Supabase provider error', () => {
    expect(oauthErrorMessage('Error getting user email from external provider', 'x')).toBe(NO_EMAIL_MESSAGE)
  })
  it('keeps the fallback for anything else', () => {
    expect(oauthErrorMessage('access_denied', 'Sign-in failed. Please try again.')).toBe('Sign-in failed. Please try again.')
    expect(oauthErrorMessage(null, 'fallback')).toBe('fallback')
  })
})

describe('AuthCallback · Facebook account without email', () => {
  afterEach(() => { window.history.replaceState({}, '', '/') })

  it('says why and offers email sign-up instead of "Try Again"', async () => {
    window.history.replaceState({}, '', '/auth/callback#error=server_error&error_code=unexpected_failure&error_description=Error+getting+user+email+from+external+provider')
    render(<MemoryRouter initialEntries={['/auth/callback']}><AuthCallback /></MemoryRouter>)
    expect(await screen.findByTestId('auth-no-email')).toBeInTheDocument()
    expect(screen.getByText(NO_EMAIL_MESSAGE)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign up with email' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try Again' })).not.toBeInTheDocument()
  })

  it('also reads the error from the query string', async () => {
    window.history.replaceState({}, '', '/auth/callback?error=server_error&error_description=Error+getting+user+email+from+external+provider')
    render(<MemoryRouter initialEntries={['/auth/callback']}><AuthCallback /></MemoryRouter>)
    expect(await screen.findByTestId('auth-no-email')).toBeInTheDocument()
  })
})
