/**
 * get_member_photos client: one call for many members, cached per member,
 * avatar excluded, members without photos resolve to [].
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase', () => ({ supabase: { rpc } }))

import { queryClient } from '@/lib/queryClient'
import { qk } from '@/lib/queryKeys'
import { prefetchMemberPhotos, useMemberPhotos } from '@/hooks/useMemberPhotos'

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>

beforeEach(() => {
  queryClient.clear()
  rpc.mockReset()
})
afterEach(() => queryClient.clear())

describe('useMemberPhotos', () => {
  it('returns the member photos in server order', async () => {
    rpc.mockResolvedValue({ data: [{ profile_id: 'a', url: 'u1', ord: 1 }, { profile_id: 'a', url: 'u2', ord: 2 }], error: null })
    const { result } = renderHook(() => useMemberPhotos('a'), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual(['u1', 'u2']))
    expect(rpc).toHaveBeenCalledWith('get_member_photos', { p_profile_ids: ['a'], p_per_member: 5 })
  })

  it('a member without gallery photos resolves to []', async () => {
    rpc.mockResolvedValue({ data: [], error: null })
    const { result } = renderHook(() => useMemberPhotos('b'), { wrapper })
    await waitFor(() => expect(result.current.data).toEqual([]))
  })

  it('does nothing without an id', () => {
    renderHook(() => useMemberPhotos(null), { wrapper })
    expect(rpc).not.toHaveBeenCalled()
  })
})

describe('prefetchMemberPhotos', () => {
  it('fetches many members in ONE call and fills each member cache (deck prefetch)', async () => {
    rpc.mockResolvedValue({ data: [{ profile_id: 'x', url: 'p1', ord: 1 }], error: null })
    await prefetchMemberPhotos(['x', 'y', 'x'])
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc.mock.calls[0][1].p_profile_ids.sort()).toEqual(['x', 'y'])
    expect(queryClient.getQueryData(qk.memberPhotos('x'))).toEqual(['p1'])
    expect(queryClient.getQueryData(qk.memberPhotos('y'))).toEqual([])
    // Already cached → no second call.
    await prefetchMemberPhotos(['x', 'y'])
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('is best effort: an error never throws', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'down' } })
    await expect(prefetchMemberPhotos(['z'])).resolves.toBeUndefined()
  })
})

describe('get_member_photos migration', () => {
  const sql = readFileSync(resolve(__dirname, '../../../supabase/migrations/20261011110000_get_member_photos.sql'), 'utf8')
  it('runs as the caller (RLS keeps hidden profiles out), caps 60 members x 5 photos, explicit grants', () => {
    expect(sql).toContain('SECURITY INVOKER')
    expect(sql).toContain('p_profile_ids[1:60]')
    expect(sql).toContain('LEAST(GREATEST(COALESCE(p_per_member, 5), 1), 5)')
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.get_member_photos(uuid[], integer) FROM PUBLIC;')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.get_member_photos(uuid[], integer) TO anon, authenticated, service_role;')
  })
})
