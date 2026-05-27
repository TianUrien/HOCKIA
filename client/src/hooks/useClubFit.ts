/**
 * useClubFit — pulls the auth viewer profile and computes a Club Fit
 * for a single candidate row. Pure derived state; no async fetch,
 * no cache table. Recomputes when either side changes.
 *
 * Sprint 2: when the club viewer has an active recruiting_context
 * row, its target_category overrides the implicit profile-derived
 * target. So a multi-team club (Mixed by profile) can switch their
 * Fit math to scope to "Women's team" via the ContextSwitcher chip
 * without editing their profile.
 *
 * The active context is read from a shared zustand store (see
 * useActiveRecruitingTarget), so many ClubFitChip instances on
 * one page trigger ONE network fetch, not N.
 */

import { useMemo } from 'react'
import { useAuthStore } from '@/lib/auth'
import {
  computeClubFit,
  type ClubFitResult,
  type FitCandidateFields,
} from '@/lib/clubFit'
import type { RecruitingContextProfileFields } from '@/lib/recruitingContext'
import type { Profile } from '@/lib/supabase'
import { useActiveRecruitingTarget } from './useRecruitingContext'

/** Narrow a full profile down to just the recruiting-context fields. */
function toViewerProfile(
  profile: Partial<Profile> | null | undefined,
): (RecruitingContextProfileFields & { competition_tier?: number | null; competition_country_code?: string | null }) | null {
  if (!profile || !profile.role) return null
  return {
    role: profile.role,
    womens_league_division: (profile as { womens_league_division?: string | null }).womens_league_division ?? null,
    mens_league_division: (profile as { mens_league_division?: string | null }).mens_league_division ?? null,
    current_world_club_id: profile.current_world_club_id ?? null,
    // Sprint v1: we don't have the viewer's tier joined yet. Set to
    // null — the Fit math will return 0 for competition_proximity in
    // that case, which is honest (we can't compute it). The Hockey
    // Context line work in a follow-up slice will denormalize this
    // and enable real proximity scoring.
    competition_tier: null,
    competition_country_code: null,
  }
}

export function useClubFit(
  candidate: FitCandidateFields | null | undefined,
): ClubFitResult {
  const { profile: viewerProfile } = useAuthStore()
  const overrideTarget = useActiveRecruitingTarget()
  return useMemo(
    () =>
      computeClubFit(toViewerProfile(viewerProfile), candidate, {
        overrideTarget,
      }),
    [viewerProfile, candidate, overrideTarget],
  )
}
