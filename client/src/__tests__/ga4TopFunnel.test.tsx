import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))
vi.mock('@/features/admin/api/adminApi', () => ({
  getGa4Funnel: vi.fn(async () => ({
    configured: true,
    counts: { page_view_landing: 400, signup_cta_click: 40, protected_action_blocked: 30, signup_wall_action_clicked: 5, sign_up_start: 18 },
  })),
}))

import { Ga4TopFunnel } from '@/features/admin/components/Ga4TopFunnel'

describe('GA4 top funnel (Analytics review 2026-10-18)', () => {
  it('shows a step % only where a step is a true subset of its parent', async () => {
    render(<Ga4TopFunnel />)
    await screen.findByText('Sign-up started')
    expect(screen.getByText(/10% from Landing page viewed/)).toBeInTheDocument() // 40 of 400
    expect(screen.getByText(/17% from Sign-up wall shown/)).toBeInTheDocument() // 5 of 30
    // Sign-up started (18) is bigger than "Wall → clicked to join" (5): never "100% from Wall".
    expect(screen.queryByText(/from Wall → clicked to join/)).toBeNull()
    expect(screen.getByText(/From any entry point/)).toBeInTheDocument()
  })
})
