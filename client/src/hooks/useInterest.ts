/**
 * useInterest — the 🤝 Interested lens for a candidate vs the active
 * opportunity scope (Matching Increment #2.2, extended in #4b). Recruiter-
 * gated like the other lenses; additionally NOT_APPLICABLE unless an
 * opportunity scope is active (computeInterest needs at least one of the
 * scope's location / start / level / compensation to compare against), so
 * it naturally shows only in the scoped context.
 *
 * #4b: this hook resolves the candidate's PROVEN level — the curated league
 * band of their current club — from the world-club cache (the same source
 * useClubFit reads for the viewer's band), then feeds it plus the
 * opportunity's level_sought / compensation into the pure scorer. The band
 * resolution lives here (not in computeInterest) so the scorer stays a
 * pure, testable function over plain values. Each surface that renders the
 * chip warms the cache via prefetchWorldClubLogos before render.
 */

import { useMemo } from 'react'
import { useAuthStore } from '@/lib/auth'
import { useCountries } from '@/hooks/useCountries'
import { computeInterest, type InterestResult, type InterestCandidateFields } from '@/lib/interestFit'
import { getClubLevelBand } from '@/hooks/useWorldClubLogo'
import {
  useActiveRecruitingTargetRole,
  useActiveRecruitingTargetLocation,
  useActiveRecruitingTargetStartDate,
  useActiveRecruitingTargetLevel,
  useActiveRecruitingTargetCompensation,
} from './useRecruitingContext'

/** The candidate shape this hook accepts: the pure scorer's fields plus the
 *  raw inputs needed to resolve the proven band when it isn't already
 *  supplied (e.g. the carousel's RPC provides `proven_level_band` directly;
 *  the grid + deep profile supply the club id + category instead). */
export type InterestCandidateInput = InterestCandidateFields & {
  current_world_club_id?: string | null
  playing_category?: string | null
}

/** Map a player's category to the men/women league the band should come
 *  from. Mirrors getPlayerLeagueName's category handling. Exported so
 *  surfaces without a warm club cache (the deep profile) can resolve the
 *  band themselves and pass it in as proven_level_band. */
export function categoryToBandTarget(category: string | null | undefined): 'Men' | 'Women' | 'Mixed' | null {
  if (category === 'adult_men' || category === 'boys') return 'Men'
  if (category === 'adult_women' || category === 'girls') return 'Women'
  return null
}

export function useInterest(
  candidate: InterestCandidateInput | null | undefined,
): InterestResult {
  const { profile: viewer } = useAuthStore()
  const isRecruiter = viewer?.role === 'club' || viewer?.role === 'coach'
  const targetRole = useActiveRecruitingTargetRole()
  const targetLocationCountry = useActiveRecruitingTargetLocation()
  const targetStartDate = useActiveRecruitingTargetStartDate()
  const targetLevel = useActiveRecruitingTargetLevel()
  const targetCompensation = useActiveRecruitingTargetCompensation()
  const { getCountryById } = useCountries()

  return useMemo(() => {
    if (!candidate) {
      return { isApplicable: false, level: 'low' as const, score: 0, reasons: [] }
    }
    // Resolve the proven band: prefer an explicitly-supplied band (carousel
    // RPC), else derive from the linked club's league via the warm cache.
    const provenBand =
      candidate.proven_level_band ??
      getClubLevelBand(candidate.current_world_club_id ?? null, categoryToBandTarget(candidate.playing_category))

    const result = computeInterest(
      { ...candidate, proven_level_band: provenBand },
      {
        targetRole,
        targetLocationCountry,
        targetStartDate,
        targetLevel,
        targetCompensation,
        countryName: (id) => getCountryById(id)?.name,
      },
    )
    if (!isRecruiter) return { ...result, isApplicable: false }
    return result
  }, [
    candidate,
    isRecruiter,
    targetRole,
    targetLocationCountry,
    targetStartDate,
    targetLevel,
    targetCompensation,
    getCountryById,
  ])
}
