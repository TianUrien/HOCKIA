/**
 * useEvidence — the "Proven" lens for a candidate, gated to recruiter
 * viewers. Evidence is a property of the candidate alone (no viewer
 * target needed), but it's a RECRUITMENT signal, so we only surface it to
 * club/coach viewers — mirroring how Club Fit is recruiter-only. Pure
 * derived state, no fetch.
 */

import { useMemo } from 'react'
import { useAuthStore } from '@/lib/auth'
import { computeEvidence, type EvidenceResult, type EvidenceCandidateFields } from '@/lib/evidence'

export function useEvidence(
  candidate: EvidenceCandidateFields | null | undefined,
): EvidenceResult {
  const { profile: viewer } = useAuthStore()
  const isRecruiter = viewer?.role === 'club' || viewer?.role === 'coach'
  return useMemo(() => {
    const result = computeEvidence(candidate)
    // Suppress for non-recruiter viewers (players browsing don't need a
    // recruitment confidence signal). Keep the computed shape so callers
    // can still read it, but mark not-applicable so the chip hides.
    if (!isRecruiter) return { ...result, isApplicable: false }
    return result
  }, [candidate, isRecruiter])
}
