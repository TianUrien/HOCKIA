import RecruiterVerdictCard from './RecruiterVerdictCard'
import AIOpinionPanel from './AIOpinionPanel'
import { useCandidateVerdict } from '@/hooks/useCandidateVerdict'
import type { Profile } from '@/components/community/PeopleListView'

/**
 * "Why this fit" for recruiters on the desktop deck (founder decision
 * 2026-10-21, after design audit B1/B2): the explained fit the old candidate
 * preview showed, inline in the deck's details column. The verdict card (the
 * one Fit badge + each criterion met or missed, never a percentage) and the
 * Hockia AI fit opinion (Beta; its existing edge function, cache and quota).
 * Callers mount it for club and recruiting-coach viewers only, on player and
 * coach candidates.
 */
export default function RecruiterFitExplain({ member }: { member: Profile }) {
  const { verdict } = useCandidateVerdict(member)
  return (
    <div className="flex flex-col gap-3" data-testid="recruiter-fit-explain">
      {verdict.isApplicable ? (
        <RecruiterVerdictCard verdict={verdict} />
      ) : (
        <p className="rounded-[14px] bg-surface-muted px-3.5 py-2.5 text-[14px] leading-[19px] text-ink-2">
          No fit to explain yet. Choose a context in Ranked for.
        </p>
      )}
      <AIOpinionPanel
        candidate={{
          id: member.id,
          role: member.role,
          playing_category: member.playing_category ?? null,
          current_world_club_id: member.current_world_club_id ?? null,
          open_to_play: member.open_to_play ?? null,
          open_to_coach: member.open_to_coach ?? null,
          open_to_opportunities: member.open_to_opportunities ?? null,
          last_active_at: member.last_active_at ?? null,
          coach_specialization: member.coach_specialization ?? null,
          coaching_categories: member.coaching_categories ?? null,
        }}
      />
    </div>
  )
}
