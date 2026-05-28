/**
 * Profile-strength hook dedupe — pattern regression.
 *
 * Follow-up to the JourneyCard audit (8ee75aa). The three role-specific
 * strength hooks (useProfileStrength / useCoachProfileStrength /
 * useUmpireProfileStrength) each fetched gallery_photos on mount with
 * no dedup. Combined with their dashboard's `strength.refresh()` on
 * tab change + MediaCard's own fetch, the coach landing dashboard
 * fired the same `HEAD /gallery_photos` URL 3× per mount (QA F3 on
 * staging, May 2026).
 *
 * After wrapping each hook in `requestCache.dedupe`:
 *   - Auto-mounts share the cache (parallel mounts → 1 fetch)
 *   - Re-mounts within 30s share the cache (no refetch)
 *   - Explicit `refresh()` busts the cache first so callers who just
 *     edited gallery contents see fresh data
 *
 * useProfileStrength is the canary — the other two share the identical
 * wrapper shape, so one test is enough to lock the pattern in.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { requestCache } from '@/lib/requestCache'

const fromSpy = vi.fn()
vi.mock('@/lib/supabase', () => {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockImplementation(function (this: unknown) {
      const chain = builder as unknown as Record<string, unknown>
      chain.then = (resolve: (v: { count: number; error: null }) => unknown) =>
        Promise.resolve({ count: 7, error: null }).then(resolve)
      return builder
    }),
  }
  return {
    supabase: {
      from: (...args: unknown[]) => {
        fromSpy(...args)
        return builder
      },
    },
  }
})

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { useProfileStrength } from '@/hooks/useProfileStrength'
import type { Profile } from '@/lib/supabase'

const baseProfile = {
  id: 'player-1',
  role: 'player',
  full_name: 'Test Player',
  highlight_video_url: null,
  full_game_video_count: 0,
  current_world_club_id: null,
  career_entry_count: 0,
  accepted_friend_count: 0,
  accepted_reference_count: 0,
} as unknown as Profile

describe('strength hook dedupe (useProfileStrength canary)', () => {
  beforeEach(() => {
    requestCache.clear()
    fromSpy.mockClear()
  })

  it('two parallel mounts share a single gallery_photos fetch', async () => {
    renderHook(() => useProfileStrength(baseProfile))
    renderHook(() => useProfileStrength(baseProfile))
    renderHook(() => useProfileStrength(baseProfile))

    await waitFor(() => {
      expect(fromSpy).toHaveBeenCalledWith('gallery_photos')
    })
    expect(fromSpy.mock.calls.filter((c) => c[0] === 'gallery_photos')).toHaveLength(1)
  })

  it('remount within TTL hits cache — no refetch', async () => {
    const first = renderHook(() => useProfileStrength(baseProfile))
    await waitFor(() => expect(fromSpy).toHaveBeenCalledTimes(1))

    first.unmount()
    renderHook(() => useProfileStrength(baseProfile))

    expect(fromSpy.mock.calls.filter((c) => c[0] === 'gallery_photos')).toHaveLength(1)
  })

  it('refresh() busts the cache and re-fetches even within TTL', async () => {
    const { result } = renderHook(() => useProfileStrength(baseProfile))
    await waitFor(() => expect(fromSpy).toHaveBeenCalledTimes(1))

    // Without bust, an immediate refresh() would hit cache and skip the
    // network. With bust, the explicit "I just edited" semantics work.
    await act(async () => {
      await result.current.refresh()
    })
    expect(fromSpy.mock.calls.filter((c) => c[0] === 'gallery_photos')).toHaveLength(2)
  })
})
