import { useEffect, useLayoutEffect } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * Pre-release QA finding, 2026-08-17. TermsGate wraps every route, including
 * /auth/callback — the transient page an OAuth or magic-link return lands on.
 * Gating it parked first-time users behind a full-screen Terms modal on a page
 * that says nothing, while the callback's own navigation to /complete-profile
 * was blocked underneath. Two of eight Google signups in the prior 14 days
 * had a confirmed account, no profile, and zero page views — they quit there.
 *
 * The gate must let /auth/callback through and re-arm on the next route.
 */
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  user: { id: 'u-1' } as { id: string } | null,
}))
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }))
// TermsGate reads the store two ways: the hook (subscription) and
// useAuthStore.getState() (synchronous first-frame decision) — mock both.
vi.mock('@/lib/auth', () => {
  const useAuthStore = () => ({ user: mocks.user })
  useAuthStore.getState = () => ({ user: mocks.user })
  return { useAuthStore }
})
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), debug: vi.fn(), warn: vi.fn() } }))

import TermsGate from '@/components/TermsGate'

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <TermsGate>
        <div>APP CONTENT</div>
      </TermsGate>
    </MemoryRouter>,
  )

describe('TermsGate — never blocks the auth callback', () => {
  beforeEach(() => {
    localStorage.clear()
    mocks.user = { id: 'u-1' }
    // DB says: NOT accepted yet
    mocks.rpc.mockResolvedValue({ data: false, error: null })
  })

  it('/auth/callback: renders children immediately, no Terms modal, no RPC round-trip', async () => {
    renderAt('/auth/callback')
    await waitFor(() => expect(screen.getByText('APP CONTENT')).toBeInTheDocument())
    expect(screen.queryByText(/terms of use/i)).not.toBeInTheDocument()
    expect(mocks.rpc).not.toHaveBeenCalledWith('has_accepted_terms', expect.anything())
  })

  it('/complete-profile: the gate is STILL required (modal shown, children hidden)', async () => {
    renderAt('/complete-profile')
    await waitFor(() => expect(screen.getByText(/terms of use/i)).toBeInTheDocument())
    expect(screen.queryByText('APP CONTENT')).not.toBeInTheDocument()
    expect(mocks.rpc).toHaveBeenCalledWith('has_accepted_terms', expect.anything())
  })

  it('logged-out visitor on any route is never gated', async () => {
    mocks.user = null
    renderAt('/community')
    await waitFor(() => expect(screen.getByText('APP CONTENT')).toBeInTheDocument())
    expect(screen.queryByText(/terms of use/i)).not.toBeInTheDocument()
  })
})

/**
 * Launch-flicker fix, 2026-08-17: TermsGate used to boot `accepted: null` and
 * return null until its first effect flushed — which blanked the WHOLE app
 * (this gate wraps every route) for React's first commit on every cold start.
 * The first frame must now be decided synchronously.
 *
 * Observation technique: layout effects of commit 1 fire BEFORE passive
 * effects of commit 1. If the gate's children mount in the FIRST commit, a
 * child's useLayoutEffect runs before a sibling's useEffect; if the gate
 * blanks the first frame, the child can only mount in a later commit, after
 * the sibling's passive effect. The recorded order is the proof.
 */
describe('TermsGate — no blank first frame', () => {
  const mountFirstCommitProbe = (path: string) => {
    const seq: string[] = []
    function SiblingPassive() {
      useEffect(() => { seq.push('sibling-passive') }, [])
      return null
    }
    function ChildLayout() {
      useLayoutEffect(() => { seq.push('child-layout') }, [])
      return null
    }
    render(
      <MemoryRouter initialEntries={[path]}>
        <SiblingPassive />
        <TermsGate>
          <ChildLayout />
          <div>APP CONTENT</div>
        </TermsGate>
      </MemoryRouter>,
    )
    return seq
  }

  beforeEach(() => {
    localStorage.clear()
    mocks.rpc.mockClear()
    mocks.rpc.mockResolvedValue({ data: false, error: null })
  })

  it('cold start (store still hydrating, no user yet): children render in React\'s FIRST commit', () => {
    mocks.user = null
    const seq = mountFirstCommitProbe('/')
    expect(seq.indexOf('child-layout')).toBeGreaterThanOrEqual(0)
    expect(seq.indexOf('child-layout')).toBeLessThan(seq.indexOf('sibling-passive'))
  })

  it('member with acceptance already in localStorage: first commit, no blank, no RPC', () => {
    mocks.user = { id: 'u-1' }
    localStorage.setItem('hockia-terms-u-1-1.0', 'accepted')
    const seq = mountFirstCommitProbe('/dashboard/profile')
    expect(seq.indexOf('child-layout')).toBeLessThan(seq.indexOf('sibling-passive'))
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('ENFORCEMENT UNCHANGED — known user without local acceptance: children stay hidden until the DB answers, then the modal shows', async () => {
    mocks.user = { id: 'u-1' }
    const seq = mountFirstCommitProbe('/dashboard/profile')
    // NOT in the first commit — the gate may not leak content it cannot vouch for
    expect(seq.filter(s => s === 'child-layout')).toHaveLength(0)
    await waitFor(() => expect(screen.getByText(/terms of use/i)).toBeInTheDocument())
    expect(screen.queryByText('APP CONTENT')).not.toBeInTheDocument()
  })
})
