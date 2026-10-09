/**
 * Inbox › Requests red dot = "something NEW", not "something pending"
 * (founder spec 2026-10-09).
 *
 * Wires the REAL notification store, useInboxSegmentDots (Requests segment +
 * tab-bar dot) and useMarkInboxRequestsSeen together; only Supabase and the
 * neighbouring data hooks are mocked. Dates are pinned.
 */
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  rpc: vi.fn<(fn: string, args?: unknown) => Promise<{ data: boolean; error: null }>>(async () => ({ data: true, error: null })),
  unread: 0,
  edges: new Map<string, { id: string; status: string; requester_id: string; friend_id: string }>(),
}))

vi.mock('@/lib/supabase', () => {
  const chain: Record<string, unknown> = {}
  for (const k of ['select', 'eq', 'in', 'order', 'limit', 'single', 'maybeSingle']) chain[k] = () => chain
  chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(res)
  return { supabase: { from: () => chain, rpc: m.rpc, channel: vi.fn(), removeChannel: vi.fn() } }
})
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
vi.mock('@/lib/auth', () => {
  const state = { profile: { id: 'me' } }
  return { useAuthStore: (sel: (s: unknown) => unknown) => sel(state) }
})
vi.mock('@/hooks/useUnreadMessages', () => ({ useUnreadMessages: () => ({ count: m.unread }) }))
vi.mock('@/hooks/useClubInvitations', () => ({ useMyClubInvitations: () => ({ invitations: [], loading: false }) }))
vi.mock('@/hooks/friendshipEdgeCache', () => ({
  getFriendshipEdgeState: () => ({ ready: true, edges: m.edges }),
  loadFriendshipEdges: vi.fn(async () => {}),
  subscribeFriendshipEdges: () => () => {},
  invalidateFriendshipEdges: vi.fn(),
}))

import { useNotificationStore } from '@/lib/notifications'
import type { NotificationRecord } from '@/lib/api/notifications'
import { useInboxSegmentDots } from '@/hooks/useInboxSegmentDots'
import { useMarkInboxRequestsSeen } from '@/hooks/useMarkInboxRequestsSeen'
import { inboxTabDot } from '@/lib/inboxSegmentDots'

const NOW = new Date('2026-10-09T12:00:00Z')

const notification = (id: string, kind: NotificationRecord['kind'], sourceEntityId: string | null, createdAt: string): NotificationRecord => ({
  id,
  kind,
  sourceEntityId,
  metadata: {},
  targetUrl: null,
  createdAt,
  readAt: null,
  seenAt: createdAt, // already stamped by the page fetch — NOT what "seen on Requests" means
  clearedAt: null,
  actor: { id: 'someone', fullName: 'Someone', role: 'player', username: null, avatarUrl: null, baseLocation: null },
})

const addRequest = (friendshipId: string, createdAt: string) => {
  m.edges.set(`friend-${friendshipId}`, { id: friendshipId, status: 'pending', requester_id: `from-${friendshipId}`, friend_id: `from-${friendshipId}` })
  act(() => {
    useNotificationStore.setState((s) => ({
      notifications: [notification(`n-${friendshipId}`, 'friend_request_received', friendshipId, createdAt), ...s.notifications],
    }))
  })
}

type Segment = 'messages' | 'requests' | 'activity'

/** What InboxPage + the bottom nav render, minus the chrome. */
function Harness({ segment }: { segment: Segment }) {
  const dots = useInboxSegmentDots()
  // The Requests list shows exactly the pending incoming requests.
  const shown = Array.from(m.edges.values()).filter((e) => e.status === 'pending').map((e) => e.id)
  useMarkInboxRequestsSeen(segment === 'requests', shown, [])
  return (
    <div>
      <span data-testid="requests-dot">{String(dots.requests)}</span>
      <span data-testid="activity-dot">{String(dots.activity)}</span>
      <span data-testid="tab-dot">{String(inboxTabDot(dots))}</span>
    </div>
  )
}

const dot = (id: string) => screen.getByTestId(id).textContent
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

describe('Inbox › Requests dot means "new"', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    m.rpc.mockClear()
    m.unread = 0
    m.edges.clear()
    useNotificationStore.setState({ notifications: [], loading: false, userId: 'me', unreadCount: 0, pendingReadIds: new Set() })
  })
  afterEach(() => { vi.useRealTimers() })

  it('a new pending request lights the Requests dot and the tab-bar dot', () => {
    addRequest('f-1', '2026-10-09T08:00:00Z')
    render(<Harness segment="messages" />)
    expect(dot('requests-dot')).toBe('true')
    expect(dot('tab-dot')).toBe('true')
    expect(m.rpc).not.toHaveBeenCalled() // not seen until Requests is opened
  })

  it('opening Requests marks the shown requests seen (server-side) and clears both dots when nothing else is unread', async () => {
    addRequest('f-1', '2026-10-09T08:00:00Z')
    addRequest('f-2', '2026-10-09T09:00:00Z')
    const view = render(<Harness segment="messages" />)
    view.rerender(<Harness segment="requests" />)
    await flush()

    const marked = m.rpc.mock.calls.filter(([fn]) => fn === 'mark_notification_read').map(([, args]) => (args as { p_notification_id: string }).p_notification_id)
    expect(marked.sort()).toEqual(['n-f-1', 'n-f-2'])
    expect(dot('requests-dot')).toBe('false')
    expect(dot('activity-dot')).toBe('false') // the same rows in Activity are read too
    expect(dot('tab-dot')).toBe('false')
    // Still pending — nothing was accepted or declined.
    expect(Array.from(m.edges.values()).every((e) => e.status === 'pending')).toBe(true)
    expect(m.rpc.mock.calls.some(([fn]) => fn !== 'mark_notification_read')).toBe(false)
    const rows = useNotificationStore.getState().notifications
    expect(rows.every((n) => n.readAt === NOW.toISOString())).toBe(true)
  })

  it('switching to Messages / Activity keeps the Requests dot cleared until a NEW request arrives', async () => {
    addRequest('f-1', '2026-10-09T08:00:00Z')
    const view = render(<Harness segment="requests" />)
    await flush()
    expect(dot('requests-dot')).toBe('false')

    view.rerender(<Harness segment="messages" />)
    await flush()
    expect(dot('requests-dot')).toBe('false')
    view.rerender(<Harness segment="activity" />)
    await flush()
    expect(dot('requests-dot')).toBe('false')
    expect(dot('tab-dot')).toBe('false')

    // A request created after the last visit → new again, on Activity too.
    addRequest('f-2', '2026-10-09T12:30:00Z')
    view.rerender(<Harness segment="activity" />)
    await flush()
    expect(dot('requests-dot')).toBe('true')
    expect(dot('tab-dot')).toBe('true')
    expect(m.rpc.mock.calls.filter(([fn]) => fn === 'mark_notification_read')).toHaveLength(1) // only f-1, from the first visit
  })

  it('seen requests persist: a reload with read_at set from the server shows no dot', () => {
    m.edges.set('friend-f-1', { id: 'f-1', status: 'pending', requester_id: 'from-f-1', friend_id: 'from-f-1' })
    useNotificationStore.setState({
      notifications: [{ ...notification('n-f-1', 'friend_request_received', 'f-1', '2026-10-08T08:00:00Z'), readAt: '2026-10-08T10:00:00Z' }],
    })
    render(<Harness segment="messages" />)
    expect(dot('requests-dot')).toBe('false')
    expect(dot('tab-dot')).toBe('false')
  })

  it('the tab-bar dot stays on for other unread inbox items after Requests is seen', async () => {
    m.unread = 2
    addRequest('f-1', '2026-10-09T08:00:00Z')
    render(<Harness segment="requests" />)
    await flush()
    expect(dot('requests-dot')).toBe('false')
    expect(dot('tab-dot')).toBe('true') // unread messages keep their own rule
  })
})
