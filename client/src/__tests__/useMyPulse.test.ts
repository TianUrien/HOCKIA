import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useMyPulse, type PulseItem } from '@/hooks/useMyPulse'

// ── Auth-store mock — useMyPulse only reads user.id, so a tiny selector
//    mock is enough. Returning null for the empty-state branches.
let mockUserId: string | null = 'user-1'
vi.mock('@/lib/auth', () => ({
  useAuthStore: (selector: (state: { user: { id: string } | null }) => unknown) =>
    selector({ user: mockUserId ? { id: mockUserId } : null }),
}))

// ── Supabase mock — captures rpc args + lets each test stash a return.
interface RpcState {
  // Per-RPC-name: { args last seen, result to return }
  calls: Record<string, { args: unknown; count: number }>
  results: Record<string, { data: unknown; error: { message: string } | null }>
}
const rpcState: RpcState = {
  calls: {},
  results: {},
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (fn: string, args: unknown) => {
      const prev = rpcState.calls[fn] ?? { args: null, count: 0 }
      rpcState.calls[fn] = { args, count: prev.count + 1 }
      return Promise.resolve(rpcState.results[fn] ?? { data: null, error: null })
    },
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

beforeEach(() => {
  rpcState.calls = {}
  rpcState.results = {}
  mockUserId = 'user-1'
})

afterEach(() => {
  vi.restoreAllMocks()
})

const buildPulse = (overrides: Partial<PulseItem> = {}): PulseItem => ({
  id: 'p-1',
  user_id: 'user-1',
  item_type: 'snapshot_gain_celebration',
  priority: 3,
  metadata: {},
  created_at: '2026-05-04T10:00:00.000Z',
  seen_at: null,
  clicked_at: null,
  action_completed_at: null,
  dismissed_at: null,
  ...overrides,
})

describe('useMyPulse — fetch', () => {
  it('returns empty + isLoading=false when user is signed out', async () => {
    mockUserId = null
    const { result } = renderHook(() => useMyPulse())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.items).toEqual([])
    expect(rpcState.calls.get_my_pulse).toBeUndefined()
  })

  it('fetches via get_my_pulse RPC on mount when signed in', async () => {
    rpcState.results.get_my_pulse = { data: [buildPulse()], error: null }
    const { result } = renderHook(() => useMyPulse())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.items).toHaveLength(1)
    expect(result.current.items[0].id).toBe('p-1')
    expect(rpcState.calls.get_my_pulse?.args).toEqual({ p_limit: 20 })
  })

  it('exposes RPC error on the hook', async () => {
    rpcState.results.get_my_pulse = { data: null, error: { message: 'boom' } }
    const { result } = renderHook(() => useMyPulse())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.error).toBe('boom')
    expect(result.current.items).toEqual([])
  })
})

describe('useMyPulse — markSeen', () => {
  it('no-ops on empty array (no RPC call)', async () => {
    rpcState.results.get_my_pulse = { data: [], error: null }
    const { result } = renderHook(() => useMyPulse())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await act(async () => {
      await result.current.markSeen([])
    })
    expect(rpcState.calls.mark_pulse_seen).toBeUndefined()
  })

  it('optimistically stamps seen_at + calls mark_pulse_seen RPC', async () => {
    rpcState.results.get_my_pulse = { data: [buildPulse()], error: null }
    rpcState.results.mark_pulse_seen = { data: 1, error: null }
    const { result } = renderHook(() => useMyPulse())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.markSeen(['p-1'])
    })

    expect(result.current.items[0].seen_at).not.toBeNull()
    expect(rpcState.calls.mark_pulse_seen?.args).toEqual({ p_pulse_ids: ['p-1'] })
  })

  it('does not overwrite an existing seen_at on optimistic stamp', async () => {
    const already = '2026-05-04T08:00:00.000Z'
    rpcState.results.get_my_pulse = { data: [buildPulse({ seen_at: already })], error: null }
    rpcState.results.mark_pulse_seen = { data: 0, error: null }
    const { result } = renderHook(() => useMyPulse())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.markSeen(['p-1'])
    })

    expect(result.current.items[0].seen_at).toBe(already)
  })
})

describe('useMyPulse — markClicked', () => {
  it('stamps clicked_at + seen_at when both NULL', async () => {
    rpcState.results.get_my_pulse = { data: [buildPulse()], error: null }
    rpcState.results.mark_pulse_clicked = { data: buildPulse(), error: null }
    const { result } = renderHook(() => useMyPulse())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.markClicked('p-1')
    })

    expect(result.current.items[0].clicked_at).not.toBeNull()
    expect(result.current.items[0].seen_at).not.toBeNull()
    expect(rpcState.calls.mark_pulse_clicked?.args).toEqual({ p_pulse_id: 'p-1' })
  })

  it('preserves existing seen_at + clicked_at on idempotent re-click', async () => {
    const seenAt = '2026-05-04T08:00:00.000Z'
    const clickedAt = '2026-05-04T09:00:00.000Z'
    rpcState.results.get_my_pulse = {
      data: [buildPulse({ seen_at: seenAt, clicked_at: clickedAt })],
      error: null,
    }
    rpcState.results.mark_pulse_clicked = { data: buildPulse(), error: null }
    const { result } = renderHook(() => useMyPulse())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.markClicked('p-1')
    })

    expect(result.current.items[0].seen_at).toBe(seenAt)
    expect(result.current.items[0].clicked_at).toBe(clickedAt)
  })
})

describe('useMyPulse — markDismissed', () => {
  it('optimistically removes the item from the list', async () => {
    rpcState.results.get_my_pulse = { data: [buildPulse(), buildPulse({ id: 'p-2' })], error: null }
    rpcState.results.mark_pulse_dismissed = { data: buildPulse(), error: null }
    const { result } = renderHook(() => useMyPulse())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.items).toHaveLength(2)

    await act(async () => {
      await result.current.markDismissed('p-1')
    })

    expect(result.current.items).toHaveLength(1)
    expect(result.current.items[0].id).toBe('p-2')
    expect(rpcState.calls.mark_pulse_dismissed?.args).toEqual({ p_pulse_id: 'p-1' })
  })

  it('restores the item if the RPC call fails', async () => {
    rpcState.results.get_my_pulse = { data: [buildPulse()], error: null }
    rpcState.results.mark_pulse_dismissed = { data: null, error: { message: 'rpc-failed' } }
    const { result } = renderHook(() => useMyPulse())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.markDismissed('p-1')
    })

    expect(result.current.items).toHaveLength(1)
    expect(result.current.items[0].id).toBe('p-1')
  })
})

describe('useMyPulse — markActionCompleted', () => {
  it('stamps all three timestamps on first call', async () => {
    rpcState.results.get_my_pulse = { data: [buildPulse()], error: null }
    rpcState.results.mark_pulse_action_completed = { data: buildPulse(), error: null }
    const { result } = renderHook(() => useMyPulse())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.markActionCompleted('p-1')
    })

    expect(result.current.items[0].action_completed_at).not.toBeNull()
    expect(result.current.items[0].clicked_at).not.toBeNull()
    expect(result.current.items[0].seen_at).not.toBeNull()
  })
})
