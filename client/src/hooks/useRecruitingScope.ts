import { useMemo } from 'react'
import {
  useActiveRecruitingTarget, useActiveRecruitingTargetRole, useActiveRecruitingTargetPosition,
  useActiveRecruitingTargetSpecialists, useActiveRecruitingTargetLocation, useActiveRecruitingTargetStartDate,
  useActiveRecruitingTargetLevel, useActiveRecruitingTargetCompensation,
  useHasActiveRecruitingScope, useActiveRecruitingTargetProblem,
  useActiveRecruitingMustHaves, useRecruitingContextStore,
} from '@/hooks/useRecruitingContext'
import { useCountries } from '@/hooks/useCountries'
import { useAuthStore } from '@/lib/auth'
import type { ViewerScopeInputs } from '@/lib/scopedVerdicts'

/**
 * Gathers the viewer + active recruiting-context selectors into the
 * ViewerScopeInputs bundle computeScopedVerdicts consumes — one hook instead
 * of eleven at every scoped surface (community carousel, club Pulse hero/rail).
 * `scope` is null while there's no signed-in viewer or no active context (the
 * verdict engine is meaningless without a scope). `loading` distinguishes
 * "context store still fetching" from "genuinely no scope" — consumers MUST
 * gate on it or a club WITH a scope flashes the no-scope onboarding state on
 * every cold load (the context select races the other Pulse fetches).
 */
export function useRecruitingScope(): { scope: ViewerScopeInputs | null; loading: boolean } {
  const viewerProfile = useAuthStore((s) => s.profile)
  const contextTarget = useActiveRecruitingTarget()
  const targetRole = useActiveRecruitingTargetRole()
  const targetPosition = useActiveRecruitingTargetPosition()
  const targetSpecialists = useActiveRecruitingTargetSpecialists()
  const targetLocation = useActiveRecruitingTargetLocation()
  const targetStartDate = useActiveRecruitingTargetStartDate()
  const targetLevel = useActiveRecruitingTargetLevel()
  const targetCompensation = useActiveRecruitingTargetCompensation()
  const hasOpeningScope = useHasActiveRecruitingScope()
  const problem = useActiveRecruitingTargetProblem()
  const mustHaves = useActiveRecruitingMustHaves()
  const storeLoading = useRecruitingContextStore((s) => s.loading)
  const { countries } = useCountries()

  const scope = useMemo(() => {
    if (!viewerProfile || !contextTarget) return null
    return {
      viewer: {
        role: viewerProfile.role,
        womens_league_division: (viewerProfile as { womens_league_division?: string | null }).womens_league_division ?? null,
        mens_league_division: (viewerProfile as { mens_league_division?: string | null }).mens_league_division ?? null,
        current_world_club_id: viewerProfile.current_world_club_id ?? null,
      },
      contextTarget,
      targetRole,
      targetPosition,
      targetSpecialists,
      targetLocation,
      targetStartDate,
      targetLevel,
      targetCompensation,
      hasOpeningScope,
      problem,
      mustHaves,
      countryName: (id: number) => countries.find((c) => c.id === id)?.name,
    }
  }, [viewerProfile, contextTarget, targetRole, targetPosition, targetSpecialists, targetLocation, targetStartDate, targetLevel, targetCompensation, hasOpeningScope, problem, mustHaves, countries])

  return { scope, loading: storeLoading }
}
