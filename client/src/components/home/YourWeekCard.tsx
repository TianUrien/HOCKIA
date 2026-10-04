import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { useAuthStore } from '@/lib/auth'
import { useWeeklyVisibility } from '@/hooks/useWeeklyVisibility'
import { useOpportunitiesForYou } from '@/hooks/useOpportunitiesForYou'
import { useMyApplications } from '@/hooks/useMyApplications'
import { useRolesHealth } from '@/hooks/useRolesHealth'
import { useScopedMatches } from '@/hooks/useScopedMatches'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { cn } from '@/lib/utils'
import { clubWeekStats, type WeekStat } from '@/lib/clubInbox'

/**
 * "Your week" — the three numbers that summarise Pulse, at the top of Home
 * (UI redesign 2026-09-19). Tapping anywhere opens /pulse.
 *
 * Every number is one the Pulse modules already compute from existing
 * queries — this card adds no data source:
 *   player / coach : roles for you · profile views · club replies
 *   club           : fit your search · new applicants · profile views
 *   brand / umpire : profile views
 * "Club replies" = applications a club has acted on (no longer pending).
 *
 * Club v2 on phones (Figma D1.18 352:1290; DEV NOTE 355:910): to review
 * (pending applications on the club's open roles, brand purple, opens
 * Opportunities) · profile views (last 7 days) · open roles. The title row
 * still opens Pulse; the role numbers open Opportunities.
 */
type Stat = WeekStat

const PHONE = '(max-width: 1023px)'

export function YourWeekCard() {
  const role = useAuthStore((s) => s.profile?.role)
  const isTalent = role === 'player' || role === 'coach'
  const isClub = role === 'club'
  const isPhone = useMediaQuery(PHONE)
  const clubV2 = isClub && isPhone

  const vis = useWeeklyVisibility(true, false)
  const opps = useOpportunitiesForYou(isTalent, role === 'coach' ? 'coach' : 'player')
  const apps = useMyApplications(isTalent)
  const roles = useRolesHealth(isClub)
  const scoped = useScopedMatches(isClub && !clubV2)

  const loading =
    vis.loading ||
    (isTalent && (opps.loading || apps.loading)) ||
    (isClub && (roles.loading || (!clubV2 && scoped.loading)))

  const views = vis.visibility?.views_7d ?? 0
  const matched = opps.mode === 'matched' ? opps.items.length : 0
  const replies = apps.applications.filter((a) => a.status !== 'pending').length
  const stats: Stat[] = clubV2
    ? clubWeekStats({ toReview: roles.totals.pending, views, openRoles: roles.totals.openRoles })
    : isTalent
    ? [
        { value: matched, label: matched === 1 ? 'role for you' : 'roles for you' },
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

  if (clubV2) {
    return (
      <div className="overflow-hidden rounded-[18px] bg-surface-grouped" data-testid="your-week-card">
        <Link to="/pulse" className="flex h-12 items-center justify-between pl-4 pr-3.5 active:bg-[#e9e9ef]" aria-label="Your week — open Pulse">
          <h2 className="text-body font-semibold text-ink-1">Your week</h2>
          <ChevronRight className="h-5 w-5 text-ink-3" strokeWidth={1.75} aria-hidden="true" />
        </Link>
        <div className="h-px bg-line" />
        <div className="flex items-stretch">
          {stats.map((s, i) => (
            <Link key={s.label} to={s.to ?? '/pulse'} className="relative flex min-w-0 flex-1 flex-col items-center gap-0.5 pb-2.5 pt-3.5 active:bg-[#e9e9ef]" data-testid={`your-week-${i}`}>
              {i > 0 && <span className="absolute left-0 top-1/2 h-[30px] w-px -translate-y-1/2 bg-line" aria-hidden="true" />}
              {loading ? (
                <div className="h-[31px] w-8 animate-pulse rounded-md bg-line" />
              ) : (
                <div className={cn('text-figure tabular-nums', s.accent && s.value > 0 ? 'text-hockia-primary' : 'text-ink-1')}>{s.value}</div>
              )}
              <div className="max-w-full truncate px-2 text-caption text-ink-2">{s.label}</div>
            </Link>
          ))}
        </div>
      </div>
    )
  }

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
              <div className="text-figure tabular-nums text-ink-1">{s.value}</div>
            )}
            <div className="max-w-full truncate px-2 text-caption text-ink-2">{s.label}</div>
          </div>
        ))}
      </div>
    </Link>
  )
}

