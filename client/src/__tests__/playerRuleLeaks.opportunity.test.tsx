/**
 * Player-rule leaks (Phase 1 · step 4) — opportunity surfaces.
 *
 *  - No "Responds within ~X" reply-time badge on the opportunity card
 *    (removed everywhere, founder ruling 2026-09-25 D).
 *  - The level sought ("Elite / International" / "High Performance" / …) on the
 *    desktop opportunity detail shows ONLY to the club/coach that posted it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Vacancy } from '@/lib/supabase'

const fromSpy = vi.hoisted(() => vi.fn(() => ({
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  not: vi.fn().mockResolvedValue({ data: [{ publisher_id: 'club-1', tier: 'fast' }], error: null }),
  maybeSingle: vi.fn().mockResolvedValue({ data: { tier: 'fast' }, error: null }),
})))
vi.mock('@/lib/supabase', () => ({
  SUPABASE_URL: 'https://supabase.test',
  supabase: { from: fromSpy, rpc: vi.fn(() => Promise.resolve({ data: null, error: null })) },
}))

type Viewer = { user: { id: string } | null; profile: { id: string; role: string } | null }
const authState: Viewer = { user: null, profile: null }
vi.mock('@/lib/auth', () => ({
  useAuthStore: (selector?: (s: Viewer) => unknown) => (selector ? selector(authState) : authState),
}))
vi.mock('@/hooks/useCountries', () => ({ useCountries: () => ({ countries: [], loading: false, getCountryById: () => undefined }) }))
vi.mock('@/hooks/useBodyScrollLock', () => ({ useBodyScrollLock: () => undefined }))
vi.mock('@/components/ApplicationTimeline', () => ({ default: () => null }))
vi.mock('@/components/Avatar', () => ({ default: () => <div data-testid="avatar" /> }))
vi.mock('@/components/index', () => ({
  Avatar: () => <div data-testid="avatar" />,
  StorageImage: () => <div data-testid="storage-image" />,
}))

import OpportunityCard from '@/components/OpportunityCard'
import OpportunityDetailView from '@/components/OpportunityDetailView'

const vacancy = {
  id: 'opp-1',
  club_id: 'club-1',
  title: 'Goalkeeper wanted',
  opportunity_type: 'player',
  position: 'goalkeeper',
  gender: 'Women',
  description: 'Join us',
  location_city: 'Amsterdam',
  location_country: 'Netherlands',
  status: 'open',
  priority: 'medium',
  level_sought: 'elite',
  compensation: null,
  specialist_skills_wanted: null,
  recruitment_problem: null,
  benefits: [],
  requirements: [],
  application_deadline: null,
  start_date: null,
  duration_text: null,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
  published_at: '2026-09-01T00:00:00Z',
} as unknown as Vacancy

describe('OpportunityCard — no reply-time estimate', () => {
  beforeEach(() => {
    fromSpy.mockClear()
    authState.user = { id: 'player-1' }
    authState.profile = { id: 'player-1', role: 'player' }
  })

  it('never renders a "Responds within" badge and never reads publisher_responsiveness', () => {
    render(
      <MemoryRouter>
        <OpportunityCard vacancy={vacancy} clubName="Amsterdam HC" clubId="club-1" onViewDetails={() => undefined} />
      </MemoryRouter>,
    )
    expect(screen.getByText('Goalkeeper wanted')).toBeInTheDocument()
    expect(screen.queryByTestId('responsiveness-badge')).not.toBeInTheDocument()
    expect(screen.queryByText(/responds within/i)).not.toBeInTheDocument()
    expect(fromSpy).not.toHaveBeenCalledWith('publisher_responsiveness')
  })
})

describe('OpportunityDetailView — level sought is publisher-only', () => {
  const renderDetail = () =>
    render(
      <MemoryRouter>
        <OpportunityDetailView vacancy={vacancy} clubName="Amsterdam HC" clubId="club-1" onClose={() => undefined} onApply={() => undefined} />
      </MemoryRouter>,
    )

  it('a player viewer never sees the level tag', () => {
    authState.user = { id: 'player-1' }
    authState.profile = { id: 'player-1', role: 'player' }
    renderDetail()
    expect(screen.getByText('Goalkeeper')).toBeInTheDocument()
    expect(screen.queryByText(/elite/i)).not.toBeInTheDocument()
  })

  it('a coach (not the publisher) never sees the level tag', () => {
    authState.user = { id: 'coach-1' }
    authState.profile = { id: 'coach-1', role: 'coach' }
    renderDetail()
    expect(screen.queryByText(/elite/i)).not.toBeInTheDocument()
  })

  it('a signed-out visitor never sees the level tag', () => {
    authState.user = null
    authState.profile = null
    renderDetail()
    expect(screen.queryByText(/elite/i)).not.toBeInTheDocument()
  })

  it('the club that posted the role still sees its level tag', () => {
    authState.user = { id: 'club-1' }
    authState.profile = { id: 'club-1', role: 'club' }
    renderDetail()
    expect(screen.getByText(/elite/i)).toBeInTheDocument()
  })
})
