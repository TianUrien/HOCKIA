/**
 * Founder rulings 2026-10-04: post-onboarding overlays come ONE AT A TIME.
 * Terms gate first; the cookie banner waits until Terms are accepted; the
 * install card never shows on the first app visit after onboarding and never
 * while the Terms gate or the cookie banner is visible.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  user: { id: 'u-1' } as { id: string } | null,
  consent: null as string | null,
}))
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: mocks.rpc,
    from: () => ({ upsert: () => Promise.resolve({ error: null }) }),
  },
}))
vi.mock('@/lib/auth', () => {
  const state = () => ({ user: mocks.user })
  const useAuthStore = (sel?: (s: ReturnType<typeof state>) => unknown) => (sel ? sel(state()) : state())
  useAuthStore.getState = state
  return { useAuthStore }
})
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }))
vi.mock('@/lib/cookieConsent', () => ({ getConsentStatus: () => mocks.consent, enableGA4: vi.fn() }))
vi.mock('@/lib/posthog', () => ({ initPostHog: vi.fn() }))
vi.mock('@/lib/analytics', () => ({ trackPwaInstall: vi.fn(), trackPwaInstallDismiss: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), debug: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

import TermsGate from '@/components/TermsGate'
import CookieConsent from '@/components/CookieConsent'
import InstallPrompt from '@/components/InstallPrompt'
import {
  __resetAppSessionForTests,
  currentAppSessionId,
  hasPriorAppSession,
  markOnboardingCompletedOnDevice,
  recordAppVisit,
} from '@/lib/overlaySequence'

const renderApp = (path = '/home') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <InstallPrompt />
      <CookieConsent />
      <TermsGate>
        <div>APP CONTENT</div>
      </TermsGate>
    </MemoryRouter>,
  )

const termsModal = () => screen.queryByText(/terms of use/i)
const cookieBanner = () => screen.queryByRole('region', { name: /cookie consent/i })
const installCard = () => screen.queryByText('Install HOCKIA')

function offerInstall() {
  const event = new Event('beforeinstallprompt') as Event & { prompt: () => Promise<void>; userChoice: Promise<unknown>; platforms: string[] }
  Object.assign(event, { prompt: () => Promise.resolve(), userChoice: Promise.resolve({ outcome: 'dismissed', platform: '' }), platforms: [] })
  act(() => {
    window.dispatchEvent(event)
  })
}

/** Simulates a NEW app session on the same device (new tab / app launch). */
function newSession() {
  sessionStorage.clear()
  __resetAppSessionForTests()
}

describe('first-app-visit bookkeeping', () => {
  beforeEach(() => {
    localStorage.clear()
    newSession()
  })

  it('the first session on a device is not a prior session; the next one is', () => {
    recordAppVisit()
    expect(hasPriorAppSession()).toBe(false)
    newSession()
    recordAppVisit()
    expect(hasPriorAppSession()).toBe(true)
  })

  it('completing onboarding makes the current session the first visit again', () => {
    recordAppVisit()
    newSession()
    expect(hasPriorAppSession()).toBe(true)
    markOnboardingCompletedOnDevice()
    expect(hasPriorAppSession()).toBe(false)
    expect(localStorage.getItem('hockia-onboarding-completed')).toBe('1')
    newSession()
    expect(hasPriorAppSession()).toBe(true)
  })

  it('the session id is stable within a session', () => {
    expect(currentAppSessionId()).toBe(currentAppSessionId())
  })
})

describe('post-onboarding overlays — one at a time', () => {
  beforeEach(() => {
    localStorage.clear()
    newSession()
    mocks.user = { id: 'u-1' }
    mocks.consent = null
    mocks.rpc.mockImplementation((fn: string) =>
      Promise.resolve(fn === 'has_accepted_terms' ? { data: false, error: null } : { data: null, error: null }),
    )
  })

  it('first visit after onboarding: Terms alone, then the cookie banner, never the install card', async () => {
    markOnboardingCompletedOnDevice()
    renderApp()
    offerInstall()

    await waitFor(() => expect(termsModal()).toBeInTheDocument())
    expect(cookieBanner()).not.toBeInTheDocument()
    expect(installCard()).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /i agree/i }))
    await waitFor(() => expect(screen.getByText('APP CONTENT')).toBeInTheDocument())
    await waitFor(() => expect(cookieBanner()).toBeInTheDocument())
    expect(installCard()).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^accept$/i }))
    expect(cookieBanner()).not.toBeInTheDocument()
    // Still the first app visit after onboarding: no install pitch.
    expect(installCard()).not.toBeInTheDocument()
  })

  it('a later session: the install card waits for the cookie banner, then shows', async () => {
    markOnboardingCompletedOnDevice()
    localStorage.setItem('hockia-terms-u-1-1.0', 'accepted')
    newSession()
    renderApp()
    offerInstall()

    await waitFor(() => expect(cookieBanner()).toBeInTheDocument())
    expect(termsModal()).not.toBeInTheDocument()
    expect(installCard()).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^accept$/i }))
    await waitFor(() => expect(installCard()).toBeInTheDocument())
  })

  it('a later session with Terms still pending: nothing else until Terms are accepted', async () => {
    markOnboardingCompletedOnDevice()
    mocks.consent = 'accepted'
    newSession()
    renderApp()
    offerInstall()

    await waitFor(() => expect(termsModal()).toBeInTheDocument())
    expect(installCard()).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /i agree/i }))
    await waitFor(() => expect(installCard()).toBeInTheDocument())
    expect(cookieBanner()).not.toBeInTheDocument()
  })

  it('the hidden-route lists still apply (no install card on /signup)', async () => {
    localStorage.setItem('hockia-first-app-session', 'an-earlier-session')
    mocks.user = null
    mocks.consent = 'accepted'
    renderApp('/signup')
    offerInstall()
    await waitFor(() => expect(screen.getByText('APP CONTENT')).toBeInTheDocument())
    expect(installCard()).not.toBeInTheDocument()
  })
})
