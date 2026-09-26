/**
 * useWorkPermits — reads through RLS for anyone, writes only for the owner,
 * statuses computed client-side, cache refreshed after each write.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const m = vi.hoisted(() => ({
  viewerId: 'player-1',
  rows: [] as Array<Record<string, unknown>>,
  selectCalls: 0,
  insert: vi.fn(),
  update: vi.fn(),
  del: vi.fn(),
  writeError: null as unknown,
}))

vi.mock('@/lib/supabase', () => {
  const listChain = {
    select: () => listChain,
    eq: () => listChain,
    order: async () => {
      m.selectCalls++
      return { data: m.rows, error: null }
    },
  }
  const single = async () => ({ data: m.writeError ? null : { id: 'new' }, error: m.writeError })
  return {
    supabase: {
      from: () => ({
        select: () => listChain,
        insert: (payload: unknown) => {
          m.insert(payload)
          return { select: () => ({ single }) }
        },
        update: (payload: unknown) => {
          m.update(payload)
          const chain = { eq: () => chain, select: () => ({ single }) }
          return chain
        },
        delete: () => {
          m.del()
          const chain = { eq: () => chain, then: (res: (v: unknown) => void) => res({ error: m.writeError }) }
          return chain
        },
      }),
    },
  }
})

vi.mock('@/lib/auth', () => {
  const state = () => ({ user: { id: m.viewerId } })
  const useAuthStore = (selector?: (s: ReturnType<typeof state>) => unknown) => (selector ? selector(state()) : state())
  return { useAuthStore }
})

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { useWorkPermits } from '@/hooks/useWorkPermits'

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)

describe('useWorkPermits', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.viewerId = 'player-1'
    m.selectCalls = 0
    m.writeError = null
    m.rows = [
      { id: 'a', player_id: 'player-1', country_id: 1, type: 'visa', valid_from: null, expires_on: inDays(200), created_at: '', updated_at: '' },
      { id: 'b', player_id: 'player-1', country_id: 2, type: 'work_permit', valid_from: null, expires_on: inDays(10), created_at: '', updated_at: '' },
    ]
  })

  it('loads permits with a computed status, soonest-expiring first', async () => {
    const { result } = renderHook(() => useWorkPermits('player-1'), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.permits).toHaveLength(2))
    expect(result.current.permits.map((p) => [p.id, p.status])).toEqual([['b', 'expiring_soon'], ['a', 'valid']])
    expect(result.current.isOwner).toBe(true)
    expect(result.current.needsAttention).toBe(true)
  })

  it('owner add sends a clean row and refreshes the list', async () => {
    const { result } = renderHook(() => useWorkPermits('player-1'), { wrapper: wrapper() })
    await waitFor(() => expect(m.selectCalls).toBe(1))
    let r: Awaited<ReturnType<typeof result.current.addPermit>> | undefined
    await act(async () => {
      r = await result.current.addPermit({ country_id: 3, type: 'residency', expires_on: '2030-01-01' })
    })
    expect(r).toMatchObject({ ok: true })
    expect(m.insert).toHaveBeenCalledWith({ player_id: 'player-1', country_id: 3, type: 'residency', valid_from: null, expires_on: '2030-01-01' })
    await waitFor(() => expect(m.selectCalls).toBe(2))
  })

  it('a permit without an expiry is sent with expires_on null', async () => {
    const { result } = renderHook(() => useWorkPermits('player-1'), { wrapper: wrapper() })
    await act(async () => {
      expect(await result.current.addPermit({ country_id: 4, type: 'visa', expires_on: '' })).toMatchObject({ ok: true })
    })
    expect(m.insert).toHaveBeenCalledWith({ player_id: 'player-1', country_id: 4, type: 'visa', valid_from: null, expires_on: null })
  })

  it('an open-ended permit is valid and sorts after dated ones', async () => {
    m.rows.push({ id: 'c', player_id: 'player-1', country_id: 3, type: 'residency', valid_from: null, expires_on: null, created_at: '', updated_at: '' })
    const { result } = renderHook(() => useWorkPermits('player-1'), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.permits).toHaveLength(3))
    expect(result.current.permits.map((p) => [p.id, p.status])).toEqual([['b', 'expiring_soon'], ['a', 'valid'], ['c', 'valid']])
  })

  it('invalid drafts never reach the server', async () => {
    const { result } = renderHook(() => useWorkPermits('player-1'), { wrapper: wrapper() })
    const r = await result.current.addPermit({ country_id: 3, type: 'passport', expires_on: '2030-01-01' })
    expect(r).toEqual({ ok: false, reason: 'type_invalid' })
    expect(m.insert).not.toHaveBeenCalled()
  })

  it('a viewer who is not the owner can read but not write', async () => {
    m.viewerId = 'club-1'
    const { result } = renderHook(() => useWorkPermits('player-1'), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.permits).toHaveLength(2))
    expect(result.current.isOwner).toBe(false)
    expect(result.current.needsAttention).toBe(false)
    expect(await result.current.addPermit({ country_id: 3, type: 'visa', expires_on: '2030-01-01' })).toEqual({ ok: false, reason: 'not_owner' })
    expect(await result.current.updatePermit('a', { country_id: 3, type: 'visa', expires_on: '2030-01-01' })).toEqual({ ok: false, reason: 'not_owner' })
    expect(await result.current.removePermit('a')).toEqual({ ok: false, reason: 'not_owner' })
    expect(m.insert).not.toHaveBeenCalled()
    expect(m.update).not.toHaveBeenCalled()
    expect(m.del).not.toHaveBeenCalled()
  })

  it('owner update and delete; server errors come back as reason error', async () => {
    const { result } = renderHook(() => useWorkPermits('player-1'), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.permits).toHaveLength(2))
    await act(async () => {
      expect(await result.current.updatePermit('a', { country_id: 1, type: 'visa', expires_on: '2031-01-01' })).toMatchObject({ ok: true })
      expect(await result.current.removePermit('a')).toEqual({ ok: true })
    })
    expect(m.update).toHaveBeenCalledWith({ country_id: 1, type: 'visa', valid_from: null, expires_on: '2031-01-01' })
    m.writeError = new Error('rls')
    await act(async () => {
      expect(await result.current.removePermit('a')).toMatchObject({ ok: false, reason: 'error' })
    })
  })
})
