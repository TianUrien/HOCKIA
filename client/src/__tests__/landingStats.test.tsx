import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import LandingStats from '@/components/landing/LandingStats'

// The proof strip is the page's credibility claim. Two things must hold:
// the numbers are LIVE (a frozen count on a "we're active" page is a lie),
// and a failed query must NEVER render 0 or an empty state.

const h = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: h.rpc } }))
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), error: vi.fn() } }))

afterEach(() => vi.clearAllMocks())

/** Count-up is rAF-driven; assert on the settled value. */
async function settled(label: RegExp) {
  return waitFor(() => {
    const cell = screen.getByText(label).closest('div')!
    return cell
  })
}

describe('LandingStats', () => {
  it('renders LIVE figures from get_landing_stats', async () => {
    h.rpc.mockResolvedValue({
      data: [{ members: 300, nationalities: 44, clubs_mapped: 290, open_roles: 12 }],
      error: null,
    })
    render(<LandingStats />)
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith('get_landing_stats'))
    await waitFor(() => expect(screen.getByText('300')).toBeInTheDocument(), { timeout: 3000 })
    expect(screen.getByText('290')).toBeInTheDocument()
  })

  it('falls back to last-known figures when the query fails — never 0', async () => {
    h.rpc.mockResolvedValue({ data: null, error: new Error('boom') })
    render(<LandingStats />)
    await waitFor(() => expect(screen.getByText('258')).toBeInTheDocument(), { timeout: 3000 })
    // The failure mode we're guarding: a zeroed-out proof strip.
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('falls back when the RPC throws outright', async () => {
    h.rpc.mockRejectedValue(new Error('network'))
    render(<LandingStats />)
    await waitFor(() => expect(screen.getByText('258')).toBeInTheDocument(), { timeout: 3000 })
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('shows all four labels', async () => {
    h.rpc.mockResolvedValue({ data: [], error: null })
    render(<LandingStats />)
    await settled(/members/i)
    for (const l of [/members/i, /nationalities/i, /clubs mapped/i, /open roles/i]) {
      expect(screen.getByText(l)).toBeInTheDocument()
    }
  })
})
