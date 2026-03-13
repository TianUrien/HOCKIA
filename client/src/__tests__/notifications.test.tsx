import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import NotificationBadge from '@/components/NotificationBadge'
import NotificationsDrawer from '@/components/NotificationsDrawer'
import { getNotificationConfig, resolveNotificationRoute } from '@/components/notifications/config'
import type { NotificationRecord } from '@/lib/api/notifications'

type NotificationStoreSlice = {
  isDrawerOpen: boolean
  notifications: NotificationRecord[]
  markRead: (notificationId: string) => Promise<void> | void
  markAllRead: () => Promise<void> | void
  toggleDrawer: (open?: boolean) => void
  respondToFriendRequest: (params: { friendshipId: string; action: 'accept' | 'decline' }) => Promise<boolean>
  pendingFriendshipId: string | null
  claimCommentHighlights: () => string[]
  clearCommentNotifications: () => Promise<void> | void
  commentHighlightVersion: number
  refresh: (options?: { bypassCache?: boolean }) => Promise<void> | void
}

const mockNavigate = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

const addToast = vi.fn()

vi.mock('@/lib/toast', () => ({
  useToastStore: () => ({ addToast }),
}))

const createNotification = (overrides: Partial<NotificationRecord> = {}): NotificationRecord => ({
  id: 'notif-1',
  kind: 'friend_request_received',
  sourceEntityId: 'source-1',
  metadata: {},
  targetUrl: null,
  createdAt: new Date('2024-01-01T00:00:00Z').toISOString(),
  readAt: null,
  seenAt: null,
  clearedAt: null,
  actor: {
    id: 'actor-1',
    fullName: 'Jordan Hall',
    role: 'player',
    username: 'jordan',
    avatarUrl: null,
    baseLocation: 'London',
  },
  ...overrides,
})

const defaultNotificationStore = (): NotificationStoreSlice => ({
  isDrawerOpen: false,
  notifications: [],
  markRead: vi.fn(),
  markAllRead: vi.fn(),
  toggleDrawer: vi.fn(),
  respondToFriendRequest: vi.fn().mockResolvedValue(true),
  pendingFriendshipId: null,
  claimCommentHighlights: vi.fn(() => []),
  clearCommentNotifications: vi.fn(),
  commentHighlightVersion: 0,
  refresh: vi.fn(),
})

let notificationStoreState = defaultNotificationStore()

const setNotificationStoreState = (overrides: Partial<NotificationStoreSlice> = {}) => {
  notificationStoreState = { ...defaultNotificationStore(), ...overrides }
}

vi.mock('@/lib/notifications', () => ({
  useNotificationStore: (selector: (state: NotificationStoreSlice) => unknown) => selector(notificationStoreState),
}))

const user = userEvent.setup()

describe('NotificationBadge', () => {
  it('hides when there are no unread notifications', () => {
    const { rerender } = render(<NotificationBadge count={0} />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    rerender(<NotificationBadge count={3} />)
    expect(screen.getByRole('status')).toHaveTextContent('3')
  })

  it('caps the count at the configured max', () => {
    render(<NotificationBadge count={15} maxDisplay={9} />)
    expect(screen.getByText('9+')).toBeInTheDocument()
  })
})

describe('NotificationsDrawer', () => {
  beforeEach(() => {
    mockNavigate.mockReset()
    addToast.mockReset()
    setNotificationStoreState()
  })

  it('does not mark all notifications as read when opened', async () => {
    const markAllRead = vi.fn()
    setNotificationStoreState({ isDrawerOpen: true, markAllRead })

    render(
      <MemoryRouter>
        <NotificationsDrawer />
      </MemoryRouter>
    )

    // markAllRead should NOT be called — notifications are marked read individually on click
    expect(markAllRead).not.toHaveBeenCalled()
  })

  it('allows accepting friend requests and shows success toasts', async () => {
    const respondToFriendRequest = vi.fn().mockResolvedValue(true)
    const notifications = [
      createNotification({
        kind: 'friend_request_received',
        sourceEntityId: 'friendship-19',
      }),
    ]

    setNotificationStoreState({
      isDrawerOpen: true,
      notifications,
      respondToFriendRequest,
    })

    render(
      <MemoryRouter>
        <NotificationsDrawer />
      </MemoryRouter>
    )

    await user.click(screen.getByText('Confirm'))

    await waitFor(() => {
      expect(respondToFriendRequest).toHaveBeenCalledWith({ friendshipId: 'friendship-19', action: 'accept' })
    })
    expect(addToast).toHaveBeenCalledWith('Friend request accepted.', 'success')
  })

  it('navigates to the friends tab for reference requests', async () => {
    setNotificationStoreState({
      isDrawerOpen: true,
      notifications: [
        createNotification({
          id: 'reference-1',
          kind: 'reference_request_received',
          metadata: { relationship_type: 'Coach', request_note: 'Coached U16s' },
        }),
      ],
    })

    render(
      <MemoryRouter initialEntries={[{ pathname: '/dashboard/profile' }]}>
        <NotificationsDrawer />
      </MemoryRouter>
    )

    await user.click(screen.getByRole('button', { name: /requested a reference/i }))

    expect(mockNavigate).toHaveBeenCalledWith('/dashboard/profile?tab=friends&section=requests')
  })

  it('opens the comments tab when a comment notification is clicked', async () => {
    const toggleDrawer = vi.fn()
    setNotificationStoreState({
      isDrawerOpen: true,
      toggleDrawer,
      notifications: [
        createNotification({
          id: 'comment-1',
          kind: 'profile_comment_created',
          metadata: { snippet: 'Loved your latest highlight reel!' },
        }),
      ],
    })

    render(
      <MemoryRouter>
        <NotificationsDrawer />
      </MemoryRouter>
    )

    await user.click(screen.getByRole('button', { name: /commented/i }))

    expect(toggleDrawer).toHaveBeenCalledWith(false)
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard/profile?tab=comments')
  })
})

describe('getNotificationConfig', () => {
  it('returns ambassador_request_received config with brand name', () => {
    const notification = createNotification({
      kind: 'ambassador_request_received',
      metadata: { brand_name: 'Nike Hockey' },
    })
    const config = getNotificationConfig(notification)
    expect(config.badgeText).toBe('Ambassador invite')
    expect(config.getTitle(notification)).toBe('Nike Hockey invited you to become a brand ambassador')
    expect(config.getRoute?.(notification)).toBe('/dashboard/profile')
  })

  it('returns ambassador_request_received config without brand name', () => {
    const notification = createNotification({
      kind: 'ambassador_request_received',
      metadata: {},
    })
    const config = getNotificationConfig(notification)
    expect(config.getTitle(notification)).toBe('Jordan Hall invited you to become a brand ambassador')
  })

  it('returns ambassador_request_accepted config', () => {
    const notification = createNotification({
      kind: 'ambassador_request_accepted',
    })
    const config = getNotificationConfig(notification)
    expect(config.badgeText).toBe('Ambassador update')
    expect(config.getTitle(notification)).toBe('Jordan Hall accepted your ambassador invitation')
    expect(config.getRoute?.(notification)).toBe('/dashboard?tab=ambassadors')
  })

  it('returns default config for unknown notification kinds', () => {
    const notification = createNotification({
      kind: 'unknown_kind' as NotificationRecord['kind'],
    })
    const config = getNotificationConfig(notification)
    expect(config.badgeText).toBe('Notification')
    expect(config.getTitle(notification)).toBe('You have a new update')
  })

  it('returns message_received config with multiple messages', () => {
    const notification = createNotification({
      kind: 'message_received',
      metadata: { message_count: 3, conversation_id: 'conv-1' },
    })
    const config = getNotificationConfig(notification)
    expect(config.getTitle(notification)).toBe('Jordan Hall sent 3 new messages')
    expect(config.getRoute?.(notification)).toBe('/messages/conv-1')
  })

  it('returns message_received config with single message', () => {
    const notification = createNotification({
      kind: 'message_received',
      metadata: { conversation_id: 'conv-2' },
    })
    const config = getNotificationConfig(notification)
    expect(config.getTitle(notification)).toBe('Jordan Hall sent you a message')
  })

  it('returns opportunity_published config with full metadata', () => {
    const notification = createNotification({
      kind: 'opportunity_published',
      metadata: {
        opportunity_title: 'Goalkeeper Coach',
        club_name: 'Amsterdam HC',
        opportunity_id: 'opp-1',
        position: 'goalkeeper',
        location_city: 'Amsterdam',
        location_country: 'Netherlands',
      },
    })
    const config = getNotificationConfig(notification)
    expect(config.getTitle(notification)).toBe('Amsterdam HC published: Goalkeeper Coach')
    expect(config.getDescription?.(notification)).toBe('Goalkeeper \u2022 Amsterdam, Netherlands')
    expect(config.getRoute?.(notification)).toBe('/opportunities/opp-1')
  })

  it('returns opportunity_published config without metadata', () => {
    const notification = createNotification({
      kind: 'opportunity_published',
      metadata: {},
    })
    const config = getNotificationConfig(notification)
    expect(config.getTitle(notification)).toBe('A new opportunity was published')
    expect(config.getDescription?.(notification)).toBeNull()
  })

  it('returns vacancy_application_received config', () => {
    const notification = createNotification({
      kind: 'vacancy_application_received',
      metadata: { vacancy_title: 'Midfielder', opportunity_id: 'opp-2' },
    })
    const config = getNotificationConfig(notification)
    expect(config.getTitle(notification)).toBe('New applicant for Midfielder')
    expect(config.getRoute?.(notification)).toBe('/dashboard/opportunities/opp-2/applicants')
  })

  it('returns vacancy_application_status config with status', () => {
    const notification = createNotification({
      kind: 'vacancy_application_status',
      metadata: { status: 'accepted', vacancy_title: 'Defender' },
    })
    const config = getNotificationConfig(notification)
    expect(config.getTitle(notification)).toBe('Application accepted')
  })
})

describe('resolveNotificationRoute', () => {
  it('uses targetUrl as fallback when config has no route', () => {
    const notification = createNotification({
      kind: 'unknown_kind' as NotificationRecord['kind'],
      targetUrl: '/custom-route',
    })
    const route = resolveNotificationRoute(notification)
    expect(route).toBe('/custom-route')
  })

  it('uses metadata target_url as last fallback', () => {
    const notification = createNotification({
      kind: 'unknown_kind' as NotificationRecord['kind'],
      targetUrl: null,
      metadata: { target_url: '/meta-route' },
    })
    const route = resolveNotificationRoute(notification)
    expect(route).toBe('/meta-route')
  })
})
