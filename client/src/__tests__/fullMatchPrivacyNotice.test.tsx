import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const m = vi.hoisted(() => ({
  noticeRow: { id: 'notice-1' } as { id: string } | null,
  rpc: vi.fn(),
  update: vi.fn(),
  updateEq: vi.fn(),
  refreshProfile: vi.fn(),
  addToast: vi.fn(),
  role: 'player',
}))

vi.mock('@/lib/supabase', () => {
  const pulseChain = {
    select: () => pulseChain,
    eq: () => pulseChain,
    is: () => pulseChain,
    limit: () => pulseChain,
    maybeSingle: async () => ({ data: m.noticeRow, error: null }),
  }
  return {
    supabase: {
      from: (table: string) => {
        if (table === 'user_pulse_items') return pulseChain
        return { update: (patch: unknown) => { m.update(table, patch); return { eq: (...a: unknown[]) => m.updateEq(...a) } } }
      },
      rpc: (...a: unknown[]) => m.rpc(...a),
    },
  }
})

vi.mock('@/lib/auth', () => {
  const state = () => ({ user: { id: 'player-1' }, profile: { id: 'player-1', role: m.role }, refreshProfile: m.refreshProfile })
  const useAuthStore = (selector?: (s: ReturnType<typeof state>) => unknown) => (selector ? selector(state()) : state())
  return { useAuthStore }
})

vi.mock('@/lib/toast', () => ({
  useToastStore: (selector?: (s: { addToast: typeof m.addToast }) => unknown) => (selector ? selector({ addToast: m.addToast }) : { addToast: m.addToast }),
}))

import { FullMatchPrivacyNotice } from '@/components/home/FullMatchPrivacyNotice'

function renderNotice() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><FullMatchPrivacyNotice /></QueryClientProvider>)
}

describe('FullMatchPrivacyNotice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.noticeRow = { id: 'notice-1' }
    m.role = 'player'
    m.rpc.mockResolvedValue({ data: null, error: null })
    m.updateEq.mockResolvedValue({ error: null })
  })

  it('shows the notice to a player who has not answered it yet', async () => {
    renderNotice()
    expect(await screen.findByText('Your full matches are now for clubs and coaches')).toBeInTheDocument()
    expect(screen.getByText(/Highlights stay public/)).toBeInTheDocument()
  })

  it('renders nothing once answered', async () => {
    m.noticeRow = null
    const { container } = renderNotice()
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('renders nothing for non-players', async () => {
    m.role = 'coach'
    const { container } = renderNotice()
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('"Keep it" dismisses on the server and hides the card, without touching the profile', async () => {
    renderNotice()
    await userEvent.click(await screen.findByRole('button', { name: 'Keep it' }))
    await waitFor(() => expect(m.rpc).toHaveBeenCalledWith('mark_pulse_dismissed', { p_pulse_id: 'notice-1' }))
    expect(m.rpc).not.toHaveBeenCalledWith('mark_pulse_action_completed', expect.anything())
    expect(m.update).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByText('Your full matches are now for clubs and coaches')).not.toBeInTheDocument())
  })

  it('"Make them public" asks first, then writes the master switch and records the action', async () => {
    renderNotice()
    await userEvent.click(await screen.findByRole('button', { name: 'Make them public' }))
    expect(screen.getByText('Make your full matches public?')).toBeInTheDocument()
    expect(m.update).not.toHaveBeenCalled()

    const buttons = screen.getAllByRole('button', { name: 'Make them public' })
    await userEvent.click(buttons[buttons.length - 1])

    await waitFor(() => expect(m.update).toHaveBeenCalledWith('profiles', { full_match_visibility: 'public' }))
    expect(m.updateEq).toHaveBeenCalledWith('id', 'player-1')
    await waitFor(() => expect(m.rpc).toHaveBeenCalledWith('mark_pulse_action_completed', { p_pulse_id: 'notice-1' }))
    expect(m.rpc).toHaveBeenCalledWith('mark_pulse_dismissed', { p_pulse_id: 'notice-1' })
  })

  it('keeps the notice when the save fails', async () => {
    m.updateEq.mockResolvedValue({ error: { message: 'nope' } })
    renderNotice()
    await userEvent.click(await screen.findByRole('button', { name: 'Make them public' }))
    const buttons = screen.getAllByRole('button', { name: 'Make them public' })
    await userEvent.click(buttons[buttons.length - 1])
    await waitFor(() => expect(m.addToast).toHaveBeenCalledWith('Could not save that. Please try again.', 'error'))
    expect(m.rpc).not.toHaveBeenCalled()
    expect(screen.getByText('Your full matches are now for clubs and coaches')).toBeInTheDocument()
  })
})
