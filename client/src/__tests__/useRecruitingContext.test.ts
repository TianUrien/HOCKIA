/**
 * useRecruitingContext — store + action coverage.
 *
 * Tests the zustand store directly (exposed for tests via the
 * `useRecruitingContextStore` named export). The React hook wrapper
 * is a thin adapter — covering the store covers the contracts.
 *
 * What we lock in here:
 *   - setViewer flips eligibility/owner correctly and zeroes loading
 *     for non-recruiter viewers
 *   - ensureFetched dedupes concurrent calls per (owner) via the
 *     synchronous `fetchedForOwner` claim
 *   - The fetch-token guard discards stale SELECTs that would
 *     otherwise overwrite a post-mutation refresh()
 *   - activate / create / activateForOpportunity call the right RPC
 *     names with the right argument shapes
 *   - update strips undefined keys so callers never accidentally
 *     clobber columns
 *   - opportunityGenderToTarget collapses Girls→Women, Boys→Men
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted supabase mock ───────────────────────────────────────────
// Must be hoisted because the hook imports supabase at module load,
// before any test runs.
const fromMock = vi.hoisted(() => vi.fn())
const rpcMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: fromMock,
    rpc: rpcMock,
    auth: {
      getSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
  },
  AUTH_STORAGE_KEY: 'hockia-auth',
  SUPABASE_URL: 'https://test.local',
  SUPABASE_ANON_KEY: 'test',
}))

vi.mock('@/lib/sentryHelpers', () => ({
  reportSupabaseError: vi.fn(),
}))

// Static import is fine because hoisted mocks apply before the
// module factory runs.
import {
  useRecruitingContextStore,
  opportunityGenderToTarget,
  type RecruitingContextRow,
} from '@/hooks/useRecruitingContext'

const OWNER_A = 'owner-aaa'

function buildRow(overrides: Partial<RecruitingContextRow>): RecruitingContextRow {
  return {
    id: 'row-1',
    owner_id: OWNER_A,
    type: 'club',
    is_active: true,
    target_category: 'Mixed',
    target_role: null,
    target_position: null,
    competition_id: null,
    region: null,
    opportunity_id: null,
    label: 'Club default',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

/** Build a Supabase query-builder chain that resolves to the given
 *  rows. Captures the chain in `recorder` so a test can assert which
 *  filters were applied. */
function buildSelectChain(rows: RecruitingContextRow[] | null, error: unknown = null) {
  const recorder: { eq: string[]; neq: string[]; order: string[]; update?: unknown; delete?: boolean; insert?: unknown } = {
    eq: [],
    neq: [],
    order: [],
  }
  const chain: Record<string, unknown> = {}
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn((col: string, val: unknown) => {
    recorder.eq.push(`${col}=${String(val)}`)
    return chain
  })
  chain.neq = vi.fn((col: string, val: unknown) => {
    recorder.neq.push(`${col}!=${String(val)}`)
    return chain
  })
  chain.order = vi.fn((col: string) => {
    recorder.order.push(col)
    return chain
  })
  // SELECT terminal: `await chain` resolves to PostgrestResponse-like
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: rows, error }).then(resolve)
  chain.update = vi.fn((patch: unknown) => {
    recorder.update = patch
    return chain
  })
  chain.delete = vi.fn(() => {
    recorder.delete = true
    return chain
  })
  chain.insert = vi.fn((row: unknown) => {
    recorder.insert = row
    return chain
  })
  chain.single = vi.fn(() => Promise.resolve({ data: rows?.[0] ?? null, error }))
  return { chain, recorder }
}

/** Reset the store + mocks to a clean state. Important because the
 *  store is a module-singleton across tests. */
beforeEach(() => {
  fromMock.mockReset()
  rpcMock.mockReset()
  useRecruitingContextStore.setState({
    ownerId: null,
    eligibleRole: null,
    rows: [],
    loading: true,
    error: null,
    fetchedForOwner: null,
  })
})

// ── opportunityGenderToTarget ───────────────────────────────────────
describe('opportunityGenderToTarget', () => {
  it('Men → Men, Women → Women, Mixed → Mixed', () => {
    expect(opportunityGenderToTarget('Men')).toBe('Men')
    expect(opportunityGenderToTarget('Women')).toBe('Women')
    expect(opportunityGenderToTarget('Mixed')).toBe('Mixed')
  })
  it('Boys collapses to Men, Girls collapses to Women', () => {
    expect(opportunityGenderToTarget('Boys')).toBe('Men')
    expect(opportunityGenderToTarget('Girls')).toBe('Women')
  })
  it('null / undefined / unknown returns null', () => {
    expect(opportunityGenderToTarget(null)).toBe(null)
    expect(opportunityGenderToTarget(undefined)).toBe(null)
    expect(opportunityGenderToTarget('Robots')).toBe(null)
  })
})

// ── setViewer / role gate ───────────────────────────────────────────
describe('setViewer', () => {
  it('club viewer → eligibleRole=club, loading remains true (will fetch)', () => {
    useRecruitingContextStore.getState().setViewer(OWNER_A, 'club')
    const s = useRecruitingContextStore.getState()
    expect(s.ownerId).toBe(OWNER_A)
    expect(s.eligibleRole).toBe('club')
    expect(s.loading).toBe(true)
  })

  it('coach viewer → eligibleRole=coach', () => {
    useRecruitingContextStore.getState().setViewer(OWNER_A, 'coach')
    expect(useRecruitingContextStore.getState().eligibleRole).toBe('coach')
  })

  it('player viewer → eligibleRole=null, loading flipped to false (no fetch will run)', () => {
    useRecruitingContextStore.getState().setViewer(OWNER_A, 'player')
    const s = useRecruitingContextStore.getState()
    expect(s.eligibleRole).toBe(null)
    expect(s.loading).toBe(false)
  })

  it('transition from signed-in club → anon flips loading false (no fetch will run)', () => {
    useRecruitingContextStore.getState().setViewer(OWNER_A, 'club')
    expect(useRecruitingContextStore.getState().loading).toBe(true)
    useRecruitingContextStore.getState().setViewer(null, null)
    expect(useRecruitingContextStore.getState().loading).toBe(false)
  })

  it('repeated setViewer with same owner+role is a no-op (does NOT reset rows)', () => {
    useRecruitingContextStore.getState().setViewer(OWNER_A, 'club')
    useRecruitingContextStore.setState({ rows: [buildRow({ id: 'pre-existing' })] })
    useRecruitingContextStore.getState().setViewer(OWNER_A, 'club')
    expect(useRecruitingContextStore.getState().rows).toHaveLength(1)
  })
})

// ── ensureFetched ──────────────────────────────────────────────────
describe('ensureFetched', () => {
  it('does nothing for ineligible viewer (no fetch fires)', async () => {
    useRecruitingContextStore.getState().setViewer(OWNER_A, 'player')
    await useRecruitingContextStore.getState().ensureFetched()
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('does nothing when there is no owner', async () => {
    await useRecruitingContextStore.getState().ensureFetched()
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('fires exactly one fetch when called twice concurrently', async () => {
    const { chain } = buildSelectChain([buildRow({})])
    fromMock.mockReturnValue(chain)
    useRecruitingContextStore.getState().setViewer(OWNER_A, 'club')

    // Two concurrent callers in the same render commit (ContextSwitcher
    // + useClubFit both mount). The synchronous fetchedForOwner claim
    // means only the first actually issues a SELECT.
    await Promise.all([
      useRecruitingContextStore.getState().ensureFetched(),
      useRecruitingContextStore.getState().ensureFetched(),
    ])

    expect(fromMock).toHaveBeenCalledTimes(1)
    expect(useRecruitingContextStore.getState().rows).toHaveLength(1)
  })
})

// ── refresh (force) ────────────────────────────────────────────────
describe('refresh', () => {
  it('always re-fetches, bypassing the ensureFetched guard', async () => {
    const { chain } = buildSelectChain([buildRow({})])
    fromMock.mockReturnValue(chain)
    useRecruitingContextStore.getState().setViewer(OWNER_A, 'club')

    await useRecruitingContextStore.getState().ensureFetched()
    await useRecruitingContextStore.getState().refresh()

    expect(fromMock).toHaveBeenCalledTimes(2)
  })
})

// ── Fetch-token discard ────────────────────────────────────────────
describe('fetch-token guard', () => {
  it('discards a stale fetch response that lands after a newer fetch', async () => {
    useRecruitingContextStore.getState().setViewer(OWNER_A, 'club')

    // Wire two chains. First call returns a "stale" snapshot late;
    // second call returns a "fresh" snapshot quickly.
    const staleRows = [buildRow({ id: 'stale', label: 'old club ctx' })]
    const freshRows = [
      buildRow({ id: 'fresh', label: 'new opp ctx', type: 'opportunity', target_category: 'Women' }),
    ]
    let resolveStale: (v: unknown) => void = () => {}
    const stalePromise = new Promise((r) => { resolveStale = r })

    const staleChain: Record<string, unknown> = {}
    staleChain.select = vi.fn(() => staleChain)
    staleChain.eq = vi.fn(() => staleChain)
    staleChain.order = vi.fn(() => staleChain)
    staleChain.then = (resolve: (v: unknown) => unknown) =>
      stalePromise.then(() => resolve({ data: staleRows, error: null }))

    const { chain: freshChain } = buildSelectChain(freshRows)

    fromMock
      .mockReturnValueOnce(staleChain) // first call (ensureFetched)
      .mockReturnValueOnce(freshChain) // second call (refresh)

    // Kick the stale fetch off (don't await yet)
    const stalePending = useRecruitingContextStore.getState().ensureFetched()
    // Fire a "fresh" refresh that finishes first
    await useRecruitingContextStore.getState().refresh()
    expect(useRecruitingContextStore.getState().rows[0]?.id).toBe('fresh')

    // Now let the stale fetch land — its response should be discarded
    resolveStale(undefined)
    await stalePending

    // Rows still reflect the fresh snapshot
    expect(useRecruitingContextStore.getState().rows[0]?.id).toBe('fresh')
  })
})

// ── activate ───────────────────────────────────────────────────────
describe('activate', () => {
  it('calls set_active_recruiting_context RPC with the target id', async () => {
    rpcMock.mockResolvedValue({ data: buildRow({}), error: null })
    const { chain } = buildSelectChain([buildRow({})])
    fromMock.mockReturnValue(chain) // for the subsequent refresh()
    useRecruitingContextStore.getState().setViewer(OWNER_A, 'club')

    await useRecruitingContextStore.getState().activate('target-id-42')

    expect(rpcMock).toHaveBeenCalledWith('set_active_recruiting_context', { p_id: 'target-id-42' })
  })

  it('is a no-op for ineligible viewers (no RPC call)', async () => {
    useRecruitingContextStore.getState().setViewer(OWNER_A, 'player')
    await useRecruitingContextStore.getState().activate('any-id')
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('sets error on RPC failure', async () => {
    rpcMock.mockResolvedValue({ data: null, error: new Error('rpc fail') })
    useRecruitingContextStore.getState().setViewer(OWNER_A, 'club')
    await useRecruitingContextStore.getState().activate('target')
    expect(useRecruitingContextStore.getState().error).toBe('Could not switch context')
  })
})

// ── create ─────────────────────────────────────────────────────────
describe('create', () => {
  it('calls create_active_recruiting_context RPC with full payload', async () => {
    const newRow = buildRow({ id: 'newly-created', type: 'custom', target_category: 'Women', region: 'Madrid' })
    rpcMock.mockResolvedValue({ data: newRow, error: null })
    const { chain } = buildSelectChain([newRow])
    fromMock.mockReturnValue(chain)
    useRecruitingContextStore.getState().setViewer(OWNER_A, 'club')

    const returned = await useRecruitingContextStore.getState().create({
      target_category: 'Women',
      region: 'Madrid',
      label: 'Women — Madrid',
    })

    expect(rpcMock).toHaveBeenCalledWith('create_active_recruiting_context', {
      p_type: 'custom',
      p_target_category: 'Women',
      p_competition_id: null,
      p_region: 'Madrid',
      p_opportunity_id: null,
      p_label: 'Women — Madrid',
    })
    expect(returned?.id).toBe('newly-created')
  })

  it('returns null on RPC failure', async () => {
    rpcMock.mockResolvedValue({ data: null, error: new Error('rpc fail') })
    useRecruitingContextStore.getState().setViewer(OWNER_A, 'club')
    const returned = await useRecruitingContextStore.getState().create({
      target_category: 'Men',
    })
    expect(returned).toBe(null)
  })
})

// ── activateForOpportunity ─────────────────────────────────────────
describe('activateForOpportunity', () => {
  it('calls activate_opportunity_recruiting_context with passthrough fields', async () => {
    const newRow = buildRow({
      id: 'opp-ctx',
      type: 'opportunity',
      target_category: 'Women',
      region: 'Buenos Aires',
      opportunity_id: 'opp-123',
      label: 'Goalkeeper for Estudiantes',
    })
    rpcMock.mockResolvedValue({ data: newRow, error: null })
    const { chain } = buildSelectChain([newRow])
    fromMock.mockReturnValue(chain)
    useRecruitingContextStore.getState().setViewer(OWNER_A, 'club')

    const returned = await useRecruitingContextStore.getState().activateForOpportunity({
      opportunityId: 'opp-123',
      target: 'Women',
      region: 'Buenos Aires',
      label: 'Goalkeeper for Estudiantes',
    })

    expect(rpcMock).toHaveBeenCalledWith('activate_opportunity_recruiting_context', {
      p_opportunity_id: 'opp-123',
      p_target_category: 'Women',
      p_region: 'Buenos Aires',
      p_label: 'Goalkeeper for Estudiantes',
    })
    expect(returned?.id).toBe('opp-ctx')
  })

  it('is a no-op for ineligible viewers', async () => {
    useRecruitingContextStore.getState().setViewer(OWNER_A, 'player')
    const returned = await useRecruitingContextStore.getState().activateForOpportunity({
      opportunityId: 'opp',
      target: 'Women',
      region: null,
      label: null,
    })
    expect(returned).toBe(null)
    expect(rpcMock).not.toHaveBeenCalled()
  })
})

// ── update ─────────────────────────────────────────────────────────
describe('update', () => {
  it('only patches keys explicitly present in the input', async () => {
    const { chain, recorder } = buildSelectChain([buildRow({})])
    fromMock.mockReturnValue(chain)
    useRecruitingContextStore.getState().setViewer(OWNER_A, 'club')

    await useRecruitingContextStore.getState().update('row-1', { label: 'renamed' })

    // The patch object passed to update() should ONLY contain `label`
    expect(recorder.update).toEqual({ label: 'renamed' })
  })

  it('preserves explicit null (caller intends to clear the field)', async () => {
    const { chain, recorder } = buildSelectChain([buildRow({})])
    fromMock.mockReturnValue(chain)
    useRecruitingContextStore.getState().setViewer(OWNER_A, 'club')

    await useRecruitingContextStore.getState().update('row-1', { region: null })

    expect(recorder.update).toEqual({ region: null })
  })

  it('is a no-op when input has no keys', async () => {
    useRecruitingContextStore.getState().setViewer(OWNER_A, 'club')
    await useRecruitingContextStore.getState().update('row-1', {})
    expect(fromMock).not.toHaveBeenCalled()
  })
})

// ── clearActive ────────────────────────────────────────────────────
describe('clearActive', () => {
  it('issues an UPDATE setting is_active=false on the owner\'s active row', async () => {
    const { chain, recorder } = buildSelectChain([buildRow({ is_active: false })])
    fromMock.mockReturnValue(chain)
    useRecruitingContextStore.getState().setViewer(OWNER_A, 'club')

    await useRecruitingContextStore.getState().clearActive()

    expect(recorder.update).toEqual({ is_active: false })
    expect(recorder.eq).toContain(`owner_id=${OWNER_A}`)
    expect(recorder.eq).toContain('is_active=true')
  })

  it('is a no-op for ineligible viewers', async () => {
    useRecruitingContextStore.getState().setViewer(OWNER_A, 'player')
    await useRecruitingContextStore.getState().clearActive()
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('sets error on update failure', async () => {
    const { chain } = buildSelectChain(null, new Error('update fail'))
    fromMock.mockReturnValue(chain)
    useRecruitingContextStore.getState().setViewer(OWNER_A, 'club')
    await useRecruitingContextStore.getState().clearActive()
    expect(useRecruitingContextStore.getState().error).toBe('Could not clear recruiting context')
  })
})

// ── remove ─────────────────────────────────────────────────────────
describe('remove', () => {
  it('issues a DELETE filtered by owner_id and id', async () => {
    const { chain, recorder } = buildSelectChain([])
    fromMock.mockReturnValue(chain)
    useRecruitingContextStore.getState().setViewer(OWNER_A, 'club')

    await useRecruitingContextStore.getState().remove('row-1')

    expect(recorder.delete).toBe(true)
    expect(recorder.eq).toContain(`owner_id=${OWNER_A}`)
    expect(recorder.eq).toContain('id=row-1')
  })
})

// ── clearError ─────────────────────────────────────────────────────
describe('clearError', () => {
  it('zeroes the error field', () => {
    useRecruitingContextStore.setState({ error: 'something broke' })
    useRecruitingContextStore.getState().clearError()
    expect(useRecruitingContextStore.getState().error).toBe(null)
  })
})

