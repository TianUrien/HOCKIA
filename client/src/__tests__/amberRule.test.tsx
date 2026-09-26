import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { vi, describe, it, expect } from 'vitest'

/**
 * Amber rule (founder 2026-09-26): amber ONLY when the viewer must act soon.
 * A player waiting on a club can't act, so every player-side waiting / final
 * state is neutral grey, and no Clock implies urgency on a final outcome.
 */

vi.mock('@/lib/supabase', () => ({ supabase: {} }))
vi.mock('@/lib/homeInstrumentation', () => ({
  recordModuleImpression: vi.fn(),
  trackModuleClick: vi.fn(),
  useImpressionOnce: () => () => {},
}))
vi.mock('@/hooks/useMyApplications', () => ({
  useMyApplications: () => ({
    loading: false,
    applications: [
      { id: 'a1', opportunity_id: 'o1', status: 'pending', viewed_by_club: false, available: true, opportunity_title: 'Goalkeeper', club_name: 'Club A' },
    ],
  }),
}))

import { YourApplications } from '@/components/home/pulse/YourApplications'
import { playerApplicationStatusBadge } from '@/lib/applicationStatus'

const AMBER = /amber|yellow|#b45309|#fef3c7/i

describe('amber rule — player waiting states are grey', () => {
  it('Pulse waiting pill ("In review") is neutral grey with no Clock', () => {
    render(
      <MemoryRouter>
        <YourApplications enabled />
      </MemoryRouter>,
    )
    const pill = screen.getByText('In review')
    expect(pill.className).not.toMatch(AMBER)
    expect(pill.className).toContain('bg-gray-100 text-gray-600')
    expect(pill.querySelector('svg')?.getAttribute('class') ?? '').not.toMatch(/clock/)
  })

  it('"Replied" badge is the same grey as "Not selected"', () => {
    const maybe = playerApplicationStatusBadge('maybe')
    expect(maybe?.label).toBe('Replied')
    expect(maybe?.className).not.toMatch(AMBER)
    expect(maybe?.className).toBe(playerApplicationStatusBadge('rejected')?.className)
  })

  it('ApplicationTimeline: no amber dot, no Clock on a final outcome', () => {
    const src = readFileSync(resolve(__dirname, '../components/ApplicationTimeline.tsx'), 'utf-8')
    expect(src).not.toMatch(/bg-amber/)
    expect(src).not.toMatch(/no_response' \? Clock/)
  })
})
