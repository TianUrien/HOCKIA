/**
 * Home N+1 (Sentry JAVASCRIPT-REACT-D7 class, 2026-10-21): every role card
 * asks for its own club's photos and crest colours; cards mounted in the same
 * tick now share ONE get_member_photos call and ONE club_crest_colors read.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), inCalls: [] as string[][] }))
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: mocks.rpc,
    from: () => {
      const chain = {
        select: () => chain,
        in: (_col: string, ids: string[]) => {
          mocks.inCalls.push(ids)
          return Promise.resolve({ data: ids.filter((id) => id !== 'none').map((id) => ({ profile_id: id, crest_url: `https://x/${id}.png`, color: '#123456', palette: null })), error: null })
        },
      }
      return chain
    },
  },
}))
vi.mock('@/lib/auth', () => ({ useAuthStore: (sel: (s: { user: null }) => unknown) => sel({ user: null }) }))
vi.mock('@/lib/crestColor', () => ({ extractCrestColors: vi.fn(() => Promise.resolve(null)) }))

import { queryClient } from '@/lib/queryClient'
import { useMemberPhotos } from '@/hooks/useMemberPhotos'
import { useClubCrestColors } from '@/hooks/useClubCrestColors'
import { createTickBatcher } from '@/lib/tickBatcher'

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>

beforeEach(() => {
  queryClient.clear()
  mocks.rpc.mockReset()
  mocks.inCalls.length = 0
})

describe('createTickBatcher', () => {
  it('one fetch per tick, deduped keys, each waiter gets its own value', async () => {
    const fetchMany = vi.fn(async (keys: string[]) => new Map(keys.map((k) => [k, k.toUpperCase()])))
    const b = createTickBatcher(fetchMany)
    const out = await Promise.all([b.load('a'), b.load('b'), b.load('a')])
    expect(out).toEqual(['A', 'B', 'A'])
    expect(fetchMany).toHaveBeenCalledTimes(1)
    expect(fetchMany.mock.calls[0][0]).toEqual(['a', 'b'])
  })

  it('splits at the cap', async () => {
    const fetchMany = vi.fn(async (keys: string[]) => new Map(keys.map((k) => [k, k])))
    const b = createTickBatcher(fetchMany, { max: 2 })
    await Promise.all(['a', 'b', 'c'].map((k) => b.load(k)))
    expect(fetchMany).toHaveBeenCalledTimes(2)
  })

  it('a failed read rejects that batch, and the next load reads again', async () => {
    const fetchMany = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(new Map([['a', 1]]))
    const b = createTickBatcher<number>(fetchMany)
    await expect(b.load('a')).rejects.toThrow('down')
    await expect(b.load('a')).resolves.toBe(1)
  })
})

describe('Home cards share their reads', () => {
  it('three role cards → one get_member_photos call', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ profile_id: 'c1', url: 'p1', ord: 1 }, { profile_id: 'c3', url: 'p3', ord: 1 }], error: null })
    const { result } = renderHook(() => [useMemberPhotos('c1'), useMemberPhotos('c2'), useMemberPhotos('c3')], { wrapper })
    await waitFor(() => expect(result.current.every((q) => q.isSuccess)).toBe(true))
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect([...mocks.rpc.mock.calls[0][1].p_profile_ids].sort()).toEqual(['c1', 'c2', 'c3'])
    expect(result.current.map((q) => q.data)).toEqual([['p1'], [], ['p3']])
  })

  it('three cards with one club each → one club_crest_colors read', async () => {
    const { result } = renderHook(() => [
      useClubCrestColors([{ id: 'k1', avatar_url: 'https://x/k1.png' }]),
      useClubCrestColors([{ id: 'k2', avatar_url: 'https://x/k2.png' }]),
      useClubCrestColors([{ id: 'k3', avatar_url: 'https://x/k3.png' }]),
    ], { wrapper })
    await waitFor(() => expect(result.current.every((m) => [...m.values()][0] === '#123456')).toBe(true))
    expect(mocks.inCalls).toHaveLength(1)
    expect([...mocks.inCalls[0]].sort()).toEqual(['k1', 'k2', 'k3'])
  })
})
