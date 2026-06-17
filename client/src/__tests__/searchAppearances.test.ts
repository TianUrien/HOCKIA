import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchSearchAppearancesSummary,
  logSearchAppearances,
} from '@/lib/searchAppearances'

// ── Supabase client mock ──
// One reusable chain whose terminal calls resolve with whatever the test
// stashes on `supabaseState`. Each test resets this state in beforeEach.
interface SupabaseState {
  upsertResult: { error: { message: string } | null }
  rpcResult: { data: unknown; error: { message: string } | null }
  upsertArgs: unknown
  upsertOptions: unknown
  rpcArgs: unknown
  session: { user: { id: string } } | null
}
const supabaseState: SupabaseState = {
  upsertResult: { error: null },
  rpcResult: { data: [], error: null },
  upsertArgs: null,
  upsertOptions: null,
  rpcArgs: null,
  session: { user: { id: 'viewer-1' } },
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () =>
        Promise.resolve({ data: { session: supabaseState.session }, error: null }),
    },
    from: () => ({
      upsert: (rows: unknown, options?: unknown) => {
        supabaseState.upsertArgs = rows
        supabaseState.upsertOptions = options
        return Promise.resolve(supabaseState.upsertResult)
      },
    }),
    rpc: (_fn: string, args: unknown) => {
      supabaseState.rpcArgs = args
      return Promise.resolve(supabaseState.rpcResult)
    },
  },
}))

beforeEach(() => {
  supabaseState.upsertResult = { error: null }
  supabaseState.rpcResult = { data: [], error: null }
  supabaseState.upsertArgs = null
  supabaseState.upsertOptions = null
  supabaseState.rpcArgs = null
  supabaseState.session = { user: { id: 'viewer-1' } }
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('logSearchAppearances', () => {
  const viewerId = 'viewer-1'
  const baseFilters = {
    search_query_present: true,
    role: 'player',
    position: null,
    gender: null,
    location: null,
    nationality: null,
    availability: null,
  }

  it('no-ops when viewerId is missing', async () => {
    await logSearchAppearances({ viewerId: '', profileIds: ['a'], filters: baseFilters })
    expect(supabaseState.upsertArgs).toBeNull()
  })

  it('no-ops when profileIds is empty', async () => {
    await logSearchAppearances({ viewerId, profileIds: [], filters: baseFilters })
    expect(supabaseState.upsertArgs).toBeNull()
  })

  it('no-ops when there is no live authenticated session (avoids the anon RLS 403)', async () => {
    supabaseState.session = null
    await logSearchAppearances({ viewerId, profileIds: ['a', 'b'], filters: baseFilters })
    expect(supabaseState.upsertArgs).toBeNull()
  })

  it('no-ops when the live session user is not the viewer', async () => {
    supabaseState.session = { user: { id: 'someone-else' } }
    await logSearchAppearances({ viewerId, profileIds: ['a', 'b'], filters: baseFilters })
    expect(supabaseState.upsertArgs).toBeNull()
  })

  it('filters out the viewer themselves from the upsert rows', async () => {
    await logSearchAppearances({
      viewerId,
      profileIds: ['a', viewerId, 'b'],
      filters: baseFilters,
    })
    const rows = supabaseState.upsertArgs as { profile_id: string; viewer_id: string }[]
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.viewer_id === viewerId)).toBe(true)
    expect(rows.map((r) => r.profile_id).sort()).toEqual(['a', 'b'])
  })

  it('no-ops when every candidate profile is the viewer (self-only set)', async () => {
    await logSearchAppearances({
      viewerId,
      profileIds: [viewerId],
      filters: baseFilters,
    })
    expect(supabaseState.upsertArgs).toBeNull()
  })

  it('passes onConflict options for the (profile_id, viewer_id, hour_bucket) dedup index', async () => {
    await logSearchAppearances({
      viewerId,
      profileIds: ['a'],
      filters: baseFilters,
    })
    expect(supabaseState.upsertOptions).toEqual({
      onConflict: 'profile_id,viewer_id,hour_bucket',
      ignoreDuplicates: true,
    })
  })

  it('serialises the filters payload into each row', async () => {
    await logSearchAppearances({
      viewerId,
      profileIds: ['a'],
      filters: baseFilters,
    })
    const rows = supabaseState.upsertArgs as { filters: unknown }[]
    expect(rows[0].filters).toEqual(baseFilters)
  })

  it('swallows supabase errors so a logging failure never breaks the grid', async () => {
    supabaseState.upsertResult = { error: { message: 'boom' } }
    await expect(
      logSearchAppearances({ viewerId, profileIds: ['a'], filters: baseFilters })
    ).resolves.toBeUndefined()
  })
})

describe('fetchSearchAppearancesSummary', () => {
  it('calls the RPC with the profile id and days', async () => {
    supabaseState.rpcResult = { data: [], error: null }
    await fetchSearchAppearancesSummary('prof-1', 14)
    expect(supabaseState.rpcArgs).toEqual({ p_profile_id: 'prof-1', p_days: 14 })
  })

  it('defaults to a 7-day window', async () => {
    await fetchSearchAppearancesSummary('prof-1')
    const args = supabaseState.rpcArgs as { p_days: number }
    expect(args.p_days).toBe(7)
  })

  it('returns null on supabase error (so the dashboard can hide the card)', async () => {
    supabaseState.rpcResult = { data: null, error: { message: 'nope' } }
    const result = await fetchSearchAppearancesSummary('prof-1')
    expect(result).toBeNull()
  })

  it('aggregates the returned rows into a total', async () => {
    supabaseState.rpcResult = {
      data: [
        { day: '2026-04-14', appearances: 3 },
        { day: '2026-04-15', appearances: 5 },
        { day: '2026-04-16', appearances: 2 },
      ],
      error: null,
    }
    const result = await fetchSearchAppearancesSummary('prof-1')
    expect(result).not.toBeNull()
    expect(result!.total).toBe(10)
    expect(result!.days).toHaveLength(3)
  })

  it('tolerates a nullish data payload by returning an empty summary', async () => {
    supabaseState.rpcResult = { data: null, error: null }
    const result = await fetchSearchAppearancesSummary('prof-1')
    expect(result).toEqual({ days: [], total: 0 })
  })

  it('tolerates a non-array data payload (e.g. `false`) by returning an empty summary', async () => {
    // Mimics the PlayerDashboard test mock that stubs supabase.rpc to
    // resolve with { data: false, error: null }.
    supabaseState.rpcResult = { data: false, error: null }
    const result = await fetchSearchAppearancesSummary('prof-1')
    expect(result).toEqual({ days: [], total: 0 })
  })
})
