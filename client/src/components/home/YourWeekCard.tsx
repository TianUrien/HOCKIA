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
  const matched = opps.mode === 'matched' ? opps.items.length : 0
  const replies = apps.applications.filter((a) => a.status !== 'pending').length
  const stats: Stat[] = isTalent
    ? [
        { value: matched, label: matched === 1 ? 'role matches you' : 'roles match you' },
        { value: views, label: views === 1 ? 'profile view' : 'profile views' },
        { value: replies, label: replies === 1 ? 'club reply' : 'club replies' },
      ]
    : isClub
      ? [
          { value: scoped.fitCount, label: 'fit your search' },
          { value: roles.totals.newApplicants, label: roles.totals.newApplicants === 1 ? 'new applicant' : 'new applicants' },
          { value: views, label: views === 1 ? 'profile view' : 'profile views' },
        ]
      : [{ value: views, label: views === 1 ? 'profile view' : 'profile views' }]

  return (
    <Link
      to="/pulse"
      className="block overflow-hidden rounded-[18px] bg-surface-grouped transition-colors active:bg-[#e9e9ef]"
      aria-label="Your week — open Pulse"
      data-testid="your-week-card"
    >
      {/* Figma Home v2 · Your week: 17/semibold title with a chevron, a hairline,
          then equal centred cells separated by 30px dividers. */}
      <div className="flex h-12 items-center justify-between pl-4 pr-3.5">
        <h2 className="text-body font-semibold text-ink-1">Your week</h2>
        <ChevronRight className="h-5 w-5 text-ink-3" strokeWidth={1.75} aria-hidden="true" />
      </div>
      <div className="h-px bg-line" />
      <div className="flex items-stretch">
        {stats.map((s, i) => (
          <div key={s.label} className="relative flex min-w-0 flex-1 flex-col items-center gap-0.5 pb-2.5 pt-3.5">
            {i > 0 && <span className="absolute left-0 top-1/2 h-[30px] w-px -translate-y-1/2 bg-line" aria-hidden="true" />}
            {loading ? (
              <div className="h-[31px] w-8 animate-pulse rounded-md bg-line" />
            ) : (
              <div className="text-[26px] font-semibold leading-[31px] tracking-[-0.01em] tabular-nums text-ink-1">{s.value}</div>
            )}
            <div className="max-w-full truncate px-2 text-caption text-ink-2">{s.label}</div>
          </div>
        ))}
      </div>
    </Link>
  )
}
