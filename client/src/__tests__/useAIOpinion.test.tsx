/**
 * useAIOpinion — Section F (G.7) hook contract.
 *
 * Locks in:
 *   - enabled=false → stays idle, never queries supabase or invokes edge fn
 *   - Recruiter gate (matches ClubFitChip): non-club/coach viewer → not_applicable
 *   - Self-view: viewer === player → not_applicable (defense in depth even
 *     though the DB CHECK constraint would block, the UI should never
 *     trigger the call in the first place)
 *   - Fit not applicable (no recruiting target) → not_applicable
 *   - Cache hit on local SELECT → ready w/ cached=true, edge fn NOT called
 *   - Cache miss → edge fn called once, ready w/ cached=false
 *   - quota_exceeded error from edge fn → status reflects it
 *   - regenerate() bypasses the local cache pre-flight and re-calls edge fn
 *
 * The deeper LLM behaviour (prompt content, output quality) is tested
 * later via the edge function suite + the staging end-to-end QA pass.
 * Here we only assert the hook's side of the contract.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

// Hoisted so vi.mock factories (themselves hoisted) can reference them.
const { supabaseFromBuilder, supabaseFromSpy, supabaseInvokeSpy, authState, clubFitState } = vi.hoisted(() => {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(),
  }
  return {
    supabaseFromBuilder: builder,
    supabaseFromSpy: vi.fn(() => builder),
    supabaseInvokeSpy: vi.fn(),
    authState: { profile: null as { id: string; role: string } | null },
    clubFitState: { isApplicable: true },
  }
})

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: supabaseFromSpy,
    functions: { invoke: supabaseInvokeSpy },
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/lib/auth', () => ({
  useAuthStore: () => authState,
}))

vi.mock('@/hooks/useClubFit', () => ({
  useClubFit: () => clubFitState,
}))

import { useAIOpinion } from '@/hooks/useAIOpinion'
import type { FitCandidateFields } from '@/lib/clubFit'

const baseCandidate: FitCandidateFields = {
  id: 'player-1',
  role: 'player',
  playing_category: 'adult_women',
  current_world_club_id: 'club-1',
  competition_level_band: 6,
  open_to_play: true,
  open_to_coach: null,
  open_to_opportunities: null,
  last_active_at: new Date().toISOString(),
}

function setRecruiterViewer() {
  authState.profile = { id: 'viewer-club-1', role: 'club' }
  clubFitState.isApplicable = true
}

function expectCachedReady(status: ReturnType<typeof useAIOpinion>['status']) {
  if (status.kind !== 'ready') throw new Error(`expected ready, got ${status.kind}`)
  return status
}

describe('useAIOpinion', () => {
  beforeEach(() => {
    supabaseFromSpy.mockClear()
    supabaseInvokeSpy.mockClear()
    supabaseFromBuilder.maybeSingle.mockReset()
    authState.profile = null
    clubFitState.isApplicable = true
  })

  it('stays idle when enabled=false and never queries anything', () => {
    setRecruiterViewer()
    const { result } = renderHook(() =>
      useAIOpinion(baseCandidate, { enabled: false }),
    )
    expect(result.current.status.kind).toBe('idle')
    expect(supabaseFromSpy).not.toHaveBeenCalled()
    expect(supabaseInvokeSpy).not.toHaveBeenCalled()
  })

  it('returns not_applicable with reason=not_recruiter for non-recruiter viewers', async () => {
    authState.profile = { id: 'viewer-player', role: 'player' }
    const { result } = renderHook(() => useAIOpinion(baseCandidate))
    await waitFor(() => {
      expect(result.current.status.kind).toBe('not_applicable')
    })
    if (result.current.status.kind !== 'not_applicable') throw new Error('expected not_applicable')
    expect(result.current.status.reason).toBe('not_recruiter')
    expect(supabaseFromSpy).not.toHaveBeenCalled()
    expect(supabaseInvokeSpy).not.toHaveBeenCalled()
  })

  it('returns not_applicable with reason=self when viewer is the candidate', async () => {
    setRecruiterViewer()
    const selfCandidate = { ...baseCandidate, id: authState.profile!.id }
    const { result } = renderHook(() => useAIOpinion(selfCandidate))
    await waitFor(() => {
      expect(result.current.status.kind).toBe('not_applicable')
    })
    if (result.current.status.kind !== 'not_applicable') throw new Error('expected not_applicable')
    expect(result.current.status.reason).toBe('self')
    expect(supabaseInvokeSpy).not.toHaveBeenCalled()
  })

  it('returns not_applicable with reason=fit_not_applicable when no recruiting target', async () => {
    setRecruiterViewer()
    clubFitState.isApplicable = false
    const { result } = renderHook(() => useAIOpinion(baseCandidate))
    await waitFor(() => {
      expect(result.current.status.kind).toBe('not_applicable')
    })
    if (result.current.status.kind !== 'not_applicable') throw new Error('expected not_applicable')
    expect(result.current.status.reason).toBe('fit_not_applicable')
    expect(supabaseInvokeSpy).not.toHaveBeenCalled()
  })

  it('returns cached opinion from local SELECT and does NOT call edge fn', async () => {
    setRecruiterViewer()
    supabaseFromBuilder.maybeSingle.mockResolvedValueOnce({
      data: {
        verdict_short: 'Comparable competition level + open today.',
        citations: [{ field: 'competition_level_band', value: '6', claim: 'matches tier' }],
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
      error: null,
    })

    const { result } = renderHook(() => useAIOpinion(baseCandidate))
    await waitFor(() => {
      expect(result.current.status.kind).toBe('ready')
    })
    const ready = expectCachedReady(result.current.status)
    expect(ready.cached).toBe(true)
    expect(ready.data.verdict_short).toBe('Comparable competition level + open today.')
    expect(ready.data.citations).toHaveLength(1)
    expect(supabaseInvokeSpy).not.toHaveBeenCalled()
  })

  it('calls the edge function when cache misses, surfacing cached=false', async () => {
    setRecruiterViewer()
    // Local cache miss
    supabaseFromBuilder.maybeSingle.mockResolvedValueOnce({ data: null, error: null })
    // Edge function returns a fresh opinion
    supabaseInvokeSpy.mockResolvedValueOnce({
      data: {
        verdict_short: 'Hoofdklasse player open this week — strong availability.',
        citations: [
          { field: 'open_to_play', value: 'true', claim: 'actively looking' },
          { field: 'last_active_at', value: 'today', claim: 'engaged this week' },
        ],
        cached: false,
        quota_remaining: 47,
      },
      error: null,
    })

    const { result } = renderHook(() => useAIOpinion(baseCandidate))
    await waitFor(() => {
      expect(result.current.status.kind).toBe('ready')
    })
    const ready = expectCachedReady(result.current.status)
    expect(ready.cached).toBe(false)
    expect(ready.quotaRemaining).toBe(47)
    expect(ready.data.citations).toHaveLength(2)
    expect(supabaseInvokeSpy).toHaveBeenCalledWith('ai-opinion', {
      body: { player_id: 'player-1' },
    })
  })

  it('maps a 429 quota_exceeded edge fn response to status.kind=quota_exceeded', async () => {
    setRecruiterViewer()
    supabaseFromBuilder.maybeSingle.mockResolvedValueOnce({ data: null, error: null })
    // supabase-js's FunctionsHttpError shape — error has .context with status + body
    const httpError = Object.assign(new Error('FunctionsHttpError'), {
      context: {
        status: 429,
        body: {
          error: 'quota_exceeded',
          resets_at: '2026-05-28T23:59:59Z',
          quota_per_day: 50,
        },
      },
    })
    supabaseInvokeSpy.mockResolvedValueOnce({ data: null, error: httpError })

    const { result } = renderHook(() => useAIOpinion(baseCandidate))
    await waitFor(() => {
      expect(result.current.status.kind).toBe('quota_exceeded')
    })
    if (result.current.status.kind !== 'quota_exceeded') throw new Error('expected quota_exceeded')
    expect(result.current.status.resetsAt).toBe('2026-05-28T23:59:59Z')
  })

  it('maps a 403 not_applicable edge fn response to status.kind=not_applicable', async () => {
    setRecruiterViewer()
    supabaseFromBuilder.maybeSingle.mockResolvedValueOnce({ data: null, error: null })
    const httpError = Object.assign(new Error('FunctionsHttpError'), {
      context: {
        status: 403,
        body: { error: 'not_applicable', detail: 'no recruiting target' },
      },
    })
    supabaseInvokeSpy.mockResolvedValueOnce({ data: null, error: httpError })

    const { result } = renderHook(() => useAIOpinion(baseCandidate))
    await waitFor(() => {
      expect(result.current.status.kind).toBe('not_applicable')
    })
    if (result.current.status.kind !== 'not_applicable') throw new Error('expected not_applicable')
    expect(result.current.status.reason).toBe('no_target')
  })

  it('regenerate() bypasses the local cache pre-flight and re-invokes the edge fn', async () => {
    setRecruiterViewer()
    // First mount: cache hit
    supabaseFromBuilder.maybeSingle.mockResolvedValueOnce({
      data: {
        verdict_short: 'Cached verdict',
        citations: [{ field: 'a', value: 'b', claim: 'c' }],
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
      error: null,
    })
    const { result } = renderHook(() => useAIOpinion(baseCandidate))
    await waitFor(() => {
      expect(result.current.status.kind).toBe('ready')
    })
    expectCachedReady(result.current.status)
    expect(supabaseInvokeSpy).not.toHaveBeenCalled()

    // Regenerate: edge fn returns fresh
    supabaseInvokeSpy.mockResolvedValueOnce({
      data: {
        verdict_short: 'Fresh verdict',
        citations: [],
        cached: false,
        quota_remaining: 49,
      },
      error: null,
    })
    await act(async () => {
      await result.current.regenerate()
    })
    expect(supabaseInvokeSpy).toHaveBeenCalledTimes(1)
    expect(supabaseInvokeSpy).toHaveBeenCalledWith('ai-opinion', {
      body: { player_id: 'player-1' },
    })
    const ready = expectCachedReady(result.current.status)
    expect(ready.cached).toBe(false)
    expect(ready.data.verdict_short).toBe('Fresh verdict')
  })
})
