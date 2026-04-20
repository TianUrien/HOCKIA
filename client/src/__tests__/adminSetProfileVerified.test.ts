import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setProfileVerified } from '@/features/admin/api/adminApi'

// Capture the rpc arguments that adminApi fires so we can assert shape.
let rpcCalls: { fn: string; args: Record<string, unknown> }[] = []
let rpcError: { message: string } | null = null

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args })
      return Promise.resolve({ data: null, error: rpcError })
    },
  },
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
}))

beforeEach(() => {
  rpcCalls = []
  rpcError = null
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('setProfileVerified', () => {
  it('calls admin_set_profile_verified with the profile id and value', async () => {
    await setProfileVerified('profile-abc', true)
    expect(rpcCalls).toHaveLength(1)
    expect(rpcCalls[0].fn).toBe('admin_set_profile_verified')
    expect(rpcCalls[0].args).toEqual({ p_profile_id: 'profile-abc', p_value: true })
  })

  it('forwards false values to the RPC (revoke path)', async () => {
    await setProfileVerified('profile-xyz', false)
    expect(rpcCalls[0].args).toEqual({ p_profile_id: 'profile-xyz', p_value: false })
  })

  it('rejects with a descriptive error when the RPC fails', async () => {
    rpcError = { message: 'Unauthorized: Admin access required' }
    await expect(setProfileVerified('profile-abc', true)).rejects.toThrow(
      /Failed to set verified status: Unauthorized/
    )
  })
})
