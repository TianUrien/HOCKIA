/**
 * Community preview on phones: vertical deck (founder ruling 2026-10-21,
 * Figma 01 Community · "Vertical deck on phones" V0–V3). Pins:
 *   - phones get the vertical deck (no "‹ 3 of N ›" pager); wider screens keep the classic deck;
 *   - the immersive page: list label, identity over the photo, "Based in", the action bar;
 *   - "More" opens the details panel and records member_preview_more_open;
 *   - ArrowDown / ArrowUp move between members and record member_preview_swipe;
 *   - opening records member_preview_open {source: grid}; closing records the depth.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isPhone: true,
  trackDbEvent: vi.fn(),
}))

// No real client: CI has no Supabase env vars, and the module throws without them.
vi.mock('@/lib/supabase', () => ({ supabase: {} }))
vi.mock('@/lib/startConversation', () => ({ resolveConversationRoute: vi.fn(() => Promise.resolve('/messages')) }))
vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => mocks.isPhone }))
vi.mock('@/lib/trackDbEvent', () => ({ trackDbEvent: mocks.trackDbEvent }))
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn(), trackProtectedActionBlocked: vi.fn() }))
vi.mock('@/lib/spring', () => ({
  // Land every spring at once so paging is synchronous in tests.
  springValue: (x: number, onUpdate: (x: number) => void) => ({ x, v: 0, target: x, response: 0.4, damping: 0.8, onUpdate, onDone: null }),
  animateSpring: (s: { x: number; onUpdate: (x: number) => void }, target: number, opts: { onDone?: () => void } = {}) => { s.x = target; s.onUpdate(target); opts.onDone?.() },
  stopSpring: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ useAuthStore: () => ({ user: { id: 'viewer' }, profile: { id: 'viewer', role: 'player' } }) }))
vi.mock('@/lib/toast', () => ({ useToastStore: (sel: (s: { addToast: () => void }) => unknown) => sel({ addToast: vi.fn() }) }))
vi.mock('@/hooks/useFriendship', () => ({
  useFriendship: () => ({ isOwnProfile: false, isFriend: false, isIncomingRequest: false, isOutgoingRequest: false, mutating: false, loading: false, relationship: null, sendRequest: vi.fn(), acceptRequest: vi.fn(), rejectRequest: vi.fn() }),
}))
vi.mock('@/hooks/useFriendsInCommonBatch', () => ({ useFriendsInCommonSummary: () => ({ people: [], count: 0 }), prefetchFriendsInCommon: vi.fn(() => Promise.resolve()) }))
vi.mock('@/hooks/useFriendsAtClub', () => ({ useFriendsAtClub: () => ({ people: [], linked: false, loading: false }) }))
vi.mock('@/hooks/useMemberPhotos', () => ({ useMemberPhotos: () => ({ data: [] }), prefetchMemberPhotos: vi.fn(() => Promise.resolve()) }))
vi.mock('@/hooks/useMemberAges', () => ({ useMemberAges: () => new Map() }))
vi.mock('@/hooks/useClubCrestColors', () => ({ useClubCrestColors: () => new Map() }))
vi.mock('@/hooks/useClubViewOfPlayer', () => ({ useClubViewOfPlayer: () => ({ enabled: false, roles: [], shortlistedRoleIds: [], fit: null, fitRole: null, application: null, shortlisted: false, busy: false }) }))
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

import { MemberFullPreview } from '@/components/community/photo/MemberFullPreview'
import type { Profile } from '@/components/community/PeopleListView'

const member = (id: string, name: string, extra: Partial<Profile> = {}): Profile => ({
  id, full_name: name, role: 'player', avatar_url: null, position: 'midfielder', playing_category: 'adult_women',
  nationality_country_id: 1, nationality2_country_id: 2, base_location: 'Buenos Aires', base_country_id: 1,
  current_club: null, current_world_club_id: null, accepted_reference_count: 0, highlight_video_url: null,
  ...extra,
} as unknown as Profile)

const members = [
  member('m1', 'Ana Ruiz', { current_club: 'Old Lions', accepted_reference_count: 3, highlight_video_url: 'https://example.com/v' }),
  member('m2', 'Bea Soto'),
  member('m3', 'Cata Vidal'),
]

function renderDeck(onClose = vi.fn()) {
  return render(
    <MemberFullPreview
      member={members[0]}
      onClose={onClose}
      deck={{ members, startIndex: 0, contextLabel: 'All members · Newest' }}
    />,
  )
}

const activeCard = () => screen.getByTestId('member-deck-card')

describe('Community preview: vertical deck on phones', () => {
  beforeEach(() => {
    mocks.isPhone = true
    mocks.trackDbEvent.mockClear()
    try { localStorage.setItem('hockia.community.vdeckHintSeen', '1') } catch { /* jsdom */ }
  })

  it('phones get the vertical deck with no pager; the page shows the list label, identity and actions', () => {
    renderDeck()
    expect(screen.getByTestId('member-preview')).toHaveAttribute('data-deck', 'vertical')
    expect(screen.queryByTestId('member-deck-pager')).not.toBeInTheDocument()
    const card = within(activeCard())
    expect(card.getByTestId('member-deck-context')).toHaveTextContent('All members · Newest')
    expect(card.getByRole('heading', { level: 2 })).toHaveTextContent('Ana Ruiz')
    expect(card.getByText('Midfielder · Women’s · Old Lions')).toBeInTheDocument()
    expect(card.getByText('Based in Buenos Aires, Argentina')).toBeInTheDocument()
    expect(card.getByTestId('member-preview-friend')).toHaveTextContent('Add friend')
    expect(card.getByTestId('member-preview-message')).toBeInTheDocument()
    expect(mocks.trackDbEvent).toHaveBeenCalledWith('member_preview_open', 'profile', 'm1', expect.objectContaining({ source: 'grid' }))
  })

  it('"More" opens the details panel with Plays at, nationalities, references and highlights', () => {
    renderDeck()
    fireEvent.click(within(activeCard()).getByTestId('member-vdeck-more'))
    const panel = within(screen.getByTestId('member-vdeck-details'))
    expect(panel.getByText('Plays at')).toBeInTheDocument()
    expect(panel.getByText('Old Lions · Women’s')).toBeInTheDocument()
    expect(panel.getByText('Nationalities and passports')).toBeInTheDocument()
    expect(panel.getByText('EU passport')).toBeInTheDocument()
    expect(panel.getByTestId('member-vdeck-references')).toHaveTextContent('3 accepted')
    expect(panel.getByTestId('member-vdeck-highlights')).toHaveTextContent('Watch')
    expect(panel.getByTestId('member-preview-full-profile')).toBeInTheDocument()
    expect(mocks.trackDbEvent).toHaveBeenCalledWith('member_preview_more_open', 'profile', 'm1', expect.anything())
  })

  it('ArrowDown / ArrowUp page between members and record the swipe direction', () => {
    renderDeck()
    act(() => { fireEvent.keyDown(document, { key: 'ArrowDown' }) })
    expect(within(activeCard()).getByRole('heading', { level: 2 })).toHaveTextContent('Bea Soto')
    expect(mocks.trackDbEvent).toHaveBeenCalledWith('member_preview_swipe', 'profile', 'm2', { direction: 'next' })
    act(() => { fireEvent.keyDown(document, { key: 'ArrowUp' }) })
    expect(within(activeCard()).getByRole('heading', { level: 2 })).toHaveTextContent('Ana Ruiz')
    expect(mocks.trackDbEvent).toHaveBeenCalledWith('member_preview_swipe', 'profile', 'm1', { direction: 'prev' })
  })

  it('records how many members were seen when the deck closes', () => {
    const { unmount } = renderDeck()
    act(() => { fireEvent.keyDown(document, { key: 'ArrowDown' }) })
    unmount()
    expect(mocks.trackDbEvent).toHaveBeenCalledWith('member_preview_depth', 'community', undefined, { members_seen: 2 })
  })

  it('wider screens keep the classic deck with the pager', () => {
    mocks.isPhone = false
    renderDeck()
    expect(screen.getByTestId('member-preview')).not.toHaveAttribute('data-deck', 'vertical')
    expect(screen.getByTestId('member-deck-pager')).toHaveTextContent('1 of 3')
  })
})
