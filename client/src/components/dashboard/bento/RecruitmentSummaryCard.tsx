import { Briefcase, Plus, ArrowRight } from 'lucide-react'
import { useClubRecruitmentCounts } from '@/hooks/useClubRecruitmentCounts'

/**
 * RecruitmentSummaryCard — club-only recruitment gateway.
 *
 * Sits high on the Club Dashboard (right after the hero) so a recruiter's
 * primary recurring action — post a role, check applicants — is immediately
 * reachable on mobile without scrolling past the profile/identity cards.
 * The full "My Posted Opportunities" tile remains lower as the detailed
 * management surface (this is the gateway, that is the detail).
 *
 * Club-only by placement: rendered solely from ClubDashboard. Reuses the
 * posted-opportunities tile's cached counts (same dedupe key) — no extra
 * query, and the shared coach card is untouched.
 *
 * Mobile-first: a stacked card. Desktop: a slim premium band (stats left,
 * actions right).
 */
interface RecruitmentSummaryCardProps {
  ownerId: string
  onCreateOpportunity: () => void
  onManageOpportunities: () => void
}

export default function RecruitmentSummaryCard({
  ownerId,
  onCreateOpportunity,
  onManageOpportunities,
}: RecruitmentSummaryCardProps) {
  const { counts, loading } = useClubRecruitmentCounts(ownerId)

  const open = counts?.open ?? 0
  const pending = counts?.pending ?? 0
  const applicants = counts?.applicants ?? 0
  const hasOpen = open > 0

  // "2 open · 3 pending · 7 total applicants" — pending shown when present,
  // gracefully collapses when there are no applicants yet.
  const statLine = (() => {
    const parts: string[] = [`${open} open`]
    if (applicants > 0) {
      if (pending > 0) parts.push(`${pending} pending`)
      parts.push(`${applicants} total applicant${applicants === 1 ? '' : 's'}`)
    } else {
      parts.push('no applicants yet')
    }
    return parts.join(' · ')
  })()

  return (
    <section
      aria-label="Recruitment"
      className="rounded-2xl border border-[#8026FA]/20 bg-gradient-to-br from-[#8026FA]/[0.05] to-[#924CEC]/[0.04] p-4 sm:p-5 shadow-sm"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        {/* Left: title + stats (or empty-state copy) */}
        <div className="flex items-start gap-3 min-w-0">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-white text-[#8026FA] shadow-sm">
            <Briefcase className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            {loading ? (
              <>
                <div className="h-4 w-28 rounded bg-gray-200/80 animate-pulse" />
                <div className="mt-2 h-3 w-40 rounded bg-gray-200/60 animate-pulse" />
              </>
            ) : hasOpen ? (
              <>
                <h2 className="text-base font-semibold text-gray-900">Recruitment</h2>
                <p className="mt-0.5 text-sm text-gray-600">{statLine}</p>
              </>
            ) : (
              <>
                <h2 className="text-base font-semibold text-gray-900">Ready to recruit?</h2>
                <p className="mt-0.5 text-sm text-gray-600">
                  Post an opportunity and start receiving applicants.
                </p>
              </>
            )}
          </div>
        </div>

        {/* Right: actions (stack on mobile, inline band on desktop) */}
        <div className="flex flex-shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={onCreateOpportunity}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#8026FA] to-[#924CEC] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 min-h-[44px]"
          >
            <Plus className="h-4 w-4" />
            Post an opportunity
          </button>
          {hasOpen && (
            <button
              type="button"
              onClick={onManageOpportunities}
              className="inline-flex items-center justify-center gap-1 rounded-xl px-3 py-2 text-sm font-medium text-[#5b16b8] transition hover:bg-[#8026FA]/10 min-h-[44px]"
            >
              Manage recruitment
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
