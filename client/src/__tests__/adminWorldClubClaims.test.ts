/**
 * World Phase 1 — claim-audit admin API contract.
 *
 * Locks the safety properties of the post-hoc review actions:
 *  - revokeWorldClubClaim only strips ownership when THIS claimant still
 *    holds the club (scoped .eq('claimed_profile_id', …)), and clears the
 *    reverse profiles.current_world_club_id pointer (the plain unclaim tool
 *    historically left it stale).
 *  - a claim whose account was deleted (profile_id null) revokes the audit
 *    row but touches neither world_clubs nor profiles (the FK SET NULL +
 *    auto-unclaim trigger already handled the club).
 *  - setWorldClubVerified stamps verified_at/verified_by on grant and clears
 *    both on removal — verification is admin-only state, separate from
 *    claiming.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

type Call = { table: string; update: Record<string, unknown>; eqs: Array<[string, unknown]> }
const calls: Call[] = []

vi.mock('@/lib/supabase', () => {
  const makeBuilder = (table: string) => {
    const call: Call = { table, update: {}, eqs: [] }
    const builder: Record<string, unknown> = {
      update: vi.fn((payload: Record<string, unknown>) => {
        call.update = payload
        calls.push(call)
        return builder
      }),
      insert: vi.fn(() => builder),
      select: vi.fn(() => builder),
      eq: vi.fn((col: string, val: unknown) => {
        call.eqs.push([col, val])
        return builder
      }),
      is: vi.fn(() => builder),
      order: vi.fn(() => builder),
      range: vi.fn(() => builder),
      single: vi.fn(() => Promise.resolve({ data: null, error: null })),
      then: (resolve: (v: { data: unknown; error: null }) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve),
    }
    return builder
  }
  return {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_ANON_KEY: 'anon',
    supabase: {
      rpc: vi.fn(),
      from: vi.fn((table: string) => makeBuilder(table)),
      auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'admin-1' } } })) },
    },
  }
})

import { revokeWorldClubClaim, setWorldClubVerified, markClaimReviewed } from '@/features/admin/api/adminApi'
import type { WorldClubClaim } from '@/features/admin/types'

const CLAIM: WorldClubClaim = {
  id: 'claim-1',
  world_club_id: 'club-1',
  profile_id: 'profile-9',
  action: 'claimed_existing',
  status: 'auto_approved',
  created_at: '2026-07-17T00:00:00Z',
  reviewed_by: null,
  reviewed_at: null,
  review_note: null,
}

describe('revokeWorldClubClaim', () => {
  beforeEach(() => { calls.length = 0 })

  it('revokes the audit row, unclaims the club scoped to THIS claimant, and clears the profile link', async () => {
    await revokeWorldClubClaim(CLAIM)

    const claimUpdate = calls.find((c) => c.table === 'world_club_claims')
    expect(claimUpdate?.update).toMatchObject({ status: 'revoked', reviewed_by: 'admin-1' })
    expect(claimUpdate?.eqs).toContainEqual(['id', 'claim-1'])

    // The club unclaim MUST be scoped to the claimant — never a blanket
    // unclaim that could strip a different (later, legitimate) owner.
    const clubUpdate = calls.find((c) => c.table === 'world_clubs')
    expect(clubUpdate?.update).toMatchObject({ is_claimed: false, claimed_profile_id: null, claimed_at: null })
    expect(clubUpdate?.eqs).toContainEqual(['id', 'club-1'])
    expect(clubUpdate?.eqs).toContainEqual(['claimed_profile_id', 'profile-9'])

    // The reverse pointer is cleared, scoped to this club only.
    const profileUpdate = calls.find((c) => c.table === 'profiles')
    expect(profileUpdate?.update).toMatchObject({ current_world_club_id: null })
    expect(profileUpdate?.eqs).toContainEqual(['id', 'profile-9'])
    expect(profileUpdate?.eqs).toContainEqual(['current_world_club_id', 'club-1'])
  })

  it('for a deleted claimant account, revokes the audit row and touches nothing else', async () => {
    await revokeWorldClubClaim({ ...CLAIM, profile_id: null })

    expect(calls.find((c) => c.table === 'world_club_claims')).toBeTruthy()
    expect(calls.find((c) => c.table === 'world_clubs')).toBeUndefined()
    expect(calls.find((c) => c.table === 'profiles')).toBeUndefined()
  })
})

describe('setWorldClubVerified', () => {
  beforeEach(() => { calls.length = 0 })

  it('grants: stamps verified_at + verified_by (the reviewing admin)', async () => {
    await setWorldClubVerified('club-1', true)
    const update = calls.find((c) => c.table === 'world_clubs')
    expect(update?.update.verified_by).toBe('admin-1')
    expect(typeof update?.update.verified_at).toBe('string')
    expect(update?.eqs).toContainEqual(['id', 'club-1'])
  })

  it('removes: clears both fields', async () => {
    await setWorldClubVerified('club-1', false)
    const update = calls.find((c) => c.table === 'world_clubs')
    expect(update?.update).toMatchObject({ verified_at: null, verified_by: null })
  })
})

describe('markClaimReviewed', () => {
  beforeEach(() => { calls.length = 0 })

  it('stamps reviewer + timestamp without changing status', async () => {
    await markClaimReviewed('claim-1')
    const update = calls.find((c) => c.table === 'world_club_claims')
    expect(update?.update.reviewed_by).toBe('admin-1')
    expect(typeof update?.update.reviewed_at).toBe('string')
    expect(update?.update).not.toHaveProperty('status')
    expect(update?.eqs).toContainEqual(['id', 'claim-1'])
  })
})