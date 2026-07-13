import { computeClubFit } from '@/lib/clubFit'
import { computeCoachFit } from '@/lib/coachFit'
import { computeEvidence } from '@/lib/evidence'
import { computeInterest } from '@/lib/interestFit'
import { computeRecruiterVerdict, type RecruiterVerdict } from '@/lib/recruiterVerdict'
import { categoryToBandTarget } from '@/hooks/useInterest'
import { getClubLevelBand } from '@/hooks/useWorldClubLogo'
import type { RecruitingTargetCategory } from '@/hooks/useRecruitingContext'

/**
 * The Recruiter Verdict composition over a candidate pool — EXTRACTED
 * VERBATIM from TopCommunityMembersCarousel's verdictById memo so every
 * surface that ranks candidates for a recruiting scope (community carousel,
 * All-Members grid, club Pulse hero/rail) computes the SAME verdict from the
 * same inputs. "The card never disagrees with the profile" — one source.
 */

/** The candidate fields the composition reads (structural — TopMemberRow and
 *  any RPC row carrying these satisfies it). */
export interface ScopedCandidateRow {
  id: string
  role: string
  playing_category: string | null
  current_world_club_id: string | null
  competition_level_band: number | null
  open_to_play: boolean | null
  open_to_coach: boolean | null
  open_to_opportunities: boolean | null
  last_active_at: string | null
  position: string | null
  secondary_position: string | null
  specialist_skills: string[] | null
  coach_specialization?: string | null
  coaching_categories?: string[] | null
  highlight_video_url: string | null
  full_game_video_count: number | null
  accepted_reference_count: number | null
  is_verified: boolean | null
  relocation_willingness: string | null
  relocation_countries_open: number[] | null
  relocation_countries_excluded: number[] | null
  available_from: string | null
  base_country_id: number | null
  nationality_country_id: number | null
  level_target: string | null
  opportunity_preference: string | null
}

export interface ViewerScopeInputs {
  viewer: {
    role: string
    womens_league_division: string | null
    mens_league_division: string | null
    current_world_club_id: string | null
  }
  contextTarget: RecruitingTargetCategory | null
  targetRole: string | null
  targetPosition: string | null
  targetSpecialists: string[] | null
  targetLocation: string | null
  targetStartDate: string | null
  targetLevel: string | null
  targetCompensation: string | null
  hasOpeningScope: boolean
  problem: string | null
  mustHaves: {
    position: boolean
    specialists: boolean
    level: boolean
    compensation: boolean
    location: boolean
    availability: boolean
  }
  countryName: (id: number) => string | undefined
}

export function computeScopedVerdicts(
  members: readonly ScopedCandidateRow[],
  scope: ViewerScopeInputs,
): Map<string, RecruiterVerdict> {
  const map = new Map<string, RecruiterVerdict>()
  if (!scope.contextTarget) return map

  const viewerCtx = {
    role: scope.viewer.role,
    womens_league_division: scope.viewer.womens_league_division,
    mens_league_division: scope.viewer.mens_league_division,
    current_world_club_id: scope.viewer.current_world_club_id,
    competition_level_band: getClubLevelBand(scope.viewer.current_world_club_id, scope.contextTarget),
  }
  const interestScopeOptions = {
    targetRole: scope.targetRole,
    targetLocationCountry: scope.targetLocation,
    targetStartDate: scope.targetStartDate,
    targetLevel: scope.targetLevel,
    targetCompensation: scope.targetCompensation,
    countryName: scope.countryName,
    levelRequired: scope.mustHaves.level,
    compensationRequired: scope.mustHaves.compensation,
    locationRequired: scope.mustHaves.location,
    availabilityRequired: scope.mustHaves.availability,
  }

  members.forEach((m) => {
    const fit =
      m.role === 'coach'
        ? computeCoachFit(
            viewerCtx,
            { id: m.id, role: m.role, coach_specialization: m.coach_specialization ?? null, coaching_categories: m.coaching_categories ?? null },
            { overrideTarget: scope.contextTarget, targetRole: scope.targetRole, targetSpecialization: scope.targetPosition },
          )
        : computeClubFit(
            viewerCtx,
            {
              id: m.id,
              role: m.role,
              playing_category: m.playing_category,
              current_world_club_id: m.current_world_club_id,
              competition_level_band: getClubLevelBand(m.current_world_club_id, categoryToBandTarget(m.playing_category)) ?? m.competition_level_band,
              open_to_play: m.open_to_play,
              open_to_coach: m.open_to_coach,
              open_to_opportunities: m.open_to_opportunities,
              last_active_at: m.last_active_at,
              position: m.position,
              secondary_position: m.secondary_position,
              specialist_skills: m.specialist_skills,
            },
            {
              overrideTarget: scope.contextTarget,
              targetRole: scope.targetRole,
              targetPosition: scope.targetPosition,
              targetSpecialists: scope.targetSpecialists,
              positionRequired: scope.mustHaves.position,
              specialistsRequired: scope.mustHaves.specialists,
            },
          )
    if (!fit.isApplicable) return
    const evidence = computeEvidence({
      role: m.role,
      highlight_video_url: m.highlight_video_url,
      full_game_video_count: m.full_game_video_count,
      accepted_reference_count: m.accepted_reference_count,
      is_verified: m.is_verified,
      current_world_club_id: m.current_world_club_id,
    })
    const interest = computeInterest(
      {
        role: m.role,
        relocation_willingness: m.relocation_willingness,
        relocation_countries_open: m.relocation_countries_open,
        relocation_countries_excluded: m.relocation_countries_excluded,
        available_from: m.available_from,
        home_country_id: m.base_country_id ?? m.nationality_country_id,
        proven_level_band: getClubLevelBand(m.current_world_club_id, categoryToBandTarget(m.playing_category)) ?? m.competition_level_band,
        level_target: m.level_target,
        opportunity_preference: m.opportunity_preference,
      },
      interestScopeOptions,
    )
    const verdict = computeRecruiterVerdict({
      fit,
      evidence,
      interest,
      hasOpeningScope: scope.hasOpeningScope,
      problem: scope.problem,
      candidateRole: m.role,
    })
    if (verdict.isApplicable) map.set(m.id, verdict)
  })
  return map
}

/** The scoped-rail in-scope predicate — tier pursue/consider. */
export function isInScope(verdict: RecruiterVerdict | undefined): boolean {
  return Boolean(verdict && (verdict.tier === 'pursue' || verdict.tier === 'consider'))
}
