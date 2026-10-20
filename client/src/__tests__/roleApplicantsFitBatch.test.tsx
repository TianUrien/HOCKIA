import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

/**
 * compute_club_fit_batch (2026-10-20): the applicants list reads every fit in
 * one RPC instead of one per applicant, and does not ask for applications
 * that get no fit (closed, withdrawn, filled).
 */
const rpc = vi.fn()
const tables: Record<string, unknown> = {}
function chain(result: unknown) {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'in', 'limit', 'order']) c[m] = () => c
  c.maybeSingle = () => Promise.resolve(result)
  c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej)
  return c
}
vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args), from: (t: string) => chain(tables[t]) },
}))
vi.mock('@/lib/pendingDecisions', () => ({ heldDecision: () => null }))

import { useRoleApplicants } from '@/hooks/useRoleApplicants'

const applicant = (id: string) => ({ id, full_name: id, avatar_url: null, role: 'player', position: null, secondary_position: null, nationality_country_id: null, nationality2_country_id: null, base_location: null, playing_category: null, last_active_at: null, current_club: null, current_world_club_id: null })

beforeEach(() => {
  rpc.mockReset()
  tables.opportunities = { data: { id: 'r1', club_id: 'c1', gender: 'Men' }, error: null }
  tables.opportunity_applications = {
    data: [
      { id: 'a1', status: 'pending', applied_at: null, updated_at: null, metadata: {}, applicant: applicant('p1') },
      { id: 'a2', status: 'shortlisted', applied_at: null, updated_at: null, metadata: {}, applicant: applicant('p2') },
      { id: 'a3', status: 'withdrawn', applied_at: null, updated_at: null, metadata: {}, applicant: applicant('p3') },
    ],
    error: null,
  }
  tables.application_response_settings = { data: null, error: null }
  tables.application_views = { data: [], error: null }
  rpc.mockResolvedValue({ data: [
    { player_id: 'p1', score: 0.9, state: 'green', components: { level: 1 } },
    { player_id: 'p2', score: 0.5, state: 'amber', components: { level: 0.5 } },
  ], error: null })
})

describe('useRoleApplicants fit', () => {
  it('asks for every open applicant in one compute_club_fit_batch call and maps the rows back', async () => {
    const { result } = renderHook(() => useRoleApplicants('r1', 'c1'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('compute_club_fit_batch', expect.objectContaining({ p_owner_id: 'c1', p_player_ids: ['p1', 'p2'], p_target: 'Men', p_opportunity_id: 'r1' }))
    const byApp = Object.fromEntries(result.current.applicants.map((a) => [a.applicationId, a.fit?.state ?? null]))
    expect(byApp).toEqual({ a1: 'green', a2: 'amber', a3: null })
  })
})
