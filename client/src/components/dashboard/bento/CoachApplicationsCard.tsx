import { useEffect, useState } from 'react'
import { Send, FileText, CheckCircle2, ArrowRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { requestCache } from '@/lib/requestCache'
import { cn } from '@/lib/utils'
import DashboardCard from './DashboardCard'

/**
 * CoachApplicationsCard — owner-only. The "I'm a candidate" side of
 * the coach dashboard. Surfaces opportunities this coach has applied
 * to (status pending/shortlisted/maybe — "active" rows), highlighting
 * shortlisted as the higher-signal subset.
 *
 * Paired with CoachPostedOpportunitiesCard so the dashboard makes the
 * coach's dual marketplace role obvious: they publish AND they apply.
 *
 * Data source: opportunity_applications keyed by applicant_id. Closed
 * rows (declined) are excluded so the dashboard doesn't dwell on
 * dead applications — same convention the player OpportunitiesCard
 * uses for the "active" count.
 */
interface CoachApplicationsCardProps {
  /** Coach's profile id — keyed against opportunity_applications.applicant_id. */
  ownerProfileId: string
  /** Primary CTA — routes to the marketplace browse surface. */
  onBrowseOpportunities: () => void
  /** Secondary CTA — also routes to the marketplace but with intent
   *  to see only the coach's own applications. (The marketplace
   *  surfaces "you applied" badges so the user can scan their state
   *  there.) */
  onViewApplications: () => void
  /** When true, the card spans both columns of the Bento grid on md+.
   *  Used as the closing card so it doesn't sit alone on the left
   *  with a visual gap on desktop. */
  fullWidth?: boolean
}

const ACTIVE_STATUSES = ['pending', 'shortlisted', 'maybe'] as const
const SHORTLISTED_STATUS = 'shortlisted'

export default function CoachApplicationsCard({
  ownerProfileId,
  onBrowseOpportunities,
  onViewApplications,
  fullWidth = false,
}: CoachApplicationsCardProps) {
  const [appliedCount, setAppliedCount] = useState<number | null>(null)
  const [shortlistedCount, setShortlistedCount] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    // Bento-card fetch dedup (JourneyCard pattern). Both counts cached
    // under one key so a single round trip serves Bento re-renders +
    // tab navs back to landing. 30s TTL — marketplace + applications
    // surfaces refetch on visit when the user takes action.
    const cacheKey = `coach-applications-card-${ownerProfileId}`
    const fetchCounts = async () => {
      try {
        const result = await requestCache.dedupe<{ applied: number; shortlisted: number }>(
          cacheKey,
          async () => {
            const appliedRes = await supabase
              .from('opportunity_applications')
              .select('id', { count: 'exact', head: true })
              .eq('applicant_id', ownerProfileId)
              .in('status', [...ACTIVE_STATUSES])
            if (appliedRes.error) throw appliedRes.error
            const shortRes = await supabase
              .from('opportunity_applications')
              .select('id', { count: 'exact', head: true })
              .eq('applicant_id', ownerProfileId)
              .eq('status', SHORTLISTED_STATUS)
            if (shortRes.error) throw shortRes.error
            return {
              applied: appliedRes.count ?? 0,
              shortlisted: shortRes.count ?? 0,
            }
          },
          30000,
        )
        if (cancelled) return
        setAppliedCount(result.applied)
        setShortlistedCount(result.shortlisted)
      } catch (err) {
        if (cancelled) return
        logger.error('[CoachApplicationsCard] fetch counts failed', err)
        setAppliedCount(0)
        setShortlistedCount(0)
      }
    }
    void fetchCounts()
    return () => {
      cancelled = true
    }
  }, [ownerProfileId])

  const appliedLabel =
    appliedCount === null
      ? '—'
      : appliedCount === 1
        ? '1 active'
        : `${appliedCount} active`

  const shortlistedLabel =
    shortlistedCount === null
      ? '—'
      : shortlistedCount === 1
        ? '1 shortlisted'
        : `${shortlistedCount} shortlisted`

  return (
    <DashboardCard
      icon={Send}
      title="My Applications"
      subtitle="Track coaching roles you applied to"
      testId="coach-applications-card"
      fullWidth={fullWidth}
    >
      <div className="space-y-3.5">
        <p className="text-sm text-gray-600 leading-relaxed">
          Apply to coaching roles posted by clubs and other recruiters. Track where you stand and keep an eye on shortlists.
        </p>

        <div className="grid grid-cols-2 gap-2.5">
          <MetricTile
            icon={FileText}
            label="Applied"
            value={appliedLabel}
            active={appliedCount !== null && appliedCount > 0}
          />
          <MetricTile
            icon={CheckCircle2}
            label="Shortlisted"
            value={shortlistedLabel}
            active={shortlistedCount !== null && shortlistedCount > 0}
            tone="success"
          />
        </div>

        {/* Primary CTA — full-width purple gradient button. */}
        <button
          type="button"
          onClick={onBrowseOpportunities}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-hockia-primary to-hockia-secondary px-4 py-3 text-sm font-semibold text-white shadow-sm hover:opacity-95 transition-opacity"
        >
          <ArrowRight className="h-4 w-4" />
          Browse opportunities
        </button>

        {/* Secondary — only enabled when the coach actually has
            applications to view; otherwise the action wouldn't lead
            anywhere meaningful. */}
        <div className="text-center">
          <button
            type="button"
            onClick={onViewApplications}
            disabled={!appliedCount}
            className="text-sm font-medium text-hockia-primary hover:text-[#6B20D4] disabled:text-gray-400 disabled:cursor-not-allowed"
          >
            View applications →
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
  tone?: 'default' | 'success'
}

function MetricTile({ icon: Icon, label, value, active, tone = 'default' }: MetricTileProps) {
  const iconColor =
    tone === 'success' && active ? 'text-emerald-600' : 'text-hockia-primary'
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-3">
      <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
        <Icon className={cn('h-3.5 w-3.5', iconColor)} />
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
