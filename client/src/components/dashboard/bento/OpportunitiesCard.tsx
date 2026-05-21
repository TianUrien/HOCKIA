import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Briefcase, FileText, Zap, ChevronRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { cn } from '@/lib/utils'
import AvailabilityToggleStrip from '@/components/AvailabilityToggleStrip'
import DashboardCard from './DashboardCard'

/**
 * OpportunitiesCard — owner-only. Shows the Open-to-Play / Open-to-
 * Opportunities toggles plus a live count of the player's active
 * applications. Saved opportunities is intentionally omitted for v1
 * (no `saved_opportunities` table exists yet).
 *
 * The toggle UI is the existing AvailabilityToggleStrip so the
 * underlying mutation logic stays in one place.
 */
interface OpportunitiesCardProps {
  /** Owner's profile id, used for the applications count query. */
  ownerProfileId: string
  onViewOpportunities: () => void
  /** When true, the card spans both columns of the Bento grid on md+.
   *  Used when Opportunities sits in a trailing row alone so it doesn't
   *  leave a visual gap on desktop. */
  fullWidth?: boolean
  /** Owner's role — drives the AvailabilityToggleStrip variant and
   *  the subtitle copy. Defaults to 'player' for backwards compat. */
  role?: 'player' | 'coach'
}

// "Active" = anything not declined. We treat pending / shortlisted /
// maybe as live signals worth surfacing on the dashboard. Rejected is
// excluded so the count doesn't dwell on closed loops.
const ACTIVE_STATUSES = ['pending', 'shortlisted', 'maybe'] as const

export default function OpportunitiesCard({ ownerProfileId, onViewOpportunities, fullWidth = false, role = 'player' }: OpportunitiesCardProps) {
  const navigate = useNavigate()
  const [activeCount, setActiveCount] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    async function fetchCount() {
      const { count, error } = await supabase
        .from('opportunity_applications')
        .select('id', { count: 'exact', head: true })
        .eq('applicant_id', ownerProfileId)
        .in('status', [...ACTIVE_STATUSES])

      if (cancelled) return
      if (error) {
        logger.error('[OPPORTUNITIES_CARD] Failed to fetch application count', error)
        setActiveCount(0)
      } else {
        setActiveCount(count ?? 0)
      }
    }
    void fetchCount()
    return () => {
      cancelled = true
    }
  }, [ownerProfileId])

  const activeLabel = activeCount === null
    ? '—'
    : activeCount === 1
      ? '1 active'
      : `${activeCount} active`

  return (
    <DashboardCard
      icon={Briefcase}
      title="Opportunities"
      subtitle={role === 'coach' ? 'Get found by clubs and players' : 'Get found by clubs and recruiters'}
      ctaLabel="View opportunities"
      onCtaClick={onViewOpportunities}
      testId="opportunities-card"
      fullWidth={fullWidth}
    >
      <div className="space-y-4">
        {/* Availability toggles. The existing component owns its own
            persistence + toast — no extra wiring needed here. */}
        <AvailabilityToggleStrip role={role} />

        {/* Applications row — taps through to the feed filtered to the
            user's own applications (?applied=mine). The bottom CTA browses
            all opportunities; this row is the "my applications" path. */}
        <button
          type="button"
          onClick={() => navigate('/opportunities?applied=mine')}
          className="flex w-full items-center gap-3 rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-2.5 text-left transition-colors hover:border-gray-200 hover:bg-gray-100"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white shadow-sm">
            <FileText className="h-4 w-4 text-[#8026FA]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-gray-500">My applications</p>
            <p className={cn(
              'text-sm font-semibold tabular-nums',
              activeCount && activeCount > 0 ? 'text-gray-900' : 'text-gray-500',
            )}>
              {activeLabel}
            </p>
          </div>
          {activeCount === 0 ? (
            <Zap className="h-4 w-4 text-amber-400" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-4 w-4 text-gray-400" aria-hidden="true" />
          )}
        </button>
      </div>
    </DashboardCard>
  )
}
