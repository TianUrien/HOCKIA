/**
 * Player-rule leaks (Phase 1 · step 4) — no match language to players.
 *
 *  - Hockia AI people results: "Strong match / Good match / Needs more info"
 *    pills render only for recruiters (clubs + recruiting coaches).
 *  - Pulse "Opportunities for you": no "Matched" chip.
 *  - Home "Your week": "roles for you", never "roles match you".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { DiscoverResult } from '@/hooks/useDiscover'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))
vi.mock('@/lib/homeInstrumentation', () => ({
  useImpressionOnce: () => () => {},
  recordModuleImpression: vi.fn(),
  trackModuleClick: vi.fn(),
}))
vi.mock('@/components/Avatar', () => ({ default: () => <div data-testid="avatar" /> }))
vi.mock('@/components', () => ({ Avatar: () => <div data-testid="avatar" /> }))

type Viewer = { user: { id: string } | null; profile: { id: string; role: string; coach_recruits_for_team?: boolean } | null }
const authState: Viewer = { user: null, profile: null }
vi.mock('@/lib/auth', () => ({
  useAuthStore: (selector?: (s: Viewer) => unknown) => (selector ? selector(authState) : authState),
}))

const oppsForYou = vi.hoisted(() => ({
  value: {
    loading: false,
    mode: 'matched' as 'matched' | 'newest',
    items: [
      {
        id: 'o1', title: 'Striker wanted', position: 'forward', gender: 'Women',
        application_deadline: null, created_at: '2026-09-20T00:00:00Z',
        club_id: 'c1', club_name: 'Amsterdam HC', club_avatar_url: null, score: 91,
      },
      {
        id: 'o2', title: 'Defender wanted', position: 'defender', gender: 'Women',
        application_deadline: null, created_at: '2026-09-21T00:00:00Z',
        club_id: 'c2', club_name: 'Bloemendaal', club_avatar_url: null, score: 77,
      },
    ],
  },
}))
vi.mock('@/hooks/useOpportunitiesForYou', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useOpportunitiesForYou')>('@/hooks/useOpportunitiesForYou')
  return { ...actual, useOpportunitiesForYou: () => oppsForYou.value }
})
vi.mock('@/hooks/useWeeklyVisibility', () => ({ useWeeklyVisibility: () => ({ loading: false, visibility: { views_7d: 4 } }) }))
vi.mock('@/hooks/useMyApplications', () => ({ useMyApplications: () => ({ loading: false, applications: [] }) }))
vi.mock('@/hooks/useRolesHealth', () => ({ useRolesHealth: () => ({ loading: false, totals: { openRoles: 0, pending: 0, newApplicants: 0 } }) }))
vi.mock('@/hooks/useScopedMatches', () => ({ useScopedMatches: () => ({ loading: false, fitCount: 0, matches: [] }) }))

import DiscoverResultCard from '@/components/DiscoverResultCard'
import { OpportunitiesForYou } from '@/components/home/pulse/OpportunitiesForYou'
import { YourWeekCard } from '@/components/home/YourWeekCard'

const result = {
  id: 'p9', full_name: 'Jordan Hall', username: null, avatar_url: null, role: 'player',
  position: 'midfielder', secondary_position: null, gender: 'Women', playing_category: 'adult_women',
  coaching_categories: null, umpiring_categories: null, age: 24,
  nationality_country_id: null, nationality2_country_id: null, nationality_name: null, nationality2_name: null,
  flag_emoji: null, flag_emoji2: null, base_location: 'Utrecht', base_country_name: 'Netherlands',
  current_club: null, current_world_club_id: null, open_to_play: false, open_to_coach: false,
  open_to_opportunities: false, accepted_reference_count: 0, career_entry_count: 0,
  accepted_friend_count: 0, last_active_at: null, coach_specialization: null,
  coach_specialization_custom: null, fit_level: 'strong_match',
} as DiscoverResult

const setViewer = (role: string | null, recruits = false) => {
  authState.user = role ? { id: 'viewer-1' } : null
  authState.profile = role ? { id: 'viewer-1', role, coach_recruits_for_team: recruits } : null
}

describe('DiscoverResultCard — fit pills are recruiter-only', () => {
  const renderCard = (r: DiscoverResult = result) =>
    render(<MemoryRouter><DiscoverResultCard result={r} /></MemoryRouter>)

  it('a player viewer never sees a match pill', () => {
    setViewer('player')
    renderCard()
    expect(screen.getByText('Jordan Hall')).toBeInTheDocument()
    expect(screen.queryByText(/strong match/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/good match/i)).not.toBeInTheDocument()
  })

  it('a candidate coach never sees a match pill', () => {
    setViewer('coach', false)
    renderCard({ ...result, fit_level: 'possible_match' })
    expect(screen.queryByText(/good match/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/match/i)).not.toBeInTheDocument()
  })

  it('clubs and recruiting coaches still see the pill', () => {
    setViewer('club')
    const { unmount } = renderCard()
    expect(screen.getByText('Strong match')).toBeInTheDocument()
    unmount()

    setViewer('coach', true)
    renderCard({ ...result, fit_level: 'possible_match' })
    expect(screen.getByText('Good match')).toBeInTheDocument()
  })
})

describe('Pulse OpportunitiesForYou — no "Matched" chip', () => {
  beforeEach(() => setViewer('player'))

  it('renders the rail without a Matched chip or a score in matched mode', () => {
    oppsForYou.value.mode = 'matched'
    render(<MemoryRouter><OpportunitiesForYou enabled /></MemoryRouter>)
    expect(screen.getByText('Opportunities for you')).toBeInTheDocument()
    expect(screen.getByText('Striker wanted')).toBeInTheDocument()
    expect(screen.queryByText(/matched/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/91/)).not.toBeInTheDocument()
    expect(screen.queryByText(/%/)).not.toBeInTheDocument()
  })
})

describe('Home YourWeekCard — "roles for you"', () => {
  it('a player sees "roles for you", never "match"', () => {
    setViewer('player')
    oppsForYou.value.mode = 'matched'
    render(<MemoryRouter><YourWeekCard /></MemoryRouter>)
    expect(screen.getByText('roles for you')).toBeInTheDocument()
    expect(screen.queryByText(/match/i)).not.toBeInTheDocument()
  })

  it('a coach sees the same wording', () => {
    setViewer('coach')
    render(<MemoryRouter><YourWeekCard /></MemoryRouter>)
    expect(screen.getByText('roles for you')).toBeInTheDocument()
    expect(screen.queryByText(/match/i)).not.toBeInTheDocument()
  })
})
