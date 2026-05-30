/**
 * useClubFit — pulls the auth viewer profile and computes a Club Fit
 * for a single candidate row. Pure derived state; no async fetch,
 * no cache table. Recomputes when either side changes.
 *
 * Sprint 2/3: when the viewer has an active recruiting_context row
 * (clubs auto-seeded, coaches opt-in via the switcher), its
 * target_category overrides the implicit profile-derived target. So
 * a multi-team club (Mixed by profile) can switch their Fit math to
 * scope to "Women's team" via the ContextSwitcher chip without
 * editing their profile, and a coach gets a working Fit chip the
 * moment they set a context.
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
import {
  deriveTargetCategory,
  type RecruitingContextProfileFields,
} from '@/lib/recruitingContext'
import type { Profile } from '@/lib/supabase'
import { useActiveRecruitingTarget, useActiveRecruitingTargetRole } from './useRecruitingContext'
import { getClubLevelBand } from './useWorldClubLogo'

/** Narrow a full profile down to just the recruiting-context fields,
 *  plus the derived competition_level_band that drives proximity.
 *  The band is picked by the recruiter's effective target (override
 *  context first, profile-derived fallback) so a women's-team scope
 *  reads the women's-league band of the viewer's own club. */
function toViewerProfile(
  profile: Partial<Profile> | null | undefined,
  effectiveTarget: 'Men' | 'Women' | 'Mixed' | null,
): (RecruitingContextProfileFields & { competition_level_band?: number | null }) | null {
  if (!profile || !profile.role) return null
  const clubId = profile.current_world_club_id ?? null
  return {
    role: profile.role,
    womens_league_division: (profile as { womens_league_division?: string | null }).womens_league_division ?? null,
    mens_league_division: (profile as { mens_league_division?: string | null }).mens_league_division ?? null,
    current_world_club_id: clubId,
    competition_level_band: getClubLevelBand(clubId, effectiveTarget),
  }
}

export function useClubFit(
  candidate: FitCandidateFields | null | undefined,
): ClubFitResult {
  const { profile: viewerProfile } = useAuthStore()
  const overrideTarget = useActiveRecruitingTarget()
  const targetRole = useActiveRecruitingTargetRole()
  return useMemo(() => {
    const profileTarget = deriveTargetCategory({
      role: viewerProfile?.role ?? null,
      womens_league_division: (viewerProfile as { womens_league_division?: string | null } | null | undefined)?.womens_league_division ?? null,
      mens_league_division: (viewerProfile as { mens_league_division?: string | null } | null | undefined)?.mens_league_division ?? null,
      current_world_club_id: viewerProfile?.current_world_club_id ?? null,
    })
    const effectiveTarget = overrideTarget ?? profileTarget
    return computeClubFit(
      toViewerProfile(viewerProfile, effectiveTarget),
      candidate,
      { overrideTarget, targetRole },
    )
  }, [viewerProfile, candidate, overrideTarget, targetRole])
}
