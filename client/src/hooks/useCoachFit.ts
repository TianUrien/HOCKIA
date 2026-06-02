/**
 * useCoachFit — Coach Fit sibling of useClubFit (Phase 2C). Computes a
 * specialization-first fit for a single COACH candidate against the
 * viewer's active recruiting scope.
 *
 * Like useClubFit it is pure derived state (no fetch, no cache) and reads
 * the active scope from the shared zustand store, so many chips on one
 * page trigger ONE context fetch. Returns NOT_APPLICABLE (chip hides)
 * unless the active scope seeks a coach AND names a specific coaching role
 * — see computeCoachFit for the full applicability contract.
 */

import { useMemo } from 'react'
import { useAuthStore } from '@/lib/auth'
import {
  computeCoachFit,
  type CoachFitResult,
  type CoachFitCandidateFields,
} from '@/lib/coachFit'
import {
  useActiveRecruitingTarget,
  useActiveRecruitingTargetRole,
  useActiveRecruitingTargetPosition,
} from './useRecruitingContext'

export function useCoachFit(
  candidate: CoachFitCandidateFields | null | undefined,
): CoachFitResult {
  const { profile: viewerProfile } = useAuthStore()
  const overrideTarget = useActiveRecruitingTarget()
  const targetRole = useActiveRecruitingTargetRole()
  // For coach opportunities the sought coaching role is carried in the
  // scope's target_position (opportunity.position holds the coach enum).
  const targetSpecialization = useActiveRecruitingTargetPosition()
  return useMemo(() => {
    const viewer = viewerProfile?.role
      ? {
          role: viewerProfile.role,
          womens_league_division: null,
          mens_league_division: null,
          current_world_club_id: viewerProfile.current_world_club_id ?? null,
        }
      : null
    return computeCoachFit(viewer, candidate, {
      overrideTarget,
      targetRole,
      targetSpecialization,
    })
  }, [viewerProfile, candidate, overrideTarget, targetRole, targetSpecialization])
}
