/**
 * useInterest — the 🤝 Interested lens for a candidate vs the active
 * opportunity scope (Matching Increment #2.2). Recruiter-gated like the
 * other lenses; additionally NOT_APPLICABLE unless an opportunity scope is
 * active (computeInterest needs the opportunity's location/start to
 * compare against), so it naturally shows only in the scoped context.
 */

import { useMemo } from 'react'
import { useAuthStore } from '@/lib/auth'
import { useCountries } from '@/hooks/useCountries'
import { computeInterest, type InterestResult, type InterestCandidateFields } from '@/lib/interestFit'
import {
  useActiveRecruitingTargetRole,
  useActiveRecruitingTargetLocation,
  useActiveRecruitingTargetStartDate,
} from './useRecruitingContext'

export function useInterest(
  candidate: InterestCandidateFields | null | undefined,
): InterestResult {
  const { profile: viewer } = useAuthStore()
  const isRecruiter = viewer?.role === 'club' || viewer?.role === 'coach'
  const targetRole = useActiveRecruitingTargetRole()
  const targetLocationCountry = useActiveRecruitingTargetLocation()
  const targetStartDate = useActiveRecruitingTargetStartDate()
  const { getCountryById } = useCountries()

  return useMemo(() => {
    const result = computeInterest(candidate, {
      targetRole,
      targetLocationCountry,
      targetStartDate,
      countryName: (id) => getCountryById(id)?.name,
    })
    if (!isRecruiter) return { ...result, isApplicable: false }
    return result
  }, [candidate, isRecruiter, targetRole, targetLocationCountry, targetStartDate, getCountryById])
}
