/**
 * useAIOpinion — Section F AI Opinion Engine client hook.
 *
 * Calls the ai-opinion edge function for (viewer, player). The function
 * does the hash-keyed cache check + LLM call + quota-tracked persistence
 * server-side, so a fresh hook mount within the 24h TTL on the SAME scope
 * returns the server's cached row (no LLM, no quota). The hook deliberately
 * does NOT pre-read ai_opinions itself — that read can't key on
 * context_hash (it includes server-derived inputs like league bands), so it
 * would serve a STALE opinion across scope changes (e.g. flipping a
 * must-have), which is exactly when the verdict must change.
 *
 * Recruiter-only contract: the hook self-gates on the same condition
 * as ClubFitChip — viewer.role must be club/coach AND
 * useClubFit(candidate).isApplicable must be true. Otherwise it
 * returns idle state and never calls the function.
 *
 * Surfaces: AIOpinionPanel (recruiter view of another player on
 * ScoutingCard). Future surfaces (Phase 3) can reuse the same hook;
 * caching keeps the cost flat regardless of how many surfaces mount it.
 *
 * Feature-flagged via VITE_ENABLE_AI_OPINION at the consumer level —
 * the hook itself doesn't read the flag (lets us write tests without
 * env mocks). The consuming component checks the flag.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { useClubFit } from './useClubFit'
import { useCoachFit } from './useCoachFit'
import type { FitCandidateFields } from '@/lib/clubFit'

export interface AIOpinionCitation {
  field: string
  value: string
  claim: string
}

export interface AIOpinionResult {
  verdict_short: string
  citations: AIOpinionCitation[]
}

export type AIOpinionStatus =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | {
      kind: 'ready'
      data: AIOpinionResult
      cached: boolean
      quotaRemaining: number | null
      /** Phase 2 Slice A: id of the underlying ai_opinions row so the
       *  panel's thumbs-up/down feedback can link to it. May be null on
       *  cache misses where the persist failed (best-effort write) —
       *  feedback affordance hides when null. */
      opinionId: string | null
    }
  | { kind: 'not_applicable'; reason: 'no_target' | 'not_recruiter' | 'self' | 'fit_not_applicable' }
  | { kind: 'quota_exceeded'; resetsAt: string }
  | { kind: 'error'; message: string }

export type AIOpinionFeedbackRating = 'up' | 'down'

interface UseAIOpinionOptions {
  /** When false, the hook stays idle and never calls the edge function.
   *  Consumers wire this to a feature flag so we can ship the code
   *  dark and enable per-environment. */
  enabled?: boolean
}

/**
 * @param candidate The full Fit candidate fields. Must match what
 *   ClubFitChip uses so the recruiter-only gating is consistent.
 */
/** The candidate shape the AI opinion accepts — the Club-Fit fields plus
 *  the coach-fit fields used when the candidate is a coach. The edge
 *  function re-derives everything from player_id server-side; these are
 *  only used client-side to gate the panel on the role-appropriate Fit. */
export type AIOpinionCandidate = FitCandidateFields & {
  coach_specialization?: string | null
  coaching_categories?: string[] | null
}

export function useAIOpinion(
  candidate: AIOpinionCandidate | null | undefined,
  options: UseAIOpinionOptions = {},
): {
  status: AIOpinionStatus
  /** Re-fetch from the edge function, bypassing the local cache check.
   *  Used by the panel's "Regenerate" affordance. Still respects the
   *  server-side cache (so cheap if context_hash hasn't changed) AND
   *  the 50/day quota. */
  regenerate: () => Promise<void>
  /** Phase 2 Slice A: write thumbs-up/down feedback against the current
   *  ready opinion. UPSERT keyed on (opinion_id, viewer_id) so calling
   *  this multiple times replaces the prior rating instead of stacking.
   *  No-ops silently if status is not 'ready' or opinionId is null. */
  submitFeedback: (rating: AIOpinionFeedbackRating, reason?: string | null) => Promise<void>
} {
  const enabled = options.enabled !== false
  const { profile: viewer } = useAuthStore()
  // Gate on the role-appropriate Fit: Club Fit for player candidates,
  // Coach Fit for coach candidates. Both hooks always run (rules of hooks);
  // the non-matching one returns NOT_APPLICABLE and is ignored. This is
  // what makes the AI panel render for coach candidates too (#6b).
  const clubFit = useClubFit(candidate)
  const coachFit = useCoachFit(
    candidate?.role === 'coach'
      ? {
          id: candidate.id,
          role: candidate.role,
          coach_specialization: candidate.coach_specialization ?? null,
          coaching_categories: candidate.coaching_categories ?? null,
        }
      : null,
  )
  const fit = candidate?.role === 'coach' ? coachFit : clubFit
  const [status, setStatus] = useState<AIOpinionStatus>({ kind: 'idle' })

  // Ref used to drop stale responses if the candidate changes mid-flight
  // (e.g. recruiter clicks through a list of players quickly).
  const requestSeq = useRef(0)

  const viewerId = viewer?.id ?? null
  const viewerRole = viewer?.role ?? null
  const candidateId = candidate?.id ?? null
  const isOwnProfile = Boolean(viewerId && candidateId && viewerId === candidateId)
  const isRecruiter = viewerRole === 'club' || viewerRole === 'coach'

  const fetchOpinion = useCallback(
    async (forceRefresh = false) => {
      if (!enabled || !viewerId || !candidateId) {
        setStatus({ kind: 'idle' })
        return
      }
      if (isOwnProfile) {
        setStatus({ kind: 'not_applicable', reason: 'self' })
        return
      }
      if (!isRecruiter) {
        setStatus({ kind: 'not_applicable', reason: 'not_recruiter' })
        return
      }
      if (!fit.isApplicable) {
        setStatus({ kind: 'not_applicable', reason: 'fit_not_applicable' })
        return
      }

      const seq = ++requestSeq.current
      setStatus({ kind: 'loading' })

      // Always call the edge function — it does the hash-keyed cache check
      // server-side and returns its cached row (no LLM, no quota) on a hash
      // hit. We must NOT pre-read ai_opinions on the client: that read can't
      // filter by context_hash, so after the recruiter changes the active
      // scope (e.g. flips a must-have) it would serve the previous scope's
      // STALE opinion — the verdict-vs-narration drift Phase 3d exists to
      // prevent. `force: true` (Regenerate) additionally bypasses the
      // server-side cache so a manual refresh always re-runs the LLM (F8).
      try {
        const { data, error } = await supabase.functions.invoke('ai-opinion', {
          body: { player_id: candidateId, force: forceRefresh },
        })
        if (seq !== requestSeq.current) return
        if (error) {
          // supabase-js wraps non-2xx as `FunctionsHttpError`. The
          // body holds our structured error shape.
          // Inspect the response status + body if available.
          const ctx = (error as unknown as { context?: { status?: number; body?: unknown } }).context
          const status = ctx?.status
          const body = ctx?.body as Record<string, unknown> | undefined
          const errCode = typeof body?.error === 'string' ? body.error : null
          if (status === 429 && errCode === 'quota_exceeded') {
            const resetsAt = typeof body?.resets_at === 'string' ? body.resets_at : new Date().toISOString()
            setStatus({ kind: 'quota_exceeded', resetsAt })
            return
          }
          if (status === 403 && errCode === 'not_applicable') {
            setStatus({ kind: 'not_applicable', reason: 'no_target' })
            return
          }
          throw error
        }
        const payload = data as {
          opinion_id: string | null
          verdict_short: string
          citations: AIOpinionCitation[]
          cached: boolean
          quota_remaining: number | null
        }
        setStatus({
          kind: 'ready',
          data: { verdict_short: payload.verdict_short, citations: payload.citations },
          cached: Boolean(payload.cached),
          quotaRemaining: typeof payload.quota_remaining === 'number' ? payload.quota_remaining : null,
          opinionId: typeof payload.opinion_id === 'string' ? payload.opinion_id : null,
        })
      } catch (err) {
        if (seq !== requestSeq.current) return
        logger.error('[useAIOpinion] fetch failed', err)
        setStatus({
          kind: 'error',
          message: err instanceof Error ? err.message : 'Could not load opinion',
        })
      }
    },
    [enabled, viewerId, candidateId, isOwnProfile, isRecruiter, fit.isApplicable],
  )

  useEffect(() => {
    void fetchOpinion(false)
  }, [fetchOpinion])

  const regenerate = useCallback(async () => {
    await fetchOpinion(true)
  }, [fetchOpinion])

  const submitFeedback = useCallback(
    async (rating: AIOpinionFeedbackRating, reason: string | null = null) => {
      // Capture opinionId + viewerId at call time. Status is a ref-like
      // snapshot via the closure — fine because we only act if status
      // is 'ready' with a non-null opinionId.
      if (status.kind !== 'ready' || !status.opinionId || !viewerId) return
      const { error } = await supabase
        .from('ai_opinion_feedback')
        .upsert(
          {
            opinion_id: status.opinionId,
            viewer_id: viewerId,
            rating,
            reason: reason && reason.trim().length > 0 ? reason.trim() : null,
          },
          { onConflict: 'opinion_id,viewer_id' },
        )
      if (error) {
        logger.error('[useAIOpinion] feedback submit failed', error)
        throw error
      }
    },
    [status, viewerId],
  )

  return { status, regenerate, submitFeedback }
}
