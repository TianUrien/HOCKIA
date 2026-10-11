import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...args: unknown[]) => rpc(...args) } }))
vi.mock('@/lib/auth', () => ({ useAuthStore: Object.assign(() => null, { getState: () => ({ user: { id: 'viewer' } }) }) }))

import { queryClient } from '@/lib/queryClient'
import { prefetchFriendsInCommon } from '@/hooks/useFriendsInCommonBatch'

describe('friends in common, batched', () => {
  beforeEach(() => {
    rpc.mockReset()
    queryClient.clear()
  })

  it('one call for many members; up to three friends and the total each', async () => {
    rpc.mockResolvedValue({
      data: [
        { member_id: 'a', friend_id: 'f1', full_name: 'Ana', avatar_url: null, role: 'player', total: 5 },
        { member_id: 'a', friend_id: 'f2', full_name: 'Luis', avatar_url: null, role: 'coach', total: 5 },
        { member_id: 'b', friend_id: 'f3', full_name: 'Sol', avatar_url: 'x.jpg', role: 'player', total: 1 },
      ],
      error: null,
    })
    await prefetchFriendsInCommon(['a', 'b', 'c', 'viewer'])
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('get_friends_in_common', { p_member_ids: ['a', 'b', 'c'] })
    expect(queryClient.getQueryData(['friends-in-common', 'viewer', 'a'])).toEqual({
      people: [
        { id: 'f1', fullName: 'Ana', avatarUrl: null, role: 'player' },
        { id: 'f2', fullName: 'Luis', avatarUrl: null, role: 'coach' },
      ],
      count: 5,
    })
    expect(queryClient.getQueryData(['friends-in-common', 'viewer', 'c'])).toEqual({ people: [], count: 0 })
  })

  it('members already loaded are not asked again', async () => {
    rpc.mockResolvedValue({ data: [], error: null })
    await prefetchFriendsInCommon(['a'])
    await prefetchFriendsInCommon(['a', 'b'])
    expect(rpc).toHaveBeenLastCalledWith('get_friends_in_common', { p_member_ids: ['b'] })
  })
})
