/**
 * Club v2 phone profile (Figma D1 Club profile): the Recruiting pill means
 * "has at least one open role" — never profiles.open_to_opportunities, a
 * player/coach availability flag clubs could flip from Settings (6/33 prod
 * clubs showed a wrong pill). The owner's Roles "Manage" goes to the Club v2
 * Opportunities screen via the dashboard's onOpenRoles (see ClubDashboard).
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ClubOpenRole } from '@/hooks/useClubProfileScrollData'

let openRoles: ClubOpenRole[] = []

vi.mock('@/hooks/useClubProfileScrollData', () => ({
  useClubProfileScrollData: () => ({
    loading: false, photos: [], members: [], memberCount: 0, openRoles, posts: [], postCount: 0,
    worldClub: null, viewsThisWeek: null, refresh: vi.fn(),
  }),
}))
vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn(), auth: { getSession: vi.fn() } } }))
vi.mock('@/hooks/useFriendship', () => ({
  useFriendship: () => ({ status: 'none', isFriend: false, loading: false, sendRequest: vi.fn(), acceptRequest: vi.fn(), removeFriend: vi.fn() }),
}))
vi.mock('@/hooks/useCountries', () => ({ useCountries: () => ({ countries: [] }) }))
vi.mock('@/lib/auth', () => ({ useAuthStore: () => ({ user: { id: 'club-1' } }) }))
vi.mock('@/lib/toast', () => ({ useToastStore: (sel: (s: { addToast: () => void }) => unknown) => sel({ addToast: vi.fn() }) }))
vi.mock('@/components/ProfileViewersSection', () => ({ ProfileViewersSection: () => null }))
vi.mock('@/components/home/PostComposerModal', () => ({ PostComposerModal: () => null }))
vi.mock('@/components/SignInPromptModal', () => ({ default: () => null }))
vi.mock('@/components/ProfileActionMenu', () => ({ default: () => null }))

import ClubProfileScreen from '@/components/profile/mobile/ClubProfileScreen'
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
      <ClubProfileScreen
        profile={base} readOnly={props.readOnly ?? false} isOwnProfile
        onEdit={noop} onViewPublic={noop} onMessage={noop} onOpenFriends={noop} onOpenSquad={noop}
        onOpenRoles={props.onOpenRoles ?? noop} onPostRole={noop} onOpenClubLeague={noop} onOpenPosts={noop}
      />
    </MemoryRouter>,
  )
}

describe('ClubProfileScreen · Recruiting pill', () => {
  beforeEach(() => { openRoles = [] })

  it('is hidden with no open role, even if open_to_opportunities is true', () => {
    renderScreen({ open_to_opportunities: true })
    expect(screen.queryByText('Recruiting')).toBeNull()
  })

  it('shows with one open role, even if open_to_opportunities is false', () => {
    openRoles = [role('r1')]
    renderScreen({ open_to_opportunities: false })
    expect(screen.getByText('Recruiting')).toBeTruthy()
  })

  it('shows on the public view too', () => {
    openRoles = [role('r1')]
    renderScreen({}, { readOnly: true })
    expect(screen.getByText('Recruiting')).toBeTruthy()
  })
})

describe('ClubProfileScreen · Roles tab Manage', () => {
  beforeEach(() => { openRoles = [role('r1')] })

  it('calls onOpenRoles', () => {
    const onOpenRoles = vi.fn()
    renderScreen({}, { onOpenRoles })
    fireEvent.click(screen.getByRole('button', { name: /1 open role/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Manage' }))
    expect(onOpenRoles).toHaveBeenCalledTimes(1)
  })
})
