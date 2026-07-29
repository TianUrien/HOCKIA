/**
 * Profile-strength gallery fetch — dedupe regression, React Query edition.
 *
 * History: the three role-specific strength hooks each fetched
 * gallery_photos on mount with no dedup; the coach landing dashboard fired
 * the same `HEAD /gallery_photos` URL 3× per mount (QA F3 on staging,
 * May 2026). That was fixed with requestCache.dedupe, then migrated to a
 * single shared React Query hook (useGalleryCount) in the requestCache →
 * React Query move (2026-07-29). These tests pin the SAME four behaviours
 * under the new engine, plus the cross-hook sharing the migration unlocked:
 *   - Parallel mounts share one fetch (RQ in-flight dedupe)
 *   - Remounts within the 30s staleTime serve cache — no refetch
 *   - Explicit refresh() forces a network call even while fresh
 *   - refresh() fired while the auto-fetch is in flight JOINS it instead
 *     of racing it (the aa52843 race, now refetch({ cancelRefetch: false }))
 *
 * useProfileStrength is the canary — coach/umpire consume the identical
 * shared hook, so one suite locks the pattern for all three.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const galleryFetch = vi.hoisted(() => ({
  calls: 0,
  /** When true, fetches stay pending until release() is called. */
  manual: false,
  pending: [] as Array<() => void>,
  release() {
    this.pending.forEach((resolve) => resolve())
    this.pending = []
  },
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => {
          galleryFetch.calls++
          const result = { count: 7, error: null }
          if (!galleryFetch.manual) return Promise.resolve(result)
          return new Promise((resolve) => {
            galleryFetch.pending.push(() => resolve(result))
          })
        },
      }),
    }),
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { useProfileStrength } from '@/hooks/useProfileStrength'
import { useGalleryCount } from '@/hooks/useGalleryCount'
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

describe('strength hook dedupe (useProfileStrength canary, React Query)', () => {
  let queryClient: QueryClient
  let wrapper: ({ children }: { children: ReactNode }) => JSX.Element

  beforeEach(() => {
    galleryFetch.calls = 0
    galleryFetch.manual = false
    galleryFetch.pending = []
    // Fresh cache per test; retries off so a thrown queryFn fails fast.
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
  })

  it('three parallel mounts share a single gallery_photos fetch', async () => {
    const a = renderHook(() => useProfileStrength(baseProfile), { wrapper })
    renderHook(() => useProfileStrength(baseProfile), { wrapper })
    renderHook(() => useProfileStrength(baseProfile), { wrapper })

    await waitFor(() => expect(a.result.current.loading).toBe(false))
    expect(galleryFetch.calls).toBe(1)
  })

  it('remount within staleTime serves cache — no refetch', async () => {
    const first = renderHook(() => useProfileStrength(baseProfile), { wrapper })
    await waitFor(() => expect(first.result.current.loading).toBe(false))

    first.unmount()
    const second = renderHook(() => useProfileStrength(baseProfile), { wrapper })

    // Cached data is fresh (staleTime 30s) → available immediately, no fetch.
    expect(second.result.current.loading).toBe(false)
    expect(galleryFetch.calls).toBe(1)
  })

  it('refresh() forces a network call even while data is fresh', async () => {
    const { result } = renderHook(() => useProfileStrength(baseProfile), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(galleryFetch.calls).toBe(1)

    // Explicit "I just edited my gallery" — must bypass the freshness window.
    await act(async () => {
      await result.current.refresh()
    })
    expect(galleryFetch.calls).toBe(2)
  })

  it('refresh() during the initial in-flight fetch joins it (aa52843 race)', async () => {
    // The original requestCache regression: refresh() fired in the same
    // render cycle as the hook's auto-fetch produced two identical requests.
    // RQ makes this inherently safe — while data is still undefined, fetch()
    // always joins the running request (cancelRefetch only applies once
    // data exists) — but the behaviour is the contract, so keep it pinned.
    galleryFetch.manual = true
    const { result } = renderHook(() => useProfileStrength(baseProfile), { wrapper })
    await waitFor(() => expect(galleryFetch.calls).toBe(1))

    // Fire refresh() while fetch #1 is still pending, then let it resolve.
    let refreshPromise: Promise<void>
    act(() => {
      refreshPromise = result.current.refresh()
    })
    await act(async () => {
      galleryFetch.release()
      await refreshPromise
    })

    expect(galleryFetch.calls).toBe(1)
    await waitFor(() => expect(result.current.loading).toBe(false))
  })

  it('overlapping refresh() calls share one network request', async () => {
    // Once data exists, refetch()'s DEFAULT cancelRefetch:true would cancel
    // a running refetch and start another — two dashboard surfaces calling
    // refresh() together (e.g. tab-effect + post-upload) would duplicate the
    // request, the modern form of the aa52843 race. The hook passes
    // { cancelRefetch: false } so the second caller joins the first.
    const { result } = renderHook(() => useProfileStrength(baseProfile), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(galleryFetch.calls).toBe(1)

    galleryFetch.manual = true
    let first: Promise<void>
    act(() => {
      first = result.current.refresh()
    })
    await waitFor(() => expect(galleryFetch.calls).toBe(2))

    let second: Promise<void>
    act(() => {
      second = result.current.refresh()
    })
    await act(async () => {
      galleryFetch.release()
      await Promise.all([first, second])
    })

    expect(galleryFetch.calls).toBe(2)
  })

  it('player strength hook and useGalleryCount share one cache entry', async () => {
    // The migration's win over requestCache: the per-role key split
    // (player-/coach-/umpire-strength-gallery-*) collapsed into one
    // qk.galleryCount key, so ANY consumer of the count joins the same
    // round trip.
    const { result } = renderHook(
      () => ({
        strength: useProfileStrength(baseProfile),
        gallery: useGalleryCount(baseProfile.id),
      }),
      { wrapper },
    )

    await waitFor(() => expect(result.current.strength.loading).toBe(false))
    expect(result.current.gallery.count).toBe(7)
    expect(galleryFetch.calls).toBe(1)
  })
})
