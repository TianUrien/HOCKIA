/**
 * Release audit 2026-10-05 · the Terms modal's own links must work.
 *
 * The modal says "you agree to our Terms & Conditions and Privacy Policy" and
 * each is a button that navigates to /terms or /privacy-policy. TermsGate
 * wraps every route, and neither legal page was in its ungated list, so the
 * navigation happened underneath a modal that immediately re-rendered on top
 * of it — tapping a link did nothing visible. The legal pages are static,
 * non-UGC content: they must be readable before accepting.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  user: { id: 'u-1' } as { id: string } | null,
}))
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }))
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
        <Routes>
          <Route path="/home" element={<div>HOME CONTENT</div>} />
          <Route path="/terms" element={<div>TERMS PAGE</div>} />
          <Route path="/privacy-policy" element={<div>PRIVACY PAGE</div>} />
          <Route path="/terms-of-anything" element={<div>LOOK-ALIKE PAGE</div>} />
        </Routes>
      </TermsGate>
    </MemoryRouter>,
  )

describe('TermsGate — the modal links open the legal pages', () => {
  beforeEach(() => {
    localStorage.clear()
    mocks.user = { id: 'u-1' }
    mocks.rpc.mockResolvedValue({ data: false, error: null }) // not accepted yet
  })

  it('shows the modal on a member page before acceptance', async () => {
    renderAt('/home')
    expect(await screen.findByText('Terms of Use')).toBeInTheDocument()
    expect(screen.queryByText('HOME CONTENT')).not.toBeInTheDocument()
  })

  it('"Terms & Conditions" opens /terms with no modal on top', async () => {
    renderAt('/home')
    await userEvent.click(await screen.findByRole('button', { name: 'Terms & Conditions' }))
    await waitFor(() => expect(screen.getByText('TERMS PAGE')).toBeInTheDocument())
    expect(screen.queryByText('Terms of Use')).not.toBeInTheDocument()
  })

  it('"Privacy Policy" opens /privacy-policy with no modal on top', async () => {
    renderAt('/home')
    await userEvent.click(await screen.findByRole('button', { name: 'Privacy Policy' }))
    await waitFor(() => expect(screen.getByText('PRIVACY PAGE')).toBeInTheDocument())
    expect(screen.queryByText('Terms of Use')).not.toBeInTheDocument()
  })

  it('a direct visit to either legal page is never gated and needs no RPC', async () => {
    for (const [path, text] of [['/terms', 'TERMS PAGE'], ['/privacy-policy', 'PRIVACY PAGE']] as const) {
      mocks.rpc.mockClear()
      const view = renderAt(path)
      await waitFor(() => expect(view.getByText(text)).toBeInTheDocument())
      expect(view.queryByText('Terms of Use')).not.toBeInTheDocument()
      expect(mocks.rpc).not.toHaveBeenCalledWith('has_accepted_terms', expect.anything())
      view.unmount()
    }
  })

  it('a prefix look-alike (/terms-of-anything) stays gated', async () => {
    renderAt('/terms-of-anything')
    expect(await screen.findByText('Terms of Use')).toBeInTheDocument()
    expect(screen.queryByText('LOOK-ALIKE PAGE')).not.toBeInTheDocument()
  })
})
