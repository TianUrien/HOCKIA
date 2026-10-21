import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase', () => ({ supabase: { rpc } }))

import { WorldClubNearDuplicates } from '@/features/admin/components/WorldClubNearDuplicates'

describe('Admin World: possible duplicate clubs', () => {
  it('runs only on Check, then lists the pairs read-only', async () => {
    rpc.mockResolvedValue({
      data: [{ a_id: 'a', a_name: 'Club One HC', b_id: 'b', b_name: 'Club One Hockey Club', country_name: 'Testland', similarity: 0.72, a_is_claimed: true, b_is_claimed: false }],
      error: null,
    })
    render(<WorldClubNearDuplicates />)
    expect(screen.getByText(/Merging is manual for now/)).toBeInTheDocument()
    expect(rpc).not.toHaveBeenCalled()
    await userEvent.setup().click(screen.getByRole('button', { name: /check/i }))
    expect(rpc).toHaveBeenCalledWith('admin_world_club_near_duplicates', { p_threshold: 0.6, p_limit: 200 })
    expect(await screen.findByText('Club One Hockey Club')).toBeInTheDocument()
    expect(screen.getByText('72%')).toBeInTheDocument()
    expect(screen.getByText('(claimed)')).toBeInTheDocument()
  })

  it('shows the error from a refused call', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Unauthorized: admin access required' } })
    render(<WorldClubNearDuplicates />)
    await userEvent.setup().click(screen.getByRole('button', { name: /check/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Unauthorized')
  })
})
