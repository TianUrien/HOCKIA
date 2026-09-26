import { describe, expect, it } from 'vitest'
import { computeInboxSegmentDots } from '@/lib/inboxSegmentDots'

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
