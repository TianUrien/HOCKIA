/**
 * Founder ruling 2026-10-03: the cookie banner never renders on the auth and
 * onboarding routes — the same bug class as the 2026-08-17 OAuth-return wall,
 * where the install card sat over /signup and this banner over the Terms
 * gate. It still shows on the first ordinary route when no choice was made.
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({ status: null as string | null }))

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }))
vi.mock('@/lib/cookieConsent', () => ({
  getConsentStatus: () => mocks.status,
  enableGA4: vi.fn(),
}))
vi.mock('@/lib/posthog', () => ({ initPostHog: vi.fn() }))

import CookieConsent from '@/components/CookieConsent'

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <CookieConsent />
    </MemoryRouter>,
  )

describe('CookieConsent — never on auth or onboarding routes', () => {
  beforeEach(() => {
    mocks.status = null
  })

  it.each([
    '/signup',
    '/signup/email',
    '/signin',
    '/auth/callback',
    '/verify-email',
    '/complete-profile',
    '/brands/onboarding',
    '/forgot-password',
  ])('hidden on %s even when no choice was made', (path) => {
    renderAt(path)
    expect(screen.queryByRole('region', { name: /cookie consent/i })).not.toBeInTheDocument()
  })

  it.each(['/', '/home', '/community'])('shown on %s when no choice was made', (path) => {
    renderAt(path)
    expect(screen.getByRole('region', { name: /cookie consent/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /accept/i })).toBeInTheDocument()
  })

  it('stays hidden everywhere once a choice was made', () => {
    mocks.status = 'accepted'
    renderAt('/home')
    expect(screen.queryByRole('region', { name: /cookie consent/i })).not.toBeInTheDocument()
  })
})
