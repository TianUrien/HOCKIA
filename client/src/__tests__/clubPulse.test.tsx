import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { describe, it, expect, vi } from 'vitest'

// homeInstrumentation transitively imports @/lib/supabase, which throws
// without env in CI — mock at the instrumentation boundary (house pattern).
vi.mock('@/lib/homeInstrumentation', () => ({
  useImpressionOnce: () => () => {},
  recordModuleImpression: vi.fn(),
  trackModuleClick: vi.fn(),
}))

import { aggregateRolesHealth, type RoleHealth } from '@/hooks/useRolesHealth'
import { AiScoutBar } from '@/components/home/pulse/AiScoutBar'

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

  it('submits a typed query to /discover?q=…', () => {
    renderBar()
    fireEvent.change(screen.getByLabelText('Ask the AI scout'), {
      target: { value: 'available defenders with EU passport' },
    })
    fireEvent.click(screen.getByLabelText('Search with AI scout'))
    expect(screen.getByTestId('loc').textContent).toBe(
      '/discover?q=available%20defenders%20with%20EU%20passport',
    )
  })

  it('goes to /discover with no query when tapped empty', () => {
    renderBar()
    fireEvent.click(screen.getByLabelText('Search with AI scout'))
    expect(screen.getByTestId('loc').textContent).toBe('/discover')
  })
})
