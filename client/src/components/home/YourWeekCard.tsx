import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { useAuthStore } from '@/lib/auth'
import { useWeeklyVisibility } from '@/hooks/useWeeklyVisibility'
import { useOpportunitiesForYou } from '@/hooks/useOpportunitiesForYou'
import { useMyApplications } from '@/hooks/useMyApplications'
import { useRolesHealth } from '@/hooks/useRolesHealth'
import { useScopedMatches } from '@/hooks/useScopedMatches'

/**
 * "Your week" — the three numbers that summarise Pulse, at the top of Home
 * (UI redesign 2026-09-19). Tapping anywhere opens /pulse.
 *
 * Every number is one the Pulse modules already compute from existing
 * queries — this card adds no data source:
 *   player / coach : roles that match you · profile views · club replies
 *   club           : fit your search · new applicants · profile views
 *   brand / umpire : profile views
 * "Club replies" = applications a club has acted on (no longer pending).
 */
interface Stat { value: number; label: string }

export function YourWeekCard() {
  const role = useAuthStore((s) => s.profile?.role)
  const isTalent = role === 'player' || role === 'coach'
  const isClub = role === 'club'

  const vis = useWeeklyVisibility(true, false)
  const opps = useOpportunitiesForYou(isTalent, role === 'coach' ? 'coach' : 'player')
  const apps = useMyApplications(isTalent)
  const roles = useRolesHealth(isClub)
  const scoped = useScopedMatches(isClub)

  const loading =
    vis.loading ||
    (isTalent && (opps.loading || apps.loading)) ||
    (isClub && (roles.loading || scoped.loading))

  const views = vis.visibility?.views_7d ?? 0
  const stats: Stat[] = isTalent
    ? [
        { value: opps.mode === 'matched' ? opps.items.length : 0, label: 'roles match you' },
        { value: views, label: 'profile views' },
        { value: apps.applications.filter((a) => a.status !== 'pending').length, label: 'club replies' },
      ]
    : isClub
      ? [
          { value: scoped.fitCount, label: 'fit your search' },
          { value: roles.totals.newApplicants, label: 'new applicants' },
          { value: views, label: 'profile views' },
        ]
      : [{ value: views, label: 'profile views' }]

  return (
    <Link
      to="/pulse"
      className="block rounded-2xl bg-[#F0F0F4] px-4 py-3.5 transition-colors hover:bg-[#EAEAF0] active:bg-[#E4E4EB]"
      aria-label="Your week — open Pulse"
      data-testid="your-week-card"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-gray-900">Your week</h2>
        <ChevronRight className="h-5 w-5 text-gray-400" strokeWidth={1.75} aria-hidden="true" />
      </div>
      <div className={`mt-2.5 grid gap-3 ${stats.length === 3 ? 'grid-cols-3' : stats.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {stats.map((s) => (
          <div key={s.label} className="min-w-0">
            {loading ? (
              <div className="h-7 w-8 animate-pulse rounded-md bg-gray-200" />
            ) : (
              <div className="text-[24px] font-semibold leading-7 tabular-nums text-gray-900">{s.value}</div>
            )}
            <div className="mt-0.5 truncate text-[12px] leading-4 text-gray-500">{s.label}</div>
          </div>
        ))}
      </div>
    </Link>
  )
}
