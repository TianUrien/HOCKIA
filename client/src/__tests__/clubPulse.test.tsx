import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { beforeEach, describe, it, expect, vi } from 'vitest'

// Both import chains reach @/lib/supabase, which throws at module load
// without env (CI has no .env.local): homeInstrumentation via AiScoutBar,
// and useRolesHealth directly. Mock both boundaries (house pattern).
vi.mock('@/lib/supabase', () => ({ supabase: {} }))
vi.mock('@/lib/homeInstrumentation', () => ({
  useImpressionOnce: () => () => {},
  recordModuleImpression: vi.fn(),
  trackModuleClick: vi.fn(),
}))

import { aggregateRolesHealth, type RoleHealth } from '@/hooks/useRolesHealth'
import { AiScoutBar } from '@/components/home/pulse/AiScoutBar'
import { useHockiaAiSheet } from '@/components/hockiaAi/hockiaAiSheetStore'

const role = (over: Partial<RoleHealth>): RoleHealth => ({
  opportunity_id: 'o1',
  title: 'GK wanted',
  position: 'goalkeeper',
  created_at: '2026-07-01',
  views_7d: 0,
  views_prior_7d: 0,
  applicant_count: 0,
  pending_count: 0,
  new_count: 0,
  ...over,
})

describe('aggregateRolesHealth', () => {
  it('sums pending and new across roles', () => {
    const totals = aggregateRolesHealth([
      role({ pending_count: 3, new_count: 1 }),
      role({ opportunity_id: 'o2', pending_count: 2, new_count: 2 }),
      role({ opportunity_id: 'o3' }),
    ])
    expect(totals).toEqual({ openRoles: 3, pending: 5, newApplicants: 3 })
  })

  it('is all-zero for no roles', () => {
    expect(aggregateRolesHealth([])).toEqual({ openRoles: 0, pending: 0, newApplicants: 0 })
  })
})

function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="loc">{loc.pathname + loc.search}</div>
}

describe('AiScoutBar', () => {
  const renderBar = () =>
    render(
      <MemoryRouter initialEntries={['/home']}>
        <Routes>
          <Route path="/home" element={<AiScoutBar />} />
          <Route path="/discover" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    )

  // One Hockia AI sheet (2026-10-22): the bar opens the sheet, no navigation.
  beforeEach(() => useHockiaAiSheet.setState({ open: false, seed: null }))

  it('opens the Hockia AI sheet and sends a typed query', () => {
    renderBar()
    fireEvent.change(screen.getByLabelText('Ask the AI scout'), {
      target: { value: 'available defenders with EU passport' },
    })
    fireEvent.click(screen.getByLabelText('Search with AI scout'))
    const s = useHockiaAiSheet.getState()
    expect(s.open).toBe(true)
    expect(s.entry).toBe('home')
    expect(s.seed).toEqual({ text: 'available defenders with EU passport', send: true })
    expect(screen.queryByTestId('loc')).toBeNull()
  })

  it('opens the sheet ready to type when tapped empty', () => {
    renderBar()
    fireEvent.click(screen.getByLabelText('Search with AI scout'))
    expect(useHockiaAiSheet.getState()).toMatchObject({ open: true, seed: null })
  })
})
