import { useEffect, useState } from 'react'
import { Briefcase, FileText, Users, Plus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
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
  const [openCount, setOpenCount] = useState<number | null>(null)
  const [applicants, setApplicants] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    const fetchCounts = async () => {
      try {
        const openRes = await supabase
          .from('opportunities')
          .select('id', { count: 'exact', head: true })
          .eq('club_id', ownerProfileId)
          .eq('status', 'open')
        if (cancelled) return
        if (openRes.error) throw openRes.error
        setOpenCount(openRes.count ?? 0)

        // Same RPC the vacancies tab uses; returns rows + applicant
        // counts. We sum the counts here for the header metric so the
        // number matches what the coach sees inside the management
        // surface.
        const appsRes = await supabase.rpc('fetch_club_opportunities_with_counts', {
          p_club_id: ownerProfileId,
          p_include_closed: false,
          p_limit: 200,
        })
        if (cancelled) return
        if (appsRes.error) throw appsRes.error
        const total = (appsRes.data ?? []).reduce(
          (sum: number, row: { applicant_count?: number | null }) =>
            sum + (row.applicant_count ?? 0),
          0,
        )
        if (!cancelled) setApplicants(total)
      } catch (err) {
        logger.error('[CoachOpportunitiesCard] fetch counts failed', err)
        if (!cancelled) {
          setOpenCount(0)
          setApplicants(0)
        }
      }
    }
    void fetchCounts()
    return () => {
      cancelled = true
    }
  }, [ownerProfileId])

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
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#8026FA] to-[#924CEC] px-4 py-3 text-sm font-semibold text-white shadow-sm hover:opacity-95 transition-opacity"
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
            className="text-sm font-medium text-[#8026FA] hover:text-[#6B20D4]"
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
        <Icon className="h-3.5 w-3.5 text-[#8026FA]" />
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
