/**
 * Hockia AI — open roles for a player asking for roles. The rows show only
 * the role's own facts: no match language, applicant counts or raw enum
 * values, and the empty state always offers a way to every open role.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { OpportunityResultItem } from '@/hooks/useDiscover'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))

import OpportunityResultsResponse from '@/components/discover/OpportunityResultsResponse'
import DiscoverFilterChips from '@/components/DiscoverFilterChips'

const role: OpportunityResultItem = {
  id: 'o1',
  title: 'First-team midfielder',
  position_label: 'Midfielder',
  category_label: "Men's team",
  location_label: 'Amsterdam, Netherlands',
  organization: 'Amsterdam HC',
  logo_url: null,
  benefit_labels: ['Housing', 'Flights'],
  deadline: null,
  navigate_to: '/opportunities/o1',
}

describe('OpportunityResultsResponse', () => {
  it('renders "Club · Position" and "League · package" rows with no match language', () => {
    const { container } = render(
      <MemoryRouter>
        <OpportunityResultsResponse
          message="I found 1 midfielder role in Europe you can apply to."
          opportunities={[role]}
          openRolesTotal={24}
          onAction={() => {}}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText('Amsterdam HC · Midfielder')).toBeInTheDocument()
    expect(screen.getByText('Amsterdam, Netherlands · Housing, Flights')).toBeInTheDocument()
    expect(screen.getByText('From 24 open roles · updated today')).toBeInTheDocument()
    const text = container.textContent ?? ''
    expect(text).not.toMatch(/match|applicant|_/i)
  })

  it('empty state keeps the answer, the pool line and a way to every open role', () => {
    render(
      <MemoryRouter>
        <OpportunityResultsResponse
          message="There are no midfielder roles in Europe you can apply to right now."
          opportunities={[]}
          openRolesTotal={0}
          cta={{ label: 'Browse all opportunities', route: '/opportunities' }}
          onAction={() => {}}
        />
      </MemoryRouter>,
    )
    expect(screen.getByText(/no midfielder roles in Europe/)).toBeInTheDocument()
    expect(screen.getByText('From 0 open roles · updated today')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Browse all opportunities/ })).toBeInTheDocument()
  })

  it('omits the pool line when the total is unknown', () => {
    render(
      <MemoryRouter>
        <OpportunityResultsResponse message="Here you go." opportunities={[role]} onAction={() => {}} />
      </MemoryRouter>,
    )
    expect(screen.queryByText(/open roles · updated today/)).not.toBeInTheDocument()
  })
})

describe('DiscoverFilterChips', () => {
  it('never shows raw enum values', () => {
    const { container } = render(
      <DiscoverFilterChips filters={{ positions: ['head_coach'], availability: 'open_to_opportunities', target_category: 'adult_men' }} />,
    )
    const text = container.textContent ?? ''
    expect(text).toContain('Head coach')
    expect(text).toContain('Open to opportunities')
    expect(text).not.toMatch(/_/)
  })
})
