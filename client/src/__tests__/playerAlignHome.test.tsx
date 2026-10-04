/** Player alignment round 1 — Home Your week (Figma 313:632): three ink-1 cells, views first on the phone. */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

const phone = { value: true }
// CI's unit job has no Supabase env: never load the real client.
vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn(), auth: { getSession: vi.fn() } } }))
vi.mock('@/lib/auth', () => ({ useAuthStore: (sel?: (s: unknown) => unknown) => { const s = { profile: { id: 'p1', role: 'player' } }; return sel ? sel(s) : s } }))
vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => phone.value }))
vi.mock('@/hooks/useWeeklyVisibility', () => ({ useWeeklyVisibility: () => ({ loading: false, visibility: { views_7d: 12 } }) }))
vi.mock('@/hooks/useOpportunitiesForYou', () => ({ useOpportunitiesForYou: () => ({ loading: false, mode: 'matched', items: [{}, {}, {}, {}, {}, {}] }) }))
vi.mock('@/hooks/useMyApplications', () => ({ useMyApplications: () => ({ loading: false, applications: [{ status: 'shortlisted' }] }) }))
vi.mock('@/hooks/useRolesHealth', () => ({ useRolesHealth: () => ({ loading: false, totals: {} }) }))
vi.mock('@/hooks/useScopedMatches', () => ({ useScopedMatches: () => ({ loading: false, fitCount: 0 }) }))

import { YourWeekCard } from '@/components/home/YourWeekCard'

describe('Your week (player)', () => {
  it('phone: profile views · roles · club reply, all ink-1 figures', () => {
    phone.value = true
    const { container } = render(<MemoryRouter><YourWeekCard /></MemoryRouter>)
    const labels = Array.from(container.querySelectorAll('.text-caption')).map((n) => n.textContent)
    expect(labels).toEqual(['profile views', 'roles for you', 'club reply'])
    const figures = Array.from(container.querySelectorAll('.text-figure'))
    expect(figures.map((f) => f.textContent)).toEqual(['12', '6', '1'])
    for (const f of figures) {
      expect(f.className).toContain('text-ink-1')
      expect(f.className).not.toContain('hockia-primary')
    }
  })
  it('desktop keeps its order', () => {
    phone.value = false
    render(<MemoryRouter><YourWeekCard /></MemoryRouter>)
    const labels = screen.getAllByText(/profile views|roles for you|club reply/).map((n) => n.textContent)
    expect(labels).toEqual(['roles for you', 'profile views', 'club reply'])
  })
})
