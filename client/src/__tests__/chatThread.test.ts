import { describe, expect, it } from 'vitest'
import { mergeFetchedMessages, olderMessagesCursorFilter } from '@/lib/chatThread'

describe('olderMessagesCursorFilter', () => {
  it('quotes the raw timestamp and id; nothing is percent-encoded', () => {
    const filter = olderMessagesCursorFilter({ sentAt: '2026-10-12T12:36:58.741115+00:00', messageId: '127e3fe6-d874-499d-bd9b-b768d4fd9222' })
    expect(filter).toBe('sent_at.lt."2026-10-12T12:36:58.741115+00:00",and(sent_at.eq."2026-10-12T12:36:58.741115+00:00",id.lt."127e3fe6-d874-499d-bd9b-b768d4fd9222")')
    expect(filter).not.toMatch(/%/)
  })

  it('strips quote characters so a value cannot break out of the filter', () => {
    expect(olderMessagesCursorFilter({ sentAt: 'a"b', messageId: 'c\\d' })).toBe('sent_at.lt."ab",and(sent_at.eq."ab",id.lt."cd")')
  })
})

describe('mergeFetchedMessages', () => {
  const m = (id: string, sent_at: string, extra: Record<string, unknown> = {}) => ({ id, sent_at, ...extra })

  it('returns the fetched page as-is when nothing was loaded yet', () => {
    const fetched = [m('a', '2026-01-01T00:00:00Z'), m('b', '2026-01-02T00:00:00Z')]
    expect(mergeFetchedMessages([], fetched)).toEqual(fetched)
  })

  it('keeps older pages, updates rows in place and adds new ones in order', () => {
    const existing = [m('old', '2025-12-01T00:00:00Z'), m('a', '2026-01-01T00:00:00Z', { read_at: null }), m('b', '2026-01-02T00:00:00Z')]
    const fetched = [m('a', '2026-01-01T00:00:00Z', { read_at: '2026-01-03T00:00:00Z' }), m('b', '2026-01-02T00:00:00Z'), m('c', '2026-01-03T00:00:00Z')]
    expect(mergeFetchedMessages(existing, fetched).map(x => x.id)).toEqual(['old', 'a', 'b', 'c'])
    expect(mergeFetchedMessages(existing, fetched)[1]).toMatchObject({ read_at: '2026-01-03T00:00:00Z' })
  })

  it('breaks a sent_at tie by id, matching the server order', () => {
    const t = '2026-01-01T00:00:00Z'
    expect(mergeFetchedMessages([m('b', t)], [m('a', t), m('c', t)]).map(x => x.id)).toEqual(['a', 'b', 'c'])
  })
})
