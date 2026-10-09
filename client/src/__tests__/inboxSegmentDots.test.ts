import { describe, expect, it } from 'vitest'
import {
  computeInboxSegmentDots,
  inboxTabDot,
  incomingPendingRequestIds,
  unseenRequestNotificationIds,
  type InboxDotNotification,
} from '@/lib/inboxSegmentDots'

let seq = 0
const note = (readAt: string | null, clearedAt: string | null = null, extra: Partial<InboxDotNotification> = {}): InboxDotNotification => ({
  id: `n-${++seq}`,
  kind: 'profile_viewed',
  sourceEntityId: null,
  readAt,
  clearedAt,
  ...extra,
})
const requestNote = (friendshipId: string, readAt: string | null, clearedAt: string | null = null) =>
  note(readAt, clearedAt, { kind: 'friend_request_received', sourceEntityId: friendshipId })
const SEEN = '2026-10-09T09:00:00Z'
const base = { unreadMessages: 0, pendingRequestIds: [] as string[], notifications: [] as InboxDotNotification[] }

describe('computeInboxSegmentDots', () => {
  it('shows no dots when nothing is unread', () => {
    expect(computeInboxSegmentDots({ ...base, notifications: [note(SEEN)] })).toEqual({ messages: false, requests: false, activity: false })
  })

  it('dots Messages when any message is unread', () => {
    expect(computeInboxSegmentDots({ ...base, unreadMessages: 3 }).messages).toBe(true)
  })

  it('dots Requests for a pending received request that has not been seen', () => {
    expect(computeInboxSegmentDots({ ...base, pendingRequestIds: ['f-1'], notifications: [requestNote('f-1', null)] }).requests).toBe(true)
  })

  it('pending but SEEN → no Requests dot (a dot means new, not pending)', () => {
    const dots = computeInboxSegmentDots({ ...base, pendingRequestIds: ['f-1'], notifications: [requestNote('f-1', SEEN)] })
    expect(dots).toEqual({ messages: false, requests: false, activity: false })
  })

  it('a pending request with no unread notification is not new', () => {
    expect(computeInboxSegmentDots({ ...base, pendingRequestIds: ['f-old'] }).requests).toBe(false)
  })

  it('a new request after the others were seen brings the dot back', () => {
    const notifications = [requestNote('f-1', SEEN), requestNote('f-2', null)]
    expect(computeInboxSegmentDots({ ...base, pendingRequestIds: ['f-1', 'f-2'], notifications }).requests).toBe(true)
  })

  it('an unread request notification whose request is no longer pending is not a Requests dot', () => {
    expect(computeInboxSegmentDots({ ...base, notifications: [requestNote('f-1', null)] }).requests).toBe(false)
  })

  it('dots Activity for an unread, uncleared notification', () => {
    expect(computeInboxSegmentDots({ ...base, notifications: [note(null)] }).activity).toBe(true)
  })

  it('ignores cleared notifications even when unread', () => {
    expect(computeInboxSegmentDots({ ...base, notifications: [note(null, '2026-09-02')] }).activity).toBe(false)
    expect(computeInboxSegmentDots({ ...base, pendingRequestIds: ['f-1'], notifications: [requestNote('f-1', null, '2026-09-02')] }).requests).toBe(false)
  })
})

describe('unseenRequestNotificationIds', () => {
  it('returns only unread rows of pending friend requests and squad invitations', () => {
    const a = requestNote('f-1', null)
    const b = requestNote('f-2', SEEN)
    const c = note(null, null, { kind: 'club_invitation_received', sourceEntityId: 'cm-1' })
    const d = note(null, null, { kind: 'friend_request_accepted', sourceEntityId: 'f-1' })
    const e = requestNote('f-gone', null)
    expect(unseenRequestNotificationIds({ pendingRequestIds: ['f-1', 'f-2'], clubInvitationIds: ['cm-1'], notifications: [a, b, c, d, e] })).toEqual([a.id, c.id])
  })
})

describe('inboxTabDot', () => {
  const combos = [false, true].flatMap((messages) =>
    [false, true].flatMap((requests) => [false, true].map((activity) => ({ messages, requests, activity }))),
  )

  it.each(combos)('equals "any segment dot" for %o', (dots) => {
    expect(inboxTabDot(dots)).toBe(dots.messages || dots.requests || dots.activity)
  })

  it('follows the segment rules end to end', () => {
    expect(inboxTabDot(computeInboxSegmentDots({ ...base, notifications: [note(null)] }))).toBe(true)
    expect(inboxTabDot(computeInboxSegmentDots({ ...base, notifications: [note(SEEN)] }))).toBe(false)
    expect(inboxTabDot(computeInboxSegmentDots({ ...base, pendingRequestIds: ['f-1'], notifications: [requestNote('f-1', SEEN)] }))).toBe(false)
  })
})

describe('incomingPendingRequestIds', () => {
  const viewer = 'viewer'
  it('lists only pending requests someone else sent', () => {
    const edges = [
      { id: 'f-1', status: 'pending', requester_id: 'other-1' },
      { id: 'f-2', status: 'pending', requester_id: viewer },
      { id: 'f-3', status: 'accepted', requester_id: 'other-2' },
      { id: 'f-4', status: 'pending', requester_id: 'other-3' },
      { id: null, status: 'pending', requester_id: 'other-4' },
    ]
    expect(incomingPendingRequestIds(edges, viewer)).toEqual(['f-1', 'f-4'])
  })

  it('is empty without a viewer', () => {
    expect(incomingPendingRequestIds([{ id: 'f-1', status: 'pending', requester_id: 'x' }], null)).toEqual([])
  })
})
