import { Briefcase, FileText, Users, Plus } from 'lucide-react'
import { useCoachPostedOpportunityCounts } from '@/hooks/useClubRecruitmentCounts'
import { cn } from '@/lib/utils'
import DashboardCard from './DashboardCard'

/**
 * CoachPostedOpportunitiesCard — owner-only. The "I'm a recruiter"
 * side of the coach dashboard. Surfaces opportunities this coach has
 * created + how many applicants they've received, with a primary CTA
 * to publish a new role.
 *
 * Paired with CoachApplicationsCard on the dashboard so the two sides
 * of the marketplace (publishing vs applying) are visually distinct.
 *
 * Visible for ALL coaches — not just those with the
 * coach_recruits_for_team flag — so publishing stays discoverable.
 *
 * Data sources:
 *   - Open opportunities: count of opportunities where
 *     club_id = ownerProfileId AND status='open'.
 *   - Applications: total applicant rows across this coach's
 *     opportunities, fetched via fetch_club_opportunities_with_counts
 *     so the number matches the management surface exactly.
 */
interface CoachPostedOpportunitiesCardProps {
  /** Coach owner's profile id — used as the recruiter key on
   *  opportunities.club_id (the column is named for the original
   *  club use case but also stores coach recruiter ids). */
  ownerProfileId: string
  /** Primary CTA — opens the create-opportunity flow. */
  onCreateOpportunity: () => void
  /** Secondary CTA — routes to the vacancies management surface. */
  onManageOpportunities: () => void
  /** Intro sentence. Defaults to coach wording; the Club dashboard
   *  passes club-appropriate copy ("player and coach roles"). */
  bodyCopy?: string
}

const DEFAULT_BODY_COPY =
  'Publish coaching roles and recruit candidates. Review applications and shortlist in one place.'

export default function CoachPostedOpportunitiesCard({
  ownerProfileId,
  onCreateOpportunity,
  onManageOpportunities,
  bodyCopy = DEFAULT_BODY_COPY,
}: CoachPostedOpportunitiesCardProps) {
  // Shared fetch with the club #recruitment-summary card — ONE query per
  // dashboard under qk.coachPostedOpportunities; this tile reads open +
  // applicants and ignores the superset's pending count.
  const { counts, error } = useCoachPostedOpportunityCounts(ownerProfileId)
  const openCount = error ? 0 : counts?.open ?? null
  const applicants = error ? 0 : counts?.applicants ?? null

  const openLabel =
    openCount === null
      ? '—'
      : openCount === 1
        ? '1 open'
        : `${openCount} open`

  const applicantsLabel =
    applicants === null
      ? '—'
      : applicants === 1
        ? '1 applicant'
        : `${applicants} applicants`

  return (
    <DashboardCard
      icon={Briefcase}
      title="My Posted Opportunities"
      subtitle="Create roles and manage applicants"
      // No CTA in the card header — the primary action lives in the
      // body so it carries the right visual weight.
      testId="coach-posted-opportunities-card"
    >
      <div className="space-y-3.5">
        <p className="text-sm text-gray-600 leading-relaxed">
          {bodyCopy}
        </p>

        {/* Two metric tiles side-by-side. tabular-nums keeps the
            digits aligned across the My opportunities / Applications
            pair when both have multi-digit numbers. */}
        <div className="grid grid-cols-2 gap-2.5">
          <MetricTile
            icon={FileText}
            label="My opportunities"
            value={openLabel}
            active={openCount !== null && openCount > 0}
          />
          <MetricTile
            icon={Users}
            label="Applications"
            value={applicantsLabel}
            active={applicants !== null && applicants > 0}
          />
        </div>

        {/* Primary CTA — full-width purple gradient button. Action-
            first design: this is the single most-important action for
            a coach. */}
        <button
          type="button"
          onClick={onCreateOpportunity}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-hockia-primary to-hockia-secondary px-4 py-3 text-sm font-semibold text-white shadow-sm hover:opacity-95 transition-opacity"
        >
          <Plus className="h-4 w-4" />
          Create opportunity
        </button>

        {/* Secondary text link — Saved Candidates has its own dedicated
            bento card alongside this one, so the buried inline link
            that lived here previously is gone. */}
        <div className="text-center">
          <button
            type="button"
            onClick={onManageOpportunities}
            className="text-sm font-medium text-hockia-primary hover:text-[#6B20D4]"
          >
            Manage all →
          </button>
        </div>
      </div>
    </DashboardCard>
  )
}

interface MetricTileProps {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  active: boolean
}

function MetricTile({ icon: Icon, label, value, active }: MetricTileProps) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-3">
      <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
        <Icon className="h-3.5 w-3.5 text-hockia-primary" />
        <span className="truncate">{label}</span>
      </div>
      <p
        className={cn(
          'text-base font-bold tabular-nums leading-none',
          active ? 'text-gray-900' : 'text-gray-500',
        )}
      >
        {value}
      </p>
    </div>
  )
}
