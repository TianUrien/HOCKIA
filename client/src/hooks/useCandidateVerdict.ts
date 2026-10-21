import { useClubFit } from '@/hooks/useClubFit'
import { useCoachFit } from '@/hooks/useCoachFit'
import { useEvidence } from '@/hooks/useEvidence'
import { categoryToBandTarget, useInterest } from '@/hooks/useInterest'
import { getClubLevelBand } from '@/hooks/useWorldClubLogo'
import { useActiveRecruitingTargetProblem, useHasActiveRecruitingScope } from '@/hooks/useRecruitingContext'
import { computeRecruiterVerdict, type RecruiterVerdict } from '@/lib/recruiterVerdict'
import type { Profile } from '@/components/community/PeopleListView'

/**
 * The recruiter's explained fit for one candidate: Club Fit for players,
 * Coach Fit for coaches, fused with the Proven and Interested lenses into the
 * same verdict the full profile (ScoutingCard) and the preview read. Pure
 * client rules on the already-fetched row: no extra read. Self-gates to
 * nothing for a non-candidate (club, brand, umpire) or a null member.
 */
export function useCandidateVerdict(member: Profile | null) {
  const isCoach = member?.role === 'coach'
  const clubFit = useClubFit(
    member && member.role === 'player'
      ? {
          id: member.id,
          role: member.role,
          playing_category: member.playing_category ?? null,
          current_world_club_id: member.current_world_club_id ?? null,
          // Resolve the proven band so competition_proximity matches the grid
          // + profile (which both pass it).
          competition_level_band: getClubLevelBand(member.current_world_club_id ?? null, categoryToBandTarget(member.playing_category ?? null)),
          open_to_play: member.open_to_play ?? null,
          open_to_coach: member.open_to_coach ?? null,
          open_to_opportunities: member.open_to_opportunities ?? null,
          last_active_at: member.last_active_at ?? null,
          position: member.position ?? null,
          secondary_position: member.secondary_position ?? null,
          specialist_skills: member.specialist_skills ?? null,
        }
      : null,
  )
  const coachFit = useCoachFit(
    member && member.role === 'coach'
      ? {
          id: member.id,
          role: member.role,
          coach_specialization: member.coach_specialization ?? null,
          coaching_categories: member.coaching_categories ?? null,
        }
      : null,
  )
  const fit = isCoach ? coachFit : clubFit
  const evidence = useEvidence(
    member
      ? {
          role: member.role,
          highlight_video_url: member.highlight_video_url ?? null,
          full_game_video_count: member.full_game_video_count ?? null,
          accepted_reference_count: member.accepted_reference_count ?? null,
          is_verified: member.is_verified ?? null,
          current_world_club_id: member.current_world_club_id ?? null,
        }
      : null,
  )
  const interest = useInterest(
    member
      ? {
          role: member.role,
          relocation_willingness: member.relocation_willingness ?? null,
          relocation_countries_open: member.relocation_countries_open ?? null,
          relocation_countries_excluded: member.relocation_countries_excluded ?? null,
          available_from: member.available_from ?? null,
          home_country_id: member.base_country_id ?? member.nationality_country_id ?? null,
          current_world_club_id: member.current_world_club_id ?? null,
          playing_category: member.playing_category ?? null,
          level_target: member.level_target ?? null,
          opportunity_preference: member.opportunity_preference ?? null,
        }
      : null,
  )
  const hasOpeningScope = useHasActiveRecruitingScope()
  const problem = useActiveRecruitingTargetProblem()
  const verdict: RecruiterVerdict = computeRecruiterVerdict({
    fit,
    evidence,
    interest,
    hasOpeningScope,
    problem,
    candidateRole: member?.role ?? null,
  })
  return { fit, verdict }
}
