import { describe, it, expect, vi } from 'vitest'

// A chainable fake of the one PostgREST query the batcher issues; records the
// `in` and range arguments so the test can assert ONE request covers all cards.
const calls: Array<{ table: string; ids?: string[]; gte?: string; lt?: string }> = []
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from(table: string) {
      const call: { table: string; ids?: string[]; gte?: string; lt?: string } = { table }
      calls.push(call)
      const chain = {
        select: () => chain,
        in: (_col: string, ids: string[]) => { call.ids = ids; return chain },
        gte: (_col: string, v: string) => { call.gte = v; return chain },
        lt: (_col: string, v: string) => { call.lt = v; return chain },
        order: () => Promise.resolve({
          data: [
            { user_id: 'u1', photo_url: 'p1', created_at: '2026-10-18T09:00:00Z' },
            { user_id: 'u2', photo_url: 'p2', created_at: '2026-10-19T09:00:00Z' },
            { user_id: 'u2', photo_url: 'p3', created_at: '2026-10-19T10:00:00Z' },
          ],
          error: null,
        }),
      }
      return chain
    },
  },
}))

import { fetchActivityPhotos } from '@/hooks/useActivityPhotos'

/** Sentry JAVASCRIPT-REACT-D7: cards visible in the same tick share one gallery_photos request. */
describe('fetchActivityPhotos batching', () => {
  it('collapses same-tick requests into one IN query over the widest day window', async () => {
    const [a, b] = await Promise.all([fetchActivityPhotos('u1', '2026-10-18'), fetchActivityPhotos('u2', '2026-10-19')])
    expect(calls).toHaveLength(1)
    expect(calls[0].table).toBe('gallery_photos')
    expect(calls[0].ids).toEqual(['u1', 'u2'])
    expect(calls[0].gte).toBe('2026-10-18T00:00:00Z')
    expect(calls[0].lt).toBe('2026-10-20T00:00:00.000Z')
    expect(a).toEqual(['p1'])
    expect(b).toEqual(['p2', 'p3'])
  })
})
