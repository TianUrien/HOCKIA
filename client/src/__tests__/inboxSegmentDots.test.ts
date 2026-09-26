import { describe, expect, it } from 'vitest'
import { computeInboxSegmentDots, countIncomingPendingRequests, inboxTabDot } from '@/lib/inboxSegmentDots'

const note = (readAt: string | null, clearedAt: string | null = null) => ({ readAt, clearedAt })

describe('computeInboxSegmentDots', () => {
  it('shows no dots when nothing is unread', () => {
    expect(
      computeInboxSegmentDots({ unreadMessages: 0, incomingRequests: 0, notifications: [note('2026-09-01')] }),
    ).toEqual({ messages: false, requests: false, activity: false })
  })

  it('dots Messages when any message is unread', () => {
    expect(computeInboxSegmentDots({ unreadMessages: 3, incomingRequests: 0, notifications: [] }).messages).toBe(true)
  })

  it('dots Requests only for received pending requests', () => {
    expect(computeInboxSegmentDots({ unreadMessages: 0, incomingRequests: 1, notifications: [] }).requests).toBe(true)
    expect(computeInboxSegmentDots({ unreadMessages: 0, incomingRequests: 0, notifications: [] }).requests).toBe(false)
  })

  it('dots Activity for an unread, uncleared notification', () => {
    expect(computeInboxSegmentDots({ unreadMessages: 0, incomingRequests: 0, notifications: [note(null)] }).activity).toBe(true)
  })

  it('ignores cleared notifications even when unread', () => {
    expect(
      computeInboxSegmentDots({ unreadMessages: 0, incomingRequests: 0, notifications: [note(null, '2026-09-02')] }).activity,
    ).toBe(false)
  })

  it('keeps segments independent', () => {
    expect(
      computeInboxSegmentDots({ unreadMessages: 0, incomingRequests: 2, notifications: [note('2026-09-01')] }),
    ).toEqual({ messages: false, requests: true, activity: false })
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
    const dots = computeInboxSegmentDots({ unreadMessages: 0, incomingRequests: 0, notifications: [note(null)] })
    expect(inboxTabDot(dots)).toBe(true)
    const none = computeInboxSegmentDots({ unreadMessages: 0, incomingRequests: 0, notifications: [note('2026-09-01')] })
    expect(inboxTabDot(none)).toBe(false)
  })
})

describe('countIncomingPendingRequests', () => {
  const viewer = 'viewer'
  it('counts only pending requests someone else sent', () => {
    const edges = [
      { status: 'pending', requester_id: 'other-1' },
      { status: 'pending', requester_id: viewer },
      { status: 'accepted', requester_id: 'other-2' },
      { status: 'pending', requester_id: 'other-3' },
    ]
    expect(countIncomingPendingRequests(edges, viewer)).toBe(2)
  })

  it('is zero without a viewer', () => {
    expect(countIncomingPendingRequests([{ status: 'pending', requester_id: 'x' }], null)).toBe(0)
  })
})
