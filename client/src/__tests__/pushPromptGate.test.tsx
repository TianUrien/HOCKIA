/**
 * Onboarding QA 2026-10-04: the "Stay in the loop" push card rendered over a
 * logged-out /signup because it read a per-device "onboarding completed"
 * flag. It now needs a signed-in member with onboarding complete, and never
 * renders on the auth and onboarding routes.
 */
import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({ state: { user: null, profile: null } as { user: unknown; profile: unknown } }))
vi.mock('@/lib/auth', () => ({
  useAuthStore: (sel: (s: typeof auth.state) => unknown) => sel(auth.state),
}))
vi.mock('@/hooks/usePushSubscription', () => ({
  usePushSubscription: () => ({ isSupported: true, isSubscribed: false, permission: 'default', loading: false, subscribe: vi.fn() }),
}))
vi.mock('@/lib/analytics', () => ({
  trackPushSubscribe: vi.fn(),
  trackPushPromptShown: vi.fn(),
  trackPushPromptDismiss: vi.fn(),
}))

import PushPrompt from '@/components/PushPrompt'
import { useBottomPrompt } from '@/lib/bottomPrompt'
import { COOKIE_BANNER_OVERLAY, TERMS_GATE_OVERLAY } from '@/lib/overlaySequence'

const member = { user: { id: 'u1' }, profile: { id: 'u1', onboarding_completed: true } }

function Claim({ id }: { id: string }) {
  useBottomPrompt(id, true)
  return null
}

const renderAt = (path: string, extra: ReactNode = null) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      {extra}
      <PushPrompt />
    </MemoryRouter>,
  )

const card = () => screen.queryByText('Stay in the loop')

describe('PushPrompt — member-only, never on auth/onboarding routes', () => {
  beforeEach(() => {
    localStorage.clear()
    auth.state = { ...member }
  })

  it('hidden on /signup for a logged-out visitor even with the old device flag set', () => {
    localStorage.setItem('hockia-onboarding-completed', '1')
    auth.state = { user: null, profile: null }
    renderAt('/signup')
    expect(card()).not.toBeInTheDocument()
  })

  it('hidden for a logged-out visitor on an ordinary route with the device flag set', () => {
    localStorage.setItem('hockia-onboarding-completed', '1')
    auth.state = { user: null, profile: null }
    renderAt('/home')
    expect(card()).not.toBeInTheDocument()
  })

  it('hidden for a signed-in user whose onboarding is not complete', () => {
    auth.state = { user: { id: 'u1' }, profile: { id: 'u1', onboarding_completed: false } }
    renderAt('/home')
    expect(card()).not.toBeInTheDocument()
  })

  it.each([
    '/signup',
    '/signup/email',
    '/signin',
    '/auth/callback',
    '/verify-email',
    '/complete-profile',
    '/forgot-password',
    '/reset-password',
  ])('hidden on %s even for an onboarded member', (path) => {
    renderAt(path)
    expect(card()).not.toBeInTheDocument()
  })

  it('shown to an onboarded member on an ordinary route', () => {
    renderAt('/home')
    expect(card()).toBeInTheDocument()
  })

  it('waits while the Terms gate or the cookie banner is showing', () => {
    const { unmount } = renderAt('/home', <Claim id={TERMS_GATE_OVERLAY} />)
    expect(card()).not.toBeInTheDocument()
    unmount()
    renderAt('/home', <Claim id={COOKIE_BANNER_OVERLAY} />)
    expect(card()).not.toBeInTheDocument()
  })

  it('stays hidden inside the 3-day dismiss window', () => {
    localStorage.setItem('push-prompt-dismissed', String(Date.now()))
    renderAt('/home')
    expect(card()).not.toBeInTheDocument()
  })
})
