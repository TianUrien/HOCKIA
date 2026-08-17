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
vi.mock('@/lib/auth', () => ({ useAuthStore: () => ({ user: mocks.user }) }))
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
