/**
 * Profile v2 — club (Figma PR6 / PR7). The Recruiting pill means "has at least
 * one open role" — never profiles.open_to_opportunities (a player/coach flag
 * clubs could flip from Settings). Owner "Review applicants" goes to the Club
 * v2 Opportunities screen via onOpenRoles; the squad rail shows first name +
 * position (coaches read "Coach").
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ClubMember, ClubOpenRole } from '@/hooks/useClubProfileScrollData'

let openRoles: ClubOpenRole[] = []
let members: ClubMember[] = []

vi.mock('@/hooks/useClubProfileScrollData', () => ({
  useClubProfileScrollData: () => ({
    loading: false, photos: [], members, memberCount: members.length, openRoles, posts: [], postCount: 0,
    worldClub: null, viewsThisWeek: 3, refresh: vi.fn(),
  }),
}))
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: undefined }) }))
vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn(), auth: { getSession: vi.fn() } } }))
vi.mock('@/hooks/useFriendship', () => ({
  useFriendship: () => ({ isFriend: false, isOutgoingRequest: false, isIncomingRequest: false, mutating: false, sendRequest: vi.fn(), acceptRequest: vi.fn() }),
}))
vi.mock('@/hooks/useFriendsAtClub', () => ({ useFriendsAtClub: () => ({ people: [], loading: false, linked: false }) }))
vi.mock('@/hooks/useClubCrestColors', () => ({ useClubCrestColors: () => new Map() }))
vi.mock('@/hooks/useRolesHealth', () => ({ useRolesHealth: () => ({ roles: [], totals: { openRoles: 0, pending: 2, newApplicants: 0 }, loading: false, failed: false }) }))
vi.mock('@/hooks/useCountries', () => ({ useCountries: () => ({ countries: [] }) }))
vi.mock('@/lib/auth', () => ({ useAuthStore: (sel: (s: unknown) => unknown) => sel({ user: { id: 'viewer' }, profile: null }) }))
vi.mock('@/lib/toast', () => ({ useToastStore: (sel: (s: { addToast: () => void }) => unknown) => sel({ addToast: vi.fn() }) }))
vi.mock('@/components/ProfileViewersSection', () => ({ ProfileViewersSection: () => null }))
vi.mock('@/components/home/PostComposerModal', () => ({ PostComposerModal: () => null }))
vi.mock('@/components/SignInPromptModal', () => ({ default: () => null }))
vi.mock('@/components/ProfileActionMenu', () => ({ default: () => null }))
vi.mock('@/components/profile/v2/ProfileSections', async (orig) => ({ ...(await orig<object>()), CommentsPreview: () => null }))

import ClubProfileV2 from '@/components/profile/v2/ClubProfileV2'
import type { ClubProfileShape } from '@/pages/ClubDashboard'

const role = (id: string): ClubOpenRole => ({ id, title: 'Midfielder', position: 'midfielder', gender: 'Women', opportunityType: 'player', startDate: null, durationText: null })

function renderScreen(profile: Partial<ClubProfileShape> = {}, props: { readOnly?: boolean; onOpenRoles?: () => void } = {}) {
  const base = {
    id: 'club-1', role: 'club', full_name: 'Test HC', avatar_url: null, base_location: 'Dublin', nationality: null,
    nationality_country_id: null, club_bio: null, club_history: null, website: null, year_founded: null, email: 'c@x.io',
    contact_email: null, contact_email_public: false, ...profile,
  } as ClubProfileShape
  const noop = vi.fn()
  return render(
    <MemoryRouter>
      <ClubProfileV2
        profile={base} readOnly={props.readOnly ?? false} isOwnProfile={!props.readOnly}
        onEdit={noop} onViewPublic={noop} onMessage={noop} onOpenSquad={noop}
        onOpenRoles={props.onOpenRoles ?? noop} onPostRole={noop} onOpenPosts={noop} onOpenMedia={noop}
      />
    </MemoryRouter>,
  )
}

describe('ClubProfileV2 · Recruiting pill', () => {
  beforeEach(() => { openRoles = []; members = [] })

  it('is hidden with no open role, even if open_to_opportunities is true', () => {
    renderScreen({ open_to_opportunities: true })
    expect(screen.queryByTestId('club-recruiting-pill')).toBeNull()
  })

  it('shows with one open role, even if open_to_opportunities is false', () => {
    openRoles = [role('r1')]
    renderScreen({ open_to_opportunities: false })
    expect(screen.getByTestId('club-recruiting-pill').textContent).toContain('Recruiting now')
  })

  it('shows on the public view too; the role row is one tap target with no button (audit A5); Message first in the bar', () => {
    openRoles = [role('r1')]
    renderScreen({}, { readOnly: true })
    expect(screen.getByTestId('club-recruiting-pill')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull()
    expect(screen.getByTestId('club-role-row').tagName).toBe('BUTTON')
    const bar = screen.getByTestId('profile-action-bar')
    expect(bar.textContent?.indexOf('Message')).toBeLessThan(bar.textContent?.indexOf('Add friend') ?? -1)
  })
})

describe('ClubProfileV2 · owner recruiting card', () => {
  beforeEach(() => { openRoles = [role('r1')]; members = [] })

  it('counts applicants to review and Review applicants calls onOpenRoles', () => {
    const onOpenRoles = vi.fn()
    renderScreen({}, { onOpenRoles })
    expect(screen.getByText('2 applicants to review')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Review applicants' }))
    expect(onOpenRoles).toHaveBeenCalledTimes(1)
  })
})

describe('ClubProfileV2 · squad rail', () => {
  it('shows first names, the player position and "Coach" for staff', () => {
    openRoles = []
    members = [
      { id: 'c1', fullName: 'Emmett Lane', avatarUrl: null, role: 'coach', position: null, secondaryPosition: null, coachSpecialization: 'head_coach', coachSpecializationCustom: null, currentClub: null },
      { id: 'p1', fullName: 'Lucía Ferreiro', avatarUrl: null, role: 'player', position: 'defender', secondaryPosition: null, coachSpecialization: null, coachSpecializationCustom: null, currentClub: null },
    ]
    renderScreen({}, { readOnly: true })
    const faces = screen.getAllByTestId('club-squad-face').map((f) => f.textContent)
    expect(faces).toEqual(['ELEmmettCoach', 'LFLucíaDefender']) // initials circle + first name + line
  })
})

describe('ClubProfileV2 · one primary per screen', () => {
  it('with nothing to review: no Review applicants, View roles instead', async () => {
    const mod = await import('@/hooks/useRolesHealth')
    vi.spyOn(mod, 'useRolesHealth').mockReturnValue({ roles: [], totals: { openRoles: 1, pending: 0, newApplicants: 0 }, loading: false, failed: false })
    openRoles = [role('r1')]; members = []
    renderScreen()
    expect(screen.getByText('No new applicants')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Review applicants' })).toBeNull()
    expect(screen.getByRole('button', { name: 'View roles' })).toBeTruthy()
  })
})
