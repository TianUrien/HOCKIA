/**
 * Leaf 7 follow-up (QA 27 Sep):
 *  1. The invitee answers a squad invitation on the phone — Inbox › Requests
 *     (pinned first, counts toward the Requests dot) and inline on the
 *     Activity row — through the same store action + toasts as the desktop
 *     drawer, with a neutral toast when the club cancelled it.
 *  2. The Apply sheet opened from a feed role card names the club.
 *  3. New-opportunity notifications read "Head coach", not "Head_coach".
 */
import { fireEvent, render, renderHook, screen, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NotificationRecord } from '@/lib/api/notifications'

const addToast = vi.hoisted(() => vi.fn())
const storeState = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))

vi.mock('@/lib/toast', () => ({
  useToastStore: (sel?: (s: { addToast: typeof addToast }) => unknown) => (sel ? sel({ addToast }) : { addToast }),
}))
vi.mock('@/lib/notifications', () => ({
  useNotificationStore: (sel: (s: Record<string, unknown>) => unknown) => sel(storeState.current),
}))
vi.mock('@/lib/trackDbEvent', () => ({ trackDbEvent: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn(), auth: { getSession: vi.fn() } } }))
const authState = vi.hoisted(() => ({ user: { id: 'viewer-1' }, profile: { id: 'viewer-1', role: 'coach' } }))
vi.mock('@/lib/auth', () => ({
  useAuthStore: (sel?: (s: typeof authState) => unknown) => (sel ? sel(authState) : authState),
}))
vi.mock('@/lib/analytics', () => ({ trackProtectedActionBlocked: vi.fn() }))

// Feed card → OpportunityDetailOverlay → OpportunityPreviewModal → Apply sheet.
const applyProps = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }))
vi.mock('@/components/OpportunityDetailView', () => ({
  default: (p: { onApply?: () => void }) => <button type="button" onClick={p.onApply}>Apply now</button>,
}))
vi.mock('@/components/ApplyToOpportunityModal', () => ({
  default: (p: Record<string, unknown>) => { if (p.isOpen) applyProps.current = p; return null },
}))
vi.mock('@/components/SignInPromptModal', () => ({ default: () => null }))

// Public club profile · Squad tab.
const clubMembers = vi.hoisted(() => ({ current: [] as unknown[] }))
vi.mock('@/hooks/useClubProfileScrollData', () => ({
  useClubProfileScrollData: () => ({
    loading: false, photos: [], members: clubMembers.current, memberCount: clubMembers.current.length, openRoles: [], posts: [], postCount: 0,
    worldClub: null, viewsThisWeek: null, refresh: vi.fn(),
  }),
}))
vi.mock('@/hooks/useFriendship', () => ({
  useFriendship: () => ({ status: 'none', isFriend: false, loading: false, sendRequest: vi.fn(), acceptRequest: vi.fn(), removeFriend: vi.fn() }),
}))
vi.mock('@/hooks/useCountries', () => ({ useCountries: () => ({ countries: [] }) }))
vi.mock('@/components/ProfileViewersSection', () => ({ ProfileViewersSection: () => null }))
vi.mock('@/components/home/PostComposerModal', () => ({ PostComposerModal: () => null }))
vi.mock('@/components/ProfileActionMenu', () => ({ default: () => null }))
vi.mock('@/hooks/useProfileVideos', () => ({
  useProfileVideos: () => ({ videos: [], links: [], loading: false, reload: () => {} }),
}))

import { isClubInviteUnavailable, CLUB_INVITE_UNAVAILABLE_MESSAGE } from '@/lib/clubInviteCopy'
import { computeInboxSegmentDots } from '@/lib/inboxSegmentDots'
import { useRespondToClubInvite } from '@/hooks/useRespondToClubInvite'
import { InboxRequests } from '@/components/inbox/InboxRequests'
import { InboxActivity } from '@/components/inbox/InboxActivity'
import NotificationsDrawer from '@/components/NotificationsDrawer'
import { getNotificationConfig } from '@/components/notifications/config'
import type { MyClubInvitation } from '@/lib/clubInvitations'
import OpportunityPreviewModal from '@/components/OpportunityPreviewModal'
import ClubProfileScreen from '@/components/profile/mobile/ClubProfileScreen'
import type { ClubProfileShape } from '@/pages/ClubDashboard'
import type { Vacancy } from '@/lib/supabase'

const note = (overrides: Partial<NotificationRecord> = {}): NotificationRecord => ({
  id: 'n1',
  kind: 'club_invitation_received',
  sourceEntityId: 'cm-1',
  metadata: { club_member_id: 'cm-1' },
  targetUrl: null,
  createdAt: '2026-09-27T10:00:00Z',
  readAt: null,
  seenAt: null,
  clearedAt: null,
  actor: { id: 'club-1', fullName: 'E2E Test FC', role: 'club', username: null, avatarUrl: null, baseLocation: 'London' },
  ...overrides,
})

const baseStore = (overrides: Record<string, unknown> = {}) => ({
  notifications: [],
  loading: false,
  unreadCount: 0,
  isDrawerOpen: true,
  markRead: vi.fn(),
  markAllRead: vi.fn(),
  toggleDrawer: vi.fn(),
  respondToFriendRequest: vi.fn(),
  pendingFriendshipId: null,
  respondToAmbassadorRequest: vi.fn(),
  pendingAmbassadorRequestId: null,
  respondToClubInvite: vi.fn().mockResolvedValue(true),
  pendingClubInviteId: null,
  ...overrides,
})

beforeEach(() => {
  addToast.mockReset()
  storeState.current = baseStore()
})

describe('club invitation helpers', () => {
  it('treats a cancelled or already-answered invitation as unavailable, not as an error', () => {
    expect(isClubInviteUnavailable('Invitation not found')).toBe(true)
    expect(isClubInviteUnavailable('Invitation is no longer pending')).toBe(true)
    expect(isClubInviteUnavailable('Not authenticated')).toBe(false)
    expect(isClubInviteUnavailable(undefined)).toBe(false)
  })

  it('a NEW (unseen) pending squad invitation lights the Requests dot; a seen one does not', () => {
    const invite = (readAt: string | null) => ({ id: 'n-1', kind: 'club_invitation_received', sourceEntityId: 'cm-1', readAt, clearedAt: null })
    expect(computeInboxSegmentDots({ unreadMessages: 0, pendingRequestIds: [], clubInvitationIds: ['cm-1'], notifications: [invite(null)] }).requests).toBe(true)
    expect(computeInboxSegmentDots({ unreadMessages: 0, pendingRequestIds: [], clubInvitationIds: ['cm-1'], notifications: [invite('2026-10-09T10:00:00Z')] }).requests).toBe(false)
    expect(computeInboxSegmentDots({ unreadMessages: 0, pendingRequestIds: [], clubInvitationIds: [], notifications: [invite(null)] }).requests).toBe(false)
  })
})

describe('useRespondToClubInvite (shared by phone + desktop)', () => {
  it('accept → "You joined the club."', async () => {
    const respondToClubInvite = vi.fn().mockResolvedValue(true)
    storeState.current = baseStore({ respondToClubInvite })
    const { result } = renderHook(() => useRespondToClubInvite())
    await act(async () => { await result.current.respond('cm-1', 'accept') })
    expect(respondToClubInvite).toHaveBeenCalledWith({ clubMemberId: 'cm-1', action: 'accept' })
    expect(addToast).toHaveBeenCalledWith('You joined the club.', 'success')
  })

  it('decline reuses the desktop copy', async () => {
    const { result } = renderHook(() => useRespondToClubInvite())
    await act(async () => { await result.current.respond('cm-1', 'decline') })
    expect(addToast).toHaveBeenCalledWith('Club invitation declined.', 'success')
  })

  it('a cancelled invitation gets a neutral toast, never red', async () => {
    storeState.current = baseStore({ respondToClubInvite: vi.fn().mockResolvedValue('unavailable') })
    const { result } = renderHook(() => useRespondToClubInvite())
    await act(async () => { await result.current.respond('cm-1', 'accept') })
    expect(addToast).toHaveBeenCalledWith(CLUB_INVITE_UNAVAILABLE_MESSAGE, 'neutral')
  })

  it('a failure gets the retry error', async () => {
    storeState.current = baseStore({ respondToClubInvite: vi.fn().mockResolvedValue(false) })
    const { result } = renderHook(() => useRespondToClubInvite())
    await act(async () => { await result.current.respond('cm-1', 'accept') })
    expect(addToast).toHaveBeenCalledWith('Could not update the club invitation. Please try again.', 'error')
  })
})

const invite: MyClubInvitation = {
  clubMemberId: 'cm-1',
  createdAt: '2026-09-27T10:00:00Z',
  club: { id: 'club-1', fullName: 'E2E Test FC', username: null, avatarUrl: null, baseLocation: 'London' },
}

describe('Inbox › Requests', () => {
  const renderRequests = (props: Partial<Parameters<typeof InboxRequests>[0]> = {}) =>
    render(
      <MemoryRouter>
        <InboxRequests incoming={[]} outgoing={[]} loading={false} pendingId={null} respond={vi.fn()} {...props} />
      </MemoryRouter>,
    )

  it('lists the invitation first with Accept / Decline and no empty state', () => {
    const respondToClubInvite = vi.fn().mockResolvedValue(true)
    renderRequests({ clubInvitations: [invite], respondToClubInvite })
    expect(screen.getByTestId('inbox-club-invitation').textContent).toContain('E2E Test FC')
    expect(screen.getByText('Invited you to join their club')).toBeTruthy()
    expect(screen.queryByText('No requests right now.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    expect(respondToClubInvite).toHaveBeenCalledWith('cm-1', 'accept')
    fireEvent.click(screen.getByRole('button', { name: "Decline E2E Test FC's invitation" }))
    expect(respondToClubInvite).toHaveBeenCalledWith('cm-1', 'decline')
  })

  it('keeps the invitation above friend requests', () => {
    renderRequests({
      clubInvitations: [invite],
      respondToClubInvite: vi.fn(),
      incoming: [{ friendshipId: 'f1', createdAt: '2026-09-27T11:00:00Z', person: { id: 'p1', full_name: 'Alex Friend', username: null, avatar_url: null, role: 'player', position: null, current_club: null } }],
    })
    const text = document.body.textContent ?? ''
    expect(text.indexOf('E2E Test FC')).toBeLessThan(text.indexOf('Alex Friend'))
  })

  it('still shows the empty state when there is nothing at all', () => {
    renderRequests()
    expect(screen.getByText('No requests right now.')).toBeTruthy()
  })
})

describe('Inbox › Activity', () => {
  it('the invitation row answers inline', () => {
    const respondToClubInvite = vi.fn().mockResolvedValue(true)
    storeState.current = baseStore({ notifications: [note()], respondToClubInvite })
    render(<MemoryRouter><InboxActivity /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    expect(respondToClubInvite).toHaveBeenCalledWith({ clubMemberId: 'cm-1', action: 'accept' })
    expect(screen.getByRole('button', { name: 'Decline' })).toBeTruthy()
  })

  it('other kinds get no buttons', () => {
    storeState.current = baseStore({ notifications: [note({ kind: 'profile_viewed' as NotificationRecord['kind'], sourceEntityId: null })] })
    render(<MemoryRouter><InboxActivity /></MemoryRouter>)
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull()
  })
})

describe('desktop drawer', () => {
  it('a read invitation that is still pending stays under New', () => {
    storeState.current = baseStore({
      notifications: [
        note({ readAt: '2026-09-27T10:05:00Z' }),
        note({ id: 'n2', kind: 'friend_request_accepted' as NotificationRecord['kind'], sourceEntityId: 'x', readAt: '2026-09-27T09:00:00Z', createdAt: '2026-09-27T09:00:00Z' }),
      ],
    })
    render(<MemoryRouter><NotificationsDrawer /></MemoryRouter>)
    const text = document.body.textContent ?? ''
    const newAt = text.indexOf('New')
    const earlierAt = text.indexOf('Earlier')
    const inviteAt = text.indexOf('E2E Test FC invited you')
    expect(newAt).toBeGreaterThanOrEqual(0)
    expect(inviteAt).toBeGreaterThan(newAt)
    expect(earlierAt === -1 || inviteAt < earlierAt).toBe(true)
  })
})

describe('new-opportunity notification line', () => {
  it('uses the display label for coach roles', () => {
    const n = note({
      kind: 'opportunity_published' as NotificationRecord['kind'],
      metadata: { opportunity_title: 'Coach Test 5', club_name: 'E2E Test FC', position: 'head_coach', location_city: 'Manchester', location_country: 'England' },
    })
    expect(getNotificationConfig(n).getDescription?.(n)).toBe('Head coach • Manchester, England')
  })
  it('player positions still read as before', () => {
    const n = note({ kind: 'opportunity_published' as NotificationRecord['kind'], metadata: { position: 'midfielder' } })
    expect(getNotificationConfig(n).getDescription?.(n)).toBe('Midfielder')
  })
})

describe('Apply sheet from the feed card overlay', () => {
  it('passes the club name + crest the role page passes', () => {
    applyProps.current = null
    const vacancy = { id: 'o1', club_id: 'club-1', opportunity_type: 'coach', gender: 'Men', organization_name: null } as unknown as Vacancy
    render(
      <MemoryRouter>
        <OpportunityPreviewModal
          vacancy={vacancy}
          clubInfo={{ id: 'club-1', full_name: 'E2E Test FC', avatar_url: 'clubs/crest.png', role: 'club', current_club: null, womens_league_division: null, mens_league_division: 'Premier' }}
          worldClub={null}
          hasApplied={false}
          onClose={vi.fn()}
        />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Apply now' }))
    expect(applyProps.current).toMatchObject({ clubName: 'E2E Test FC', clubLogo: 'clubs/crest.png', publisherRole: 'club', league: 'Premier' })
  })

  it('prefers the linked world club, like the role page', () => {
    applyProps.current = null
    const vacancy = { id: 'o1', club_id: 'club-1', opportunity_type: 'coach', gender: 'Women', organization_name: null } as unknown as Vacancy
    render(
      <MemoryRouter>
        <OpportunityPreviewModal
          vacancy={vacancy}
          clubInfo={{ id: 'club-1', full_name: 'E2E Test FC', avatar_url: null, role: 'club', current_club: null, womens_league_division: null, mens_league_division: null }}
          worldClub={{ id: 'w1', clubName: 'CASI', avatarUrl: 'w/casi.png', countryName: null, flagEmoji: null, leagueName: 'Metro A' }}
          hasApplied={false}
          onClose={vi.fn()}
        />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Apply now' }))
    expect(applyProps.current).toMatchObject({ clubName: 'CASI', clubLogo: 'w/casi.png', league: 'Metro A' })
  })
})

describe('public club profile · Squad tab', () => {
  it('coach rows carry the specialty, same line as Squad', () => {
    clubMembers.current = [
      { id: 'c1', fullName: 'E2E Test Coach', avatarUrl: null, role: 'coach', position: null, secondaryPosition: null, coachSpecialization: 'head_coach', coachSpecializationCustom: null, currentClub: null },
      { id: 'p1', fullName: 'E2E Test Player', avatarUrl: null, role: 'player', position: 'midfielder', secondaryPosition: 'defender', coachSpecialization: null, coachSpecializationCustom: null, currentClub: null },
    ]
    const profile = {
      id: 'club-1', role: 'club', full_name: 'E2E Test FC', avatar_url: null, base_location: 'London', nationality: null,
      nationality_country_id: null, club_bio: null, club_history: null, website: null, year_founded: null, email: 'c@x.io',
      contact_email: null, contact_email_public: false,
    } as unknown as ClubProfileShape
    const noop = vi.fn()
    render(
      <MemoryRouter>
        <ClubProfileScreen
          profile={profile} readOnly isOwnProfile={false}
          onEdit={noop} onViewPublic={noop} onMessage={noop} onOpenFriends={noop} onOpenSquad={noop}
          onOpenRoles={noop} onPostRole={noop} onOpenClubLeague={noop} onOpenPosts={noop}
        />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('tab', { name: 'Squad' }))
    expect(screen.getByText('Coach · Head coach')).toBeTruthy()
    expect(screen.getByText('Player · Midfielder · Defender')).toBeTruthy()
  })
})

describe('store · respondToClubInvite', () => {
  it('maps a cancelled invitation to "unavailable" and drops it locally; success drops it too', async () => {
    const { supabase } = await import('@/lib/supabase')
    const { useNotificationStore: realStore } = await vi.importActual<typeof import('@/lib/notifications')>('@/lib/notifications')
    const rpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>
    vi.useFakeTimers()
    try {
      realStore.setState({ notifications: [note(), note({ id: 'n2', kind: 'friend_request_received' as NotificationRecord['kind'], sourceEntityId: 'f1' })], refresh: vi.fn() })
      rpc.mockResolvedValueOnce({ data: { success: false, error: 'Invitation not found' }, error: null })
      await expect(realStore.getState().respondToClubInvite({ clubMemberId: 'cm-1', action: 'accept' })).resolves.toBe('unavailable')
      expect(realStore.getState().notifications.map((n) => n.id)).toEqual(['n2'])

      realStore.setState({ notifications: [note()] })
      rpc.mockResolvedValueOnce({ data: { success: true, action: 'accepted' }, error: null })
      await expect(realStore.getState().respondToClubInvite({ clubMemberId: 'cm-1', action: 'accept' })).resolves.toBe(true)
      expect(rpc).toHaveBeenLastCalledWith('respond_to_club_invite', { p_club_member_id: 'cm-1', p_accept: true })
      expect(realStore.getState().notifications).toEqual([])

      realStore.setState({ notifications: [note()] })
      rpc.mockResolvedValueOnce({ data: { success: false, error: 'Not authenticated' }, error: null })
      await expect(realStore.getState().respondToClubInvite({ clubMemberId: 'cm-1', action: 'decline' })).resolves.toBe(false)
      expect(realStore.getState().notifications).toHaveLength(1)
    } finally {
      vi.runOnlyPendingTimers()
      vi.useRealTimers()
    }
  })
})
