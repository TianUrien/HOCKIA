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
 *   - The hook ALWAYS calls the edge function (no client-side pre-read of
 *     ai_opinions — that read can't key on context_hash and would serve a
 *     STALE opinion across scope changes). cached comes from the server.
 *   - Server cache hit → ready w/ cached=true; fresh → ready w/ cached=false
 *   - quota_exceeded error from edge fn → status reflects it
 *   - regenerate() re-invokes the edge fn with force:true (bypass server cache)
 *
 * The deeper LLM behaviour (prompt content, output quality) is tested
 * later via the edge function suite + the staging end-to-end QA pass.
 * Here we only assert the hook's side of the contract.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

// Hoisted so vi.mock factories (themselves hoisted) can reference them.
const { supabaseFromBuilder, supabaseFromSpy, supabaseUpsertSpy, supabaseInvokeSpy, authState, clubFitState } = vi.hoisted(() => {
  const upsertSpy = vi.fn().mockResolvedValue({ error: null })
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(),
    upsert: upsertSpy,
  }
  return {
    supabaseFromBuilder: builder,
    supabaseFromSpy: vi.fn(() => builder),
    supabaseUpsertSpy: upsertSpy,
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

// #6b — useAIOpinion now also calls useCoachFit (for coach candidates).
// Mock it as NOT_APPLICABLE so the existing player-candidate tests are
// unaffected and no recruiting_context fetch leaks.
vi.mock('@/hooks/useCoachFit', () => ({
  useCoachFit: () => ({ isApplicable: false, state: 'grey', score: 0, reasons: [], positives: [], caveats: [], target: null }),
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
    supabaseUpsertSpy.mockClear()
    supabaseUpsertSpy.mockResolvedValue({ error: null })
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

  it('surfaces a SERVER-cached opinion via the edge fn (cached=true) without pre-reading ai_opinions', async () => {
    setRecruiterViewer()
    supabaseInvokeSpy.mockResolvedValueOnce({
      data: {
        opinion_id: 'op-cached-1',
        verdict_short: 'Comparable competition level + open today.',
        citations: [{ field: 'competition_level_band', value: '6', claim: 'matches tier' }],
        cached: true,
        quota_remaining: null,
      },
      error: null,
    })

    const { result } = renderHook(() => useAIOpinion(baseCandidate))
    await waitFor(() => {
      expect(result.current.status.kind).toBe('ready')
    })
    const ready = expectCachedReady(result.current.status)
    expect(ready.cached).toBe(true)
    expect(ready.opinionId).toBe('op-cached-1')
    expect(ready.data.verdict_short).toBe('Comparable competition level + open today.')
    expect(ready.data.citations).toHaveLength(1)
    // Always calls the edge fn (hash-keyed cache server-side); never a
    // client-side ai_opinions pre-read (would serve stale across scopes).
    expect(supabaseInvokeSpy).toHaveBeenCalledWith('ai-opinion', {
      body: { player_id: 'player-1', force: false },
    })
    expect(supabaseFromSpy).not.toHaveBeenCalledWith('ai_opinions')
  })

  it('calls the edge function and surfaces a fresh (cached=false) opinion', async () => {
    setRecruiterViewer()
    supabaseInvokeSpy.mockResolvedValueOnce({
      data: {
        opinion_id: 'op-fresh-1',
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
    expect(ready.opinionId).toBe('op-fresh-1')
    expect(ready.data.citations).toHaveLength(2)
    expect(supabaseInvokeSpy).toHaveBeenCalledWith('ai-opinion', {
      body: { player_id: 'player-1', force: false },
    })
  })

  it('maps a 429 quota_exceeded edge fn response to status.kind=quota_exceeded', async () => {
    setRecruiterViewer()
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

  it('regenerate() re-invokes the edge fn with force:true (bypassing the server cache)', async () => {
    setRecruiterViewer()
    // Mount: the edge fn returns a server-cached opinion.
    supabaseInvokeSpy.mockResolvedValueOnce({
      data: {
        opinion_id: 'op-cached-regen',
        verdict_short: 'Cached verdict',
        citations: [{ field: 'a', value: 'b', claim: 'c' }],
        cached: true,
        quota_remaining: null,
      },
      error: null,
    })
    const { result } = renderHook(() => useAIOpinion(baseCandidate))
    await waitFor(() => {
      expect(result.current.status.kind).toBe('ready')
    })
    expect(supabaseInvokeSpy).toHaveBeenCalledWith('ai-opinion', {
      body: { player_id: 'player-1', force: false },
    })

    // Regenerate: edge fn returns fresh.
    supabaseInvokeSpy.mockResolvedValueOnce({
      data: {
        opinion_id: 'op-regen-fresh',
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
    expect(supabaseInvokeSpy).toHaveBeenCalledTimes(2)
    // Critical: regenerate must send `force: true` so the edge function
    // skips its server-side cache check. Without this, QA F8 reproduces:
    // server serves the same cached row and Regenerate is a no-op.
    expect(supabaseInvokeSpy).toHaveBeenLastCalledWith('ai-opinion', {
      body: { player_id: 'player-1', force: true },
    })
    const ready = expectCachedReady(result.current.status)
    expect(ready.cached).toBe(false)
    expect(ready.data.verdict_short).toBe('Fresh verdict')
  })

  // ── Phase 2 Slice A: feedback submission ─────────────────────────
  it('submitFeedback upserts a row keyed on (opinion_id, viewer_id)', async () => {
    setRecruiterViewer()
    supabaseInvokeSpy.mockResolvedValueOnce({
      data: {
        opinion_id: 'op-feedback-1',
        verdict_short: 'verdict',
        citations: [],
        cached: false,
        quota_remaining: 50,
      },
      error: null,
    })

    const { result } = renderHook(() => useAIOpinion(baseCandidate))
    await waitFor(() => {
      expect(result.current.status.kind).toBe('ready')
    })

    await act(async () => {
      await result.current.submitFeedback('up')
    })

    // The only .from() call is the feedback upsert (the hook no longer
    // pre-reads ai_opinions). Asserting the target + payload locks the schema.
    expect(supabaseFromSpy).toHaveBeenCalledWith('ai_opinion_feedback')
    expect(supabaseUpsertSpy).toHaveBeenCalledWith(
      {
        opinion_id: 'op-feedback-1',
        viewer_id: 'viewer-club-1',
        rating: 'up',
        reason: null,
      },
      { onConflict: 'opinion_id,viewer_id' },
    )
  })

  it('submitFeedback("down", reason) trims and persists the reason text', async () => {
    setRecruiterViewer()
    supabaseInvokeSpy.mockResolvedValueOnce({
      data: {
        opinion_id: 'op-feedback-2',
        verdict_short: 'verdict',
        citations: [],
        cached: false,
        quota_remaining: 50,
      },
      error: null,
    })

    const { result } = renderHook(() => useAIOpinion(baseCandidate))
    await waitFor(() => {
      expect(result.current.status.kind).toBe('ready')
    })

    await act(async () => {
      await result.current.submitFeedback('down', '  the level comparison was inverted  ')
    })

    expect(supabaseUpsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        rating: 'down',
        reason: 'the level comparison was inverted',
      }),
      { onConflict: 'opinion_id,viewer_id' },
    )
  })

  it('submitFeedback no-ops when status is not ready (e.g. before mount resolves)', async () => {
    // Hook returns idle while enabled=false — submitFeedback should
    // silently swallow the call rather than throw or write garbage.
    const { result } = renderHook(() =>
      useAIOpinion(baseCandidate, { enabled: false }),
    )
    expect(result.current.status.kind).toBe('idle')
    await act(async () => {
      await result.current.submitFeedback('up')
    })
    expect(supabaseUpsertSpy).not.toHaveBeenCalled()
  })
})
