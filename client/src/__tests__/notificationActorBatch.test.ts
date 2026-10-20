import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Sentry N+1 JAVASCRIPT-REACT-CX (2026-10-19): marking a page of notifications
 * seen fires one realtime UPDATE per row, and each event read its actor with
 * its own `profiles?id=eq.<actor>` request, repeating the same actors. Actors
 * requested in the same tick now share one `id IN (…)` read; an actor already
 * in flight is not asked for twice; and an UPDATE reuses the actor the store
 * already holds.
 */
const inCalls: string[][] = []
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        in: (_col: string, ids: string[]) => {
          inCalls.push(ids)
          return Promise.resolve({
            data: ids.map((id) => ({ id, full_name: `Name ${id}`, role: 'player', username: id, avatar_url: null, base_location: null })),
            error: null,
          })
        },
      }),
    }),
  },
}))
vi.mock('@/lib/queryClient', () => ({ queryClient: { invalidateQueries: vi.fn() } }))

import { fetchActorProfile, knownActor } from '@/lib/notifications'
import type { NotificationRecord } from '@/lib/api/notifications'

beforeEach(() => { inCalls.length = 0 })

describe('fetchActorProfile', () => {
  it('reads every actor requested in one tick with a single IN query, once per actor', async () => {
    const results = await Promise.all([
      fetchActorProfile('a'), fetchActorProfile('b'), fetchActorProfile('a'), fetchActorProfile('c'), fetchActorProfile('b'),
    ])
    expect(inCalls).toHaveLength(1)
    expect([...inCalls[0]].sort()).toEqual(['a', 'b', 'c'])
    expect(results.map((r) => r?.full_name)).toEqual(['Name a', 'Name b', 'Name a', 'Name c', 'Name b'])
  })

  it('serves a cached actor without another request', async () => {
    await fetchActorProfile('a')
    const again = await fetchActorProfile('a')
    expect(again?.full_name).toBe('Name a')
    expect(inCalls).toHaveLength(0)
  })
})

describe('knownActor', () => {
  const rec = (id: string, actorId: string | null, fullName: string | null): NotificationRecord => ({
    id, kind: 'friend_request_received', sourceEntityId: null, metadata: {}, targetUrl: null,
    createdAt: '2026-10-19T00:00:00Z', readAt: null, seenAt: null, clearedAt: null,
    actor: { id: actorId, fullName, role: 'player', username: null, avatarUrl: null, baseLocation: null },
  })

  it('reuses the actor of the same notification, or of another one by the same actor', () => {
    const list = [rec('n1', 'x', 'Xavi'), rec('n2', 'y', 'Yara')]
    expect(knownActor(list, 'n1', 'x')?.full_name).toBe('Xavi')
    expect(knownActor(list, 'n9', 'y')?.full_name).toBe('Yara')
  })

  it('returns null when the store has no name for that actor', () => {
    const list = [rec('n1', 'x', null)]
    expect(knownActor(list, 'n1', 'x')).toBeNull()
    expect(knownActor(list, 'n1', 'z')).toBeNull()
  })
})
