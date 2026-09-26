/**
 * Coach "Current role" (D2): the owner's row carries it; visitors read it on
 * its own; a missing column (pre-migration) reads as no role, not an error.
 */
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const maybeSingle = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }) },
}))

import { useCoachCurrentRole } from '@/hooks/useCoachCurrentRole'

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
)

beforeEach(() => maybeSingle.mockReset())

describe('useCoachCurrentRole', () => {
  it('uses the value on the row without a query', () => {
    const { result } = renderHook(() => useCoachCurrentRole({ id: 'c1', role: 'coach', coach_current_role: 'Head coach, U21 women' }), { wrapper })
    expect(result.current).toBe('Head coach, U21 women')
    expect(maybeSingle).not.toHaveBeenCalled()
  })

  it('reads it for visitors whose profile fetch lacks the column', async () => {
    maybeSingle.mockResolvedValue({ data: { coach_current_role: 'Assistant coach' }, error: null })
    const { result } = renderHook(() => useCoachCurrentRole({ id: 'c1', role: 'coach' }), { wrapper })
    await waitFor(() => expect(result.current).toBe('Assistant coach'))
  })

  it('missing column (before the migration) → null, no throw', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { code: '42703', message: 'column profiles.coach_current_role does not exist' } })
    const { result } = renderHook(() => useCoachCurrentRole({ id: 'c1', role: 'coach' }), { wrapper })
    await waitFor(() => expect(maybeSingle).toHaveBeenCalled())
    expect(result.current).toBeNull()
  })

  it('players never query', () => {
    renderHook(() => useCoachCurrentRole({ id: 'p1', role: 'player' }), { wrapper })
    expect(maybeSingle).not.toHaveBeenCalled()
  })
})
