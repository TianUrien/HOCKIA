import { useNavigate } from 'react-router-dom'
import { Users, Zap, ChevronRight } from 'lucide-react'
import { useAuthStore } from '@/lib/auth'
import { usePublisherResponsiveness } from '@/hooks/usePublisherResponsiveness'
import type { RolesHealthTotals } from '@/hooks/useRolesHealth'
import { recordModuleImpression, trackModuleClick, useImpressionOnce } from '@/lib/homeInstrumentation'

/**
 * "Applicants to review" (club Pulse, Home V2 Phase 2): the triage card that
 * attacks the pending-application pile — pending total, "N new" badge (never
 * opened), and the response nudge. The nudge uses the club's REAL
 * responsiveness tier (publisher_responsiveness, 72h = fast) — no invented
 * statistics. Collapses at 0 pending (§C).
 */
const MODULE_ID = 'applicants_review'
const POSITION = 2

export function ApplicantsToReview({ totals, loading }: { totals: RolesHealthTotals; loading: boolean }) {
  const navigate = useNavigate()
  const profileId = useAuthStore((s) => s.profile?.id)
  const tier = usePublisherResponsiveness(profileId ?? null)
  const ref = useImpressionOnce(() => recordModuleImpression(MODULE_ID, POSITION))

  if (loading || totals.pending === 0) return null

  return (
    <section ref={ref} className="mb-6">
      <button
        type="button"
        onClick={() => {
          trackModuleClick(MODULE_ID, POSITION)
          navigate('/dashboard/profile/opportunities')
        }}
        className="flex w-full items-center gap-3 rounded-2xl border border-gray-100 bg-white px-4 py-3.5 text-left shadow-sm transition-shadow hover:shadow-md"
      >
        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[#f4f0fd]">
          <Users className="h-5 w-5 text-hockia-primary" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-[#14141c]">
            {totals.pending} applicant{totals.pending === 1 ? '' : 's'} waiting for a reply
            {totals.newApplicants > 0 && (
              <span className="ml-2 inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-600">
                {totals.newApplicants} new
              </span>
            )}
          </p>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-gray-500">
            <Zap className="h-3 w-3 text-emerald-500" />
            {tier === 'fast'
              ? 'You respond fast — players notice. Keep it up.'
              : 'Quick replies win players — respond within 3 days to stay ahead.'}
          </p>
        </div>
        <ChevronRight className="h-4 w-4 flex-shrink-0 text-gray-300" />
      </button>
    </section>
  )
}
