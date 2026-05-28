/**
 * useShortlists — shared-store dedupe contract.
 *
 * Regression test for F3: the Players-tab QA pass reported 7 identical
 * `?select=*,saved_profiles(count)` GETs in a single interaction.
 * Each consumer (MoveToShortlistMenu picker, ShortlistsIndex,
 * ShortlistDetail) was firing its own fetch on mount.
 *
 * After moving state into a module-level zustand store, N mounts
 * should fire a single fetch. Mutations re-run the fetch through
 * `refresh()` so item counts stay current after writes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

// Spy on supabase.from to count list fetches. The chained builder
// returns the expected shape after the final order() so the hook can
// resolve.
const fromSpy = vi.fn()
vi.mock('@/lib/supabase', () => {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockImplementation(function (this: unknown) {
      // The hook awaits the second .order() — return a thenable with
      // the resolved data shape.
      const chain = builder as unknown as Record<string, unknown>
      chain.then = (resolve: (v: { data: unknown; error: null }) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve)
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

vi.mock('@/lib/auth', () => ({
  useAuthStore: () => ({ profile: { id: 'viewer-1', role: 'club' } }),
}))

vi.mock('@/lib/toast', () => ({ useToastStore: () => ({ addToast: vi.fn() }) }))
vi.mock('@/lib/sentryHelpers', () => ({ reportSupabaseError: vi.fn() }))
vi.mock('@/lib/trackDbEvent', () => ({ trackDbEvent: vi.fn() }))

import { useShortlists, __resetShortlistsStoreForTests } from '@/hooks/useShortlists'

describe('useShortlists — shared store', () => {
  beforeEach(() => {
    __resetShortlistsStoreForTests()
    fromSpy.mockClear()
  })

  it('fires exactly one fetch when many consumers mount in parallel', async () => {
    renderHook(() => useShortlists())
    renderHook(() => useShortlists())
    renderHook(() => useShortlists())
    renderHook(() => useShortlists())
    renderHook(() => useShortlists())

    await waitFor(() => {
      expect(fromSpy).toHaveBeenCalledWith('shortlists')
    })
    // 5 consumers → 1 fetch (dedupe via in-flight join + cache hit).
    expect(fromSpy.mock.calls.filter((c) => c[0] === 'shortlists')).toHaveLength(1)
  })

  it('does not re-fetch when a consumer unmounts and another remounts', async () => {
    const first = renderHook(() => useShortlists())
    await waitFor(() => expect(fromSpy).toHaveBeenCalledTimes(1))

    first.unmount()
    renderHook(() => useShortlists())
    renderHook(() => useShortlists())

    // Cache stays — no new fetch.
    expect(fromSpy.mock.calls.filter((c) => c[0] === 'shortlists')).toHaveLength(1)
  })

  it('refresh() forces a fresh fetch (mutations rely on this)', async () => {
    const { result } = renderHook(() => useShortlists())
    await waitFor(() => expect(fromSpy).toHaveBeenCalledTimes(1))

    await act(async () => {
      await result.current.refresh()
    })
    expect(fromSpy.mock.calls.filter((c) => c[0] === 'shortlists')).toHaveLength(2)
  })
})
