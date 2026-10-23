/**
 * Design audit 2026-10-21, B2: on desktop the member preview is a deck, not a
 * centred dialog. Pins: prev / next arrows and "3 of N", ← / → page, Esc
 * closes, the phone panel's content (age, Plays at, nationalities + EU, Based
 * in), no grabber or silhouette, and a footer action bar with ≥ 44 px targets
 * whose Primary follows the viewer's role. DB events match the phone deck.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  viewerRole: 'player' as string,
  recruiter: false,
  trackDbEvent: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({ supabase: {} }))
vi.mock('@/lib/startConversation', () => ({ resolveConversationRoute: vi.fn(() => Promise.resolve('/messages')) }))
vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => false }))
vi.mock('@/lib/trackDbEvent', () => ({ trackDbEvent: mocks.trackDbEvent }))
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn(), trackProtectedActionBlocked: vi.fn() }))
vi.mock('@/lib/auth', () => ({ useAuthStore: () => ({ user: { id: 'viewer' }, profile: { id: 'viewer', role: mocks.viewerRole, coach_recruits_for_team: mocks.viewerRole === 'coach' } }) }))
vi.mock('@/lib/toast', () => ({ useToastStore: (sel: (s: { addToast: () => void }) => unknown) => sel({ addToast: vi.fn() }) }))
vi.mock('@/lib/ambassadorInvite', async (orig) => ({
  ...(await orig<typeof import('@/lib/ambassadorInvite')>()),
  useAmbassadorInvite: () => ({ state: 'idle', label: 'Invite as ambassador', invite: vi.fn() }),
}))
vi.mock('@/hooks/useFriendship', () => ({
  useFriendship: () => ({ isOwnProfile: false, isFriend: false, isIncomingRequest: false, isOutgoingRequest: false, mutating: false, loading: false, relationship: null, sendRequest: vi.fn(), acceptRequest: vi.fn(), rejectRequest: vi.fn() }),
}))
vi.mock('@/hooks/useFriendsInCommonBatch', () => ({ useFriendsInCommonSummary: () => ({ people: [], count: 0 }), prefetchFriendsInCommon: vi.fn(() => Promise.resolve()) }))
vi.mock('@/hooks/useFriendsAtClub', () => ({ useFriendsAtClub: () => ({ people: [], linked: false, loading: false }) }))
vi.mock('@/hooks/useMemberPhotos', () => ({ useMemberPhotos: () => ({ data: [] }), prefetchMemberPhotos: vi.fn(() => Promise.resolve()) }))
vi.mock('@/hooks/useAvatarFull', () => ({ useAvatarFull: () => ({ data: null }), prefetchAvatarFull: vi.fn(() => Promise.resolve()), cachedAvatarFull: () => undefined }))
vi.mock('@/hooks/useMemberAges', () => ({ useMemberAges: () => new Map() }))
vi.mock('@/hooks/useClubCrestColors', () => ({ useClubCrestColors: () => new Map() }))
vi.mock('@/hooks/useClubViewOfPlayer', () => ({
  useClubViewOfPlayer: () => ({ enabled: mocks.recruiter, roles: [], shortlistedRoleIds: [], fit: mocks.recruiter ? { state: 'green' } : null, fitRole: null, application: null, shortlisted: false, busy: false }),
}))
vi.mock('@/hooks/useCountries', () => ({
  useCountries: () => ({ countries: [{ id: 1, name: 'Argentina', common_name: 'Argentina', code: 'AR', flag_emoji: '🇦🇷' }, { id: 2, name: 'Spain', common_name: 'Spain', code: 'ES', flag_emoji: '🇪🇸' }] }),
  isEuCountryCode: (c: string) => c === 'ES',
}))
vi.mock('@/hooks/useBodyScrollLock', () => ({ useBodyScrollLock: vi.fn() }))
vi.mock('@/hooks/useFocusTrap', () => ({ useFocusTrap: vi.fn(), isTopFocusTrap: () => true }))
vi.mock('@/hooks/useWorldClubLogo', () => ({ getPlayerLeagueName: () => null }))
vi.mock('@/lib/nativeUi', () => ({ setStatusBarForBackground: vi.fn(() => Promise.resolve()) }))
vi.mock('@/lib/haptics', () => ({ hapticLight: vi.fn(() => Promise.resolve()), hapticSelection: vi.fn(() => Promise.resolve()) }))
vi.mock('@/lib/squircle', () => ({ useSquircle: vi.fn() }))
vi.mock('@/components/ProfileActionMenu', () => ({ default: () => <button type="button" aria-label="More options" /> }))
vi.mock('@/components/SignInPromptModal', () => ({ default: () => null }))
vi.mock('@/components/profile/ClubViewCards', () => ({ ShortlistRoleSheet: () => null }))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn(), useLocation: () => ({ pathname: '/community', search: '' }) }))
vi.mock('@/components/recruiting/RecruiterFitExplain', () => ({ default: () => <div data-testid="recruiter-fit-explain">Plays your position</div> }))

import { MemberFullPreview } from '@/components/community/photo/MemberFullPreview'
import type { Profile } from '@/components/community/PeopleListView'

const member = (id: string, name: string, extra: Partial<Profile> = {}): Profile => ({
  id, full_name: name, role: 'player', avatar_url: null, position: 'midfielder', playing_category: 'adult_women',
  nationality_country_id: 1, nationality2_country_id: 2, base_location: 'Buenos Aires', base_country_id: 1,
  current_club: null, current_world_club_id: null, accepted_reference_count: 0, highlight_video_url: null,
  ...extra,
} as unknown as Profile)

const members = [
  member('m1', 'Ana Ruiz', { current_club: 'Old Lions', accepted_reference_count: 2 }),
  member('m2', 'Bea Soto'),
  member('m3', 'Cata Vidal'),
]

function renderDeck(onClose = vi.fn(), startIndex = 0) {
  render(
    <MemberFullPreview
      member={members[startIndex]}
      onClose={onClose}
      deck={{ members, startIndex, contextLabel: 'All members · Newest', ageOf: (id) => (id === 'm1' ? 27 : null) }}
    />,
  )
  return onClose
}

const card = () => within(screen.getByTestId('member-deck-card'))

describe('Desktop member deck', () => {
  beforeEach(() => {
    mocks.viewerRole = 'player'
    mocks.recruiter = false
    mocks.trackDbEvent.mockClear()
  })

  it('is a deck with arrows and a "1 of 3" pager, not the phone deck', () => {
    renderDeck()
    expect(screen.getByTestId('member-preview')).toHaveAttribute('data-deck', 'desktop')
    expect(screen.getByTestId('member-deck-pager')).toHaveTextContent('1 of 3')
    expect(screen.getByRole('button', { name: 'Previous member' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next member' })).toBeEnabled()
    expect(screen.getByTestId('member-deck-context')).toHaveTextContent('All members · Newest')
    expect(mocks.trackDbEvent).toHaveBeenCalledWith('member_preview_open', 'profile', 'm1', expect.objectContaining({ source: 'grid' }))
  })

  it('shows the phone panel content: age, Plays at, nationalities with EU, Based in, references', () => {
    renderDeck()
    expect(card().getByRole('heading', { level: 2 })).toHaveTextContent('Ana Ruiz, 27')
    expect(card().getByText('Plays at')).toBeInTheDocument()
    expect(card().getByText('Nationalities and passports')).toBeInTheDocument()
    expect(card().getByText('EU passport')).toBeInTheDocument()
    expect(card().getByText('Based in')).toBeInTheDocument()
    expect(card().getByText('Buenos Aires, Argentina')).toBeInTheDocument()
    expect(card().getByTestId('member-desktop-references')).toHaveTextContent('2 accepted')
  })

  it('has no mobile grabber and no silhouette: a no-photo member shows initials', () => {
    renderDeck()
    const el = screen.getByTestId('member-deck-card')
    expect(el.querySelector('.h-\\[5px\\].w-9')).toBeNull()
    expect(el.textContent).toContain('AR')
  })

  it('→ and ← page between members, Esc closes; the swipe event matches the phone deck', () => {
    const onClose = renderDeck()
    act(() => { fireEvent.keyDown(document, { key: 'ArrowRight' }) })
    expect(screen.getByTestId('member-deck-pager')).toHaveTextContent('2 of 3')
    expect(card().getByRole('heading', { level: 2 })).toHaveTextContent('Bea Soto')
    expect(mocks.trackDbEvent).toHaveBeenCalledWith('member_preview_swipe', 'profile', 'm2', { direction: 'next' })
    act(() => { fireEvent.keyDown(document, { key: 'ArrowLeft' }) })
    expect(screen.getByTestId('member-deck-pager')).toHaveTextContent('1 of 3')
    expect(mocks.trackDbEvent).toHaveBeenCalledWith('member_preview_swipe', 'profile', 'm1', { direction: 'prev' })
    act(() => { fireEvent.keyDown(document, { key: 'Escape' }) })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('the arrows page too; past the last member it says so', () => {
    renderDeck(vi.fn(), 2)
    expect(screen.getByTestId('member-deck-pager')).toHaveTextContent('3 of 3')
    fireEvent.click(screen.getByRole('button', { name: 'Next member' }))
    expect(screen.getByTestId('member-deck-end')).toBeInTheDocument()
  })

  it('footer: a player viewer gets Add friend (Primary) + Message + See full profile, all at least 44 px', () => {
    renderDeck()
    const bar = within(screen.getByTestId('member-preview-actions'))
    const friend = bar.getByTestId('member-preview-friend')
    expect(friend).toHaveTextContent('Add friend')
    expect(friend.className).toContain('bg-hockia-primary')
    expect(bar.getByTestId('member-preview-message').className).not.toContain('bg-hockia-primary')
    expect(bar.getByTestId('member-preview-full-profile')).toHaveTextContent('See full profile')
    for (const b of bar.getAllByRole('button')) expect(b.className).toMatch(/\bh-1[12]\b/)
  })

  it('footer: a brand viewer gets Message (Primary) + Invite as ambassador, never Add friend', () => {
    mocks.viewerRole = 'brand'
    renderDeck()
    const bar = within(screen.getByTestId('member-preview-actions'))
    expect(bar.getByTestId('member-preview-message').className).toContain('bg-hockia-primary')
    expect(bar.getByTestId('member-preview-invite-ambassador')).toHaveTextContent('Invite as ambassador')
    // The longest label sizes to its text instead of sharing an equal, clipping width.
    expect(bar.getByTestId('member-preview-invite-ambassador').className).toMatch(/min-w-fit/)
    expect(bar.getByTestId('member-preview-invite-ambassador').className).not.toMatch(/min-w-0/)
    expect(bar.queryByTestId('member-preview-friend')).toBeNull()
  })

  it('footer: a recruiter gets Shortlist (Primary) + Message, and the Fit badge on the photo', () => {
    mocks.viewerRole = 'club'
    mocks.recruiter = true
    renderDeck()
    const bar = within(screen.getByTestId('member-preview-actions'))
    expect(bar.getByTestId('member-preview-shortlist').className).toContain('bg-hockia-primary')
    expect(bar.getByTestId('member-preview-message').className).not.toContain('bg-hockia-primary')
    for (const badge of card().getAllByTestId('fit-badge')) expect(badge).toHaveTextContent('Strong fit')
    expect(screen.getByTestId('member-deck-card').textContent).not.toMatch(/%/)
  })

  it('records the action from the desktop surface', () => {
    renderDeck()
    fireEvent.click(within(screen.getByTestId('member-preview-actions')).getByTestId('member-preview-full-profile'))
    expect(mocks.trackDbEvent).toHaveBeenCalledWith('member_preview_action', 'profile', 'm1', expect.objectContaining({ action: 'full_profile', surface: 'desktop' }))
  })

  it('recruiters get "Why this fit" in the details column; it opens the explained fit inline', async () => {
    for (const role of ['club', 'coach']) {
      mocks.viewerRole = role
      mocks.recruiter = true
      const view = render(<MemberFullPreview member={members[0]} onClose={vi.fn()} deck={{ members, startIndex: 0, contextLabel: 'Players · Best fit' }} />)
      const toggle = card().getByTestId('member-desktop-why-toggle')
      expect(toggle).toHaveTextContent('Why this fit')
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      fireEvent.click(toggle)
      expect(await card().findByTestId('recruiter-fit-explain')).toHaveTextContent('Plays your position')
      // Inline in the deck, not a second dialog.
      expect(screen.getAllByRole('dialog')).toHaveLength(1)
      expect(screen.getByTestId('member-deck-card').textContent).not.toMatch(/%/)
      view.unmount()
    }
  })

  it('players, brands and umpires never get "Why this fit"', () => {
    for (const role of ['player', 'brand', 'umpire']) {
      mocks.viewerRole = role
      mocks.recruiter = false
      const view = render(<MemberFullPreview member={members[0]} onClose={vi.fn()} deck={{ members, startIndex: 0, contextLabel: 'All members' }} />)
      expect(screen.queryByTestId('member-desktop-why')).toBeNull()
      expect(screen.queryByText('Why this fit')).toBeNull()
      view.unmount()
    }
  })
})
