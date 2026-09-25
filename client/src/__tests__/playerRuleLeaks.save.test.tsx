/**
 * Player-rule leaks (Phase 1 · step 4) — Save is for recruiters only, and
 * the "Responds within ~X" badge is gone from the club hero.
 *
 *  - ScoutingCard (desktop player/coach profile): the Shortlist/Saved button
 *    and the ⋯ list menu render only for clubs and recruiting coaches.
 *  - CoachBentoGrid (coach's own dashboard): the Saved Candidates tile only
 *    for a coach who recruits for a team.
 *  - ClubHeroCard: no reply-time badge for visitors OR the owning club.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const fromSpy = vi.hoisted(() => {
  const builder = () => {
    const b: Record<string, unknown> = {}
    const chain = () => b
    b.select = chain
    b.eq = vi.fn(() => ({ ...b, then: (res: (v: unknown) => void) => res({ data: [], count: 0, error: null }) }))
    b.order = vi.fn(() => Promise.resolve({ data: [], error: null }))
    b.in = chain
    b.not = vi.fn(() => Promise.resolve({ data: [{ publisher_id: 'club-1', tier: 'fast' }], error: null }))
    b.maybeSingle = vi.fn(() => Promise.resolve({ data: { tier: 'fast' }, error: null }))
    return b
  }
  return vi.fn(() => builder())
})
vi.mock('@/lib/supabase', () => ({
  SUPABASE_URL: 'https://supabase.test',
  supabase: { from: fromSpy, rpc: vi.fn(() => Promise.resolve({ data: null, error: null })) },
}))

type Viewer = {
  user: { id: string } | null
  profile: { id: string; role: string; coach_recruits_for_team?: boolean } | null
}
const authState: Viewer = { user: null, profile: null }
vi.mock('@/lib/auth', () => ({
  useAuthStore: (selector?: (s: Viewer) => unknown) => (selector ? selector(authState) : authState),
}))

const savedState = vi.hoisted(() => ({
  isSaved: true, // a legacy saved row must stay invisible to non-recruiters
  mutating: false,
  isAuthenticated: true,
  isOwnProfile: false,
  toggle: vi.fn(),
}))
vi.mock('@/hooks/useSavedProfiles', () => ({ useIsProfileSaved: () => savedState }))

// Recruiter lenses — inert here (their own tests cover gating).
const notApplicable = { isApplicable: false }
vi.mock('@/hooks/useClubFit', () => ({ useClubFit: () => notApplicable }))
vi.mock('@/hooks/useCoachFit', () => ({ useCoachFit: () => notApplicable }))
vi.mock('@/hooks/useEvidence', () => ({ useEvidence: () => notApplicable }))
vi.mock('@/hooks/useInterest', () => ({ useInterest: () => notApplicable, categoryToBandTarget: () => null }))
vi.mock('@/lib/recruiterVerdict', () => ({ computeRecruiterVerdict: () => ({ isApplicable: false }) }))
vi.mock('@/hooks/useRecruitingContext', () => ({
  useHasActiveRecruitingScope: () => false,
  useActiveRecruitingTargetProblem: () => null,
}))
vi.mock('@/hooks/useWorldClubLogo', () => ({ getClubLevelBand: () => null, prefetchWorldClubLogos: () => Promise.resolve() }))
vi.mock('@/hooks/useCountries', () => ({ useCountries: () => ({ countries: [], loading: false, getCountryById: () => undefined }) }))
vi.mock('@/components/recruiting/ClubFitChip', () => ({ default: () => null }))
vi.mock('@/components/recruiting/ProvenSignal', () => ({ default: () => null }))
vi.mock('@/components/recruiting/InterestSignal', () => ({ default: () => null }))
vi.mock('@/components/recruiting/RecruiterVerdictCard', () => ({ default: () => null }))
vi.mock('@/components/recruiting/AIOpinionPanel', () => ({ default: () => null }))
vi.mock('@/components/recruiting/MoreActionsMenu', () => ({
  default: () => <div data-testid="more-actions-menu" />,
}))

// ClubHeroCard / CoachBentoGrid children.
vi.mock('@/components', () => ({
  Avatar: () => <div data-testid="avatar" />,
  CountryDisplay: () => null,
  FriendshipButton: () => null,
  LastActivePill: () => null,
  RoleBadge: () => null,
  SocialLinksDisplay: () => null,
  TierBadge: () => null,
  VerifiedBadge: () => null,
}))
vi.mock('@/components/ProfileActionMenu', () => ({ default: () => null }))
vi.mock('@/components/profile/ShareProfileButton', () => ({ default: () => null }))
vi.mock('@/components/dashboard/bento/CompletionArc', () => ({ default: () => null }))
for (const card of ['CoachPostedOpportunitiesCard', 'CoachApplicationsCard', 'BasicInfoCard', 'JourneyCard', 'MediaCard', 'AboutMeCard', 'CommunityCard']) {
  vi.doMock(`@/components/dashboard/bento/${card}`, () => ({ default: () => <div data-testid={card} /> }))
}
vi.mock('@/components/dashboard/bento/SavedCandidatesCard', () => ({
  default: () => <div data-testid="saved-candidates-card" />,
}))

import ScoutingCard from '@/components/profile/ScoutingCard'
import ClubHeroCard from '@/components/dashboard/bento/ClubHeroCard'

const candidate = {
  id: 'player-9',
  role: 'player',
  full_name: 'Jordan Hall',
  current_club: null,
  current_world_club_id: null,
  playing_category: 'adult_women',
  highlight_video_url: null,
  full_game_video_count: 0,
  accepted_reference_count: 0,
  last_active_at: null,
  show_last_active: false,
  open_to_play: true,
  open_to_coach: false,
  open_to_opportunities: false,
}

const setViewer = (role: string, recruits = false) => {
  authState.user = { id: 'viewer-1' }
  authState.profile = { id: 'viewer-1', role, coach_recruits_for_team: recruits }
}

describe('ScoutingCard — Save is recruiter-only', () => {
  const renderCard = () => render(<MemoryRouter><ScoutingCard profile={candidate} /></MemoryRouter>)

  it('a player visitor never sees Shortlist / Saved or the list menu', async () => {
    setViewer('player')
    renderCard()
    await waitFor(() => expect(fromSpy).toHaveBeenCalled())
    expect(screen.queryByText('Shortlist')).not.toBeInTheDocument()
    expect(screen.queryByText('Saved')).not.toBeInTheDocument()
    expect(screen.queryByTestId('more-actions-menu')).not.toBeInTheDocument()
  })

  it('a candidate coach never sees Save either', async () => {
    setViewer('coach', false)
    renderCard()
    await waitFor(() => expect(fromSpy).toHaveBeenCalled())
    expect(screen.queryByText('Saved')).not.toBeInTheDocument()
    expect(screen.queryByTestId('more-actions-menu')).not.toBeInTheDocument()
  })

  it('a club and a recruiting coach keep Save + the list menu', async () => {
    setViewer('club')
    const { unmount } = renderCard()
    expect(await screen.findByText('Saved')).toBeInTheDocument()
    expect(screen.getByTestId('more-actions-menu')).toBeInTheDocument()
    unmount()

    setViewer('coach', true)
    renderCard()
    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })
})

describe('CoachBentoGrid — Saved Candidates tile only for recruiting coaches', () => {
  const coachProfile = (recruits: boolean) => ({
    id: 'viewer-1',
    role: 'coach',
    full_name: 'Sam Coach',
    coach_recruits_for_team: recruits,
  })

  it('hidden for a coach who only looks for a role, shown for a recruiting coach', async () => {
    const { default: CoachBentoGrid } = await import('@/components/dashboard/bento/CoachBentoGrid')
    const props = { onOpenTab: () => undefined, onEdit: () => undefined, onCreateOpportunity: () => undefined, onManageOpportunities: () => undefined, onViewOpportunities: () => undefined }
    const { rerender } = render(
      <MemoryRouter>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <CoachBentoGrid {...(props as any)} profile={coachProfile(false) as any} readOnly={false} />
      </MemoryRouter>,
    )
    expect(screen.queryByTestId('saved-candidates-card')).not.toBeInTheDocument()
    rerender(
      <MemoryRouter>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <CoachBentoGrid {...(props as any)} profile={coachProfile(true) as any} readOnly={false} />
      </MemoryRouter>,
    )
    expect(screen.getByTestId('saved-candidates-card')).toBeInTheDocument()
  })
})

describe('ClubHeroCard — no "Responds within" badge', () => {
  const club = {
    id: 'club-1', full_name: 'Amsterdam HC', avatar_url: null, username: 'ahc',
    nationality: null, nationality_country_id: null, base_location: 'Amsterdam', year_founded: 1892,
    accepted_friend_count: 3, social_links: null, contact_email: null, contact_email_public: false, email: null,
  }

  beforeEach(() => fromSpy.mockClear())

  it('renders no reply-time badge for a player visitor or for the owning club', () => {
    setViewer('player')
    const { unmount } = render(
      <MemoryRouter>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <ClubHeroCard profile={club as any} readOnly isOwnProfile={false} />
      </MemoryRouter>,
    )
    expect(screen.getByText('Amsterdam HC')).toBeInTheDocument()
    expect(screen.queryByTestId('responsiveness-badge')).not.toBeInTheDocument()
    expect(screen.queryByText(/responds within/i)).not.toBeInTheDocument()
    unmount()

    authState.user = { id: 'club-1' }
    authState.profile = { id: 'club-1', role: 'club' }
    render(
      <MemoryRouter>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <ClubHeroCard profile={club as any} readOnly={false} isOwnProfile />
      </MemoryRouter>,
    )
    expect(screen.queryByTestId('responsiveness-badge')).not.toBeInTheDocument()
    expect(screen.queryByText(/responds within/i)).not.toBeInTheDocument()
    expect(fromSpy).not.toHaveBeenCalledWith('publisher_responsiveness')
  })
})
