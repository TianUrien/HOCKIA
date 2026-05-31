import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi } from 'vitest'
import PlayerBentoGrid from '@/components/dashboard/bento/PlayerBentoGrid'
import type { PlayerProfileShape } from '@/pages/PlayerDashboard'

// Stub out every child card so this test only verifies which cards
// PlayerBentoGrid composes for owner vs visitor — the cards themselves
// have their own concerns (supabase counts, edit modals) tested elsewhere.
vi.mock('@/components/dashboard/bento/OpportunitiesCard', () => ({
  default: () => <div data-testid="opportunities-card" />,
}))
vi.mock('@/components/dashboard/bento/BasicInfoCard', () => ({
  default: () => <div data-testid="basic-info-card" />,
}))
vi.mock('@/components/dashboard/bento/JourneyCard', () => ({
  default: () => <div data-testid="journey-card" />,
}))
vi.mock('@/components/dashboard/bento/MediaCard', () => ({
  default: () => <div data-testid="media-card" />,
}))
vi.mock('@/components/dashboard/bento/AboutMeCard', () => ({
  default: () => <div data-testid="about-me-card" />,
}))
vi.mock('@/components/dashboard/bento/CommunityCard', () => ({
  default: () => <div data-testid="community-card" />,
}))
// SavedCandidatesCard pulls in @/lib/supabase at import time (count
// fetch), which throws without env vars in the unit env — mock it like
// the other child cards so PlayerBentoGrid stays composition-only.
vi.mock('@/components/dashboard/bento/SavedCandidatesCard', () => ({
  default: () => <div data-testid="saved-candidates-card" />,
}))

const baseProfile: PlayerProfileShape = {
  id: 'player-1',
  role: 'player',
  full_name: 'Jordan Hall',
  avatar_url: null,
  base_location: 'London',
  bio: 'Midfielder',
  nationality: 'United Kingdom',
  nationality_country_id: null,
  nationality2_country_id: null,
  gender: 'Female',
  date_of_birth: '2000-01-01',
  position: 'Midfield',
  secondary_position: null,
  current_club: 'London HC',
  email: 'jordan@example.com',
  contact_email: 'jordan@example.com',
  contact_email_public: true,
}

const noop = () => undefined
const sharedProps = {
  profile: baseProfile,
  onOpenTab: noop,
  onEdit: noop,
  onViewOpportunities: noop,
}

const wrap = (node: React.ReactNode) => (
  <MemoryRouter>{node}</MemoryRouter>
)

describe('PlayerBentoGrid', () => {
  it('owner mode includes Opportunities, Basic Info, Journey, Media, Community', () => {
    render(wrap(<PlayerBentoGrid {...sharedProps} readOnly={false} />))

    expect(screen.getByTestId('opportunities-card')).toBeInTheDocument()
    expect(screen.getByTestId('basic-info-card')).toBeInTheDocument()
    expect(screen.getByTestId('journey-card')).toBeInTheDocument()
    expect(screen.getByTestId('media-card')).toBeInTheDocument()
    expect(screen.getByTestId('community-card')).toBeInTheDocument()
    // About me is merged INTO BasicInfoCard for owners — no separate card.
    expect(screen.queryByTestId('about-me-card')).not.toBeInTheDocument()
  })

  it('visitor mode hides Opportunities + Basic Info (owner-only cards) and keeps About Me standalone', () => {
    render(wrap(<PlayerBentoGrid {...sharedProps} readOnly />))

    // Visitor cards — About Me stays standalone because visitors don't
    // see BasicInfoCard to merge it into.
    expect(screen.getByTestId('about-me-card')).toBeInTheDocument()
    expect(screen.getByTestId('journey-card')).toBeInTheDocument()
    expect(screen.getByTestId('media-card')).toBeInTheDocument()
    expect(screen.getByTestId('community-card')).toBeInTheDocument()
    // Owner-only cards hidden
    expect(screen.queryByTestId('opportunities-card')).not.toBeInTheDocument()
    expect(screen.queryByTestId('basic-info-card')).not.toBeInTheDocument()
  })

  it('uses a grid wrapper with the matching variant test id', () => {
    const { rerender } = render(wrap(<PlayerBentoGrid {...sharedProps} readOnly={false} />))
    expect(screen.getByTestId('player-bento-grid-owner')).toBeInTheDocument()

    rerender(wrap(<PlayerBentoGrid {...sharedProps} readOnly />))
    expect(screen.getByTestId('player-bento-grid-visitor')).toBeInTheDocument()
  })
})
