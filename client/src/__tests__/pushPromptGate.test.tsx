/**
 * The notification ask (design audit 2026-10-21, A1): a bottom sheet shown
 * once per member, only after a moment of intent (Apply, posting a role, a
 * first message), never on the auth and onboarding routes, never while
 * another overlay is up, and never again once seen.
 *
 * Onboarding QA 2026-10-04 still holds: it needs a signed-in member with
 * onboarding complete, never a per-device "onboarding completed" flag.
 */
import type { ReactNode } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({ state: { user: null, profile: null } as { user: unknown; profile: unknown } }))
vi.mock('@/lib/auth', () => ({
  useAuthStore: (sel: (s: typeof auth.state) => unknown) => sel(auth.state),
}))
const push = vi.hoisted(() => ({ isSupported: true, isSubscribed: false, permission: 'default', loading: false, subscribe: vi.fn() }))
vi.mock('@/hooks/usePushSubscription', () => ({
  usePushSubscription: () => push,
}))
vi.mock('@/lib/analytics', () => ({
  trackPushSubscribe: vi.fn(),
  trackPushPromptShown: vi.fn(),
  trackPushPromptDismiss: vi.fn(),
}))

import PushPrompt, { PUSH_ASK_BODY } from '@/components/PushPrompt'
import { useBottomPrompt } from '@/lib/bottomPrompt'
import { COOKIE_BANNER_OVERLAY, TERMS_GATE_OVERLAY } from '@/lib/overlaySequence'
import { __resetPushAskForTests, pushAskDone, requestPushAsk, shouldShowPushAsk, type PushAskGate } from '@/lib/pushAsk'

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

const sheet = () => screen.queryByText('Stay in the loop')

describe('PushPrompt: once per member, only after a moment of intent', () => {
  beforeEach(() => {
    localStorage.clear()
    __resetPushAskForTests()
    auth.state = { ...member }
    push.isSubscribed = false
    push.permission = 'default'
  })

  it('never shows on an ordinary screen without a moment of intent', () => {
    renderAt('/home')
    expect(sheet()).not.toBeInTheDocument()
  })

  it('opens as a sheet after a moment of intent, with the approved copy', async () => {
    requestPushAsk('apply')
    renderAt('/opportunities/abc')
    expect(await screen.findByText('Stay in the loop')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Stay in the loop' })).toBeInTheDocument()
    expect(screen.getByText(PUSH_ASK_BODY)).toBeInTheDocument()
    expect(PUSH_ASK_BODY).toBe('Get notified about messages, applications and opportunities, even when the app is closed.')
    expect(PUSH_ASK_BODY).not.toContain('—')
    expect(screen.getByRole('button', { name: 'Turn on notifications' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument()
  })

  it('opens when the moment happens while mounted', async () => {
    renderAt('/messages')
    expect(sheet()).not.toBeInTheDocument()
    act(() => requestPushAsk('first_message'))
    expect(await screen.findByText('Stay in the loop')).toBeInTheDocument()
  })

  it('Not now closes it for good: a later moment never reopens it for this member', async () => {
    requestPushAsk('apply')
    const { unmount } = renderAt('/opportunities/abc')
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }))
    expect(sheet()).not.toBeInTheDocument()
    expect(pushAskDone('u1')).toBe(true)
    unmount()
    requestPushAsk('first_message')
    renderAt('/messages')
    expect(sheet()).not.toBeInTheDocument()
  })

  it('is per member: another member on the same device can still be asked once', async () => {
    localStorage.setItem('hockia-push-ask-done:u1', '1')
    auth.state = { user: { id: 'u2' }, profile: { id: 'u2', onboarding_completed: true } }
    requestPushAsk('role_posted')
    renderAt('/dashboard')
    expect(await screen.findByText('Stay in the loop')).toBeInTheDocument()
  })

  it('hidden for a logged-out visitor even with the old device flag set', () => {
    localStorage.setItem('hockia-onboarding-completed', '1')
    auth.state = { user: null, profile: null }
    requestPushAsk('apply')
    renderAt('/home')
    expect(sheet()).not.toBeInTheDocument()
  })

  it('hidden for a signed-in user whose onboarding is not complete', () => {
    auth.state = { user: { id: 'u1' }, profile: { id: 'u1', onboarding_completed: false } }
    requestPushAsk('apply')
    renderAt('/home')
    expect(sheet()).not.toBeInTheDocument()
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
    requestPushAsk('apply')
    renderAt(path)
    expect(sheet()).not.toBeInTheDocument()
  })

  it('waits while the Terms gate or the cookie banner is showing', async () => {
    requestPushAsk('apply')
    const { unmount } = renderAt('/home', <Claim id={TERMS_GATE_OVERLAY} />)
    await new Promise((r) => setTimeout(r, 10))
    expect(sheet()).not.toBeInTheDocument()
    unmount()
    renderAt('/home', <Claim id={COOKIE_BANNER_OVERLAY} />)
    await new Promise((r) => setTimeout(r, 10))
    expect(sheet()).not.toBeInTheDocument()
  })

  it('never shows to a member already subscribed', async () => {
    push.isSubscribed = true
    requestPushAsk('apply')
    renderAt('/home')
    await new Promise((r) => setTimeout(r, 10))
    expect(sheet()).not.toBeInTheDocument()
  })
})

describe('shouldShowPushAsk', () => {
  const base: PushAskGate = {
    moment: 'apply', done: false, supported: true, subscribed: false, permission: 'default',
    signedIn: true, onboarded: true, onHiddenRoute: false, otherOverlay: false,
  }
  it('shows only with a moment and nothing in the way', () => {
    expect(shouldShowPushAsk(base)).toBe(true)
    expect(shouldShowPushAsk({ ...base, moment: null })).toBe(false)
    expect(shouldShowPushAsk({ ...base, done: true })).toBe(false)
    expect(shouldShowPushAsk({ ...base, permission: 'denied' })).toBe(false)
    expect(shouldShowPushAsk({ ...base, permission: 'granted' })).toBe(false)
    expect(shouldShowPushAsk({ ...base, otherOverlay: true })).toBe(false)
    expect(shouldShowPushAsk({ ...base, supported: false })).toBe(false)
  })
})
