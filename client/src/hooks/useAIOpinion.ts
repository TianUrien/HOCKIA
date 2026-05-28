/**
 * useAIOpinion — Section F AI Opinion Engine client hook.
 *
 * Pulls a cached opinion for (viewer, player) from the ai_opinions
 * table (RLS gates to own rows), and falls back to the ai-opinion
 * edge function on miss. The edge function does its own server-side
 * cache check + LLM call + quota-tracked persistence, so a fresh hook
 * mount within the 24h TTL never re-pays for the LLM.
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
  | { kind: 'ready'; data: AIOpinionResult; cached: boolean; quotaRemaining: number | null }
  | { kind: 'not_applicable'; reason: 'no_target' | 'not_recruiter' | 'self' | 'fit_not_applicable' }
  | { kind: 'quota_exceeded'; resetsAt: string }
  | { kind: 'error'; message: string }

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
export function useAIOpinion(
  candidate: FitCandidateFields | null | undefined,
  options: UseAIOpinionOptions = {},
): {
  status: AIOpinionStatus
  /** Re-fetch from the edge function, bypassing the local cache check.
   *  Used by the panel's "Regenerate" affordance. Still respects the
   *  server-side cache (so cheap if context_hash hasn't changed) AND
   *  the 50/day quota. */
  regenerate: () => Promise<void>
} {
  const enabled = options.enabled !== false
  const { profile: viewer } = useAuthStore()
  const fit = useClubFit(candidate)
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

      // Local pre-flight: try the RLS-gated read first. The edge
      // function will repeat this check server-side with the same
      // context_hash, but the client read is free + fast. Skips the
      // edge function entirely when fresh.
      if (!forceRefresh) {
        const { data: existing } = await supabase
          .from('ai_opinions')
          .select('verdict_short, citations, expires_at')
          .eq('viewer_id', viewerId)
          .eq('player_id', candidateId)
          .gt('expires_at', new Date().toISOString())
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (seq !== requestSeq.current) return
        if (existing) {
          // Generated types treat the jsonb column as Json; the
          // edge function enforces the AIOpinionCitation shape on
          // write so a runtime cast is safe here.
          const row = existing as unknown as { verdict_short: string; citations: AIOpinionCitation[] }
          setStatus({
            kind: 'ready',
            data: { verdict_short: row.verdict_short, citations: row.citations },
            cached: true,
            quotaRemaining: null,
          })
          return
        }
      }

      // Cache miss (or force refresh) — call the edge function.
      // When forceRefresh=true (user clicked Regenerate), pass
      // `force: true` so the server-side cache check is also bypassed.
      // Without this the edge function would serve the same cached row
      // and Regenerate would be a no-op (QA F8).
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

  return { status, regenerate }
}
