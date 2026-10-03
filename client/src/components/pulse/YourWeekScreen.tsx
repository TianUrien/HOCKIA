import { useMemo } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/lib/auth'
import { useNotificationStore } from '@/lib/notifications'
import { useWeeklyVisibility } from '@/hooks/useWeeklyVisibility'
import { useMyApplications } from '@/hooks/useMyApplications'
import { useMyApplicationsAll } from '@/hooks/useMyApplicationsAll'
import { useTrustedReferences } from '@/hooks/useTrustedReferences'
import { useNewRolesThisWeek, useWeekViewers } from '@/hooks/useYourWeek'
import { DetailNavBar } from '@/components/ui/DetailNavBar'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { backLabelFrom } from '@/lib/backLabel'
import { getImageUrl } from '@/lib/imageUrl'
import {
  clubReplyLine,
  happenedTimeline,
  newRolesLine,
  recruitersLine,
  referenceArrivedThisWeek,
  viewersHeadline,
  viewsDeltaLine,
  weekRangeLabel,
} from '@/lib/pulseWeek'
import { CheckInCard } from './CheckInCard'
import { WeekTiles, type WeekTile } from './WeekTiles'
import { WhoLookedAtYou } from './WhoLookedAtYou'
import { WhatHappened } from './WhatHappened'

/**
 * Your week v2 — the player Pulse screen (Figma New-Hockia 42:276; founder
 * rulings 2026-10-03). Phone-first; what the Home "Your week" card opens.
 *
 *  1. Header: the Monday–Sunday week and one line about who looked.
 *  2. Check-in: the availability confirmation (CheckInCard).
 *  3. Four tiles: profile views · recruiters · new roles · club reply —
 *     the player's OWN numbers only.
 *  4. Who looked at you: clubs and coaches by name, anonymous browsers
 *     masked, players never listed.
 *  5. A first this week: the reference that arrived, with "Ask".
 *  6. What happened: the week's facts, every line neutral grey.
 *
 * Numbers are the rolling 7 days the Home card already shows (the RPCs
 * count 7 days back); the header names the calendar week for orientation.
 */
const REFERENCES_PATH = '/dashboard/profile?tab=references'

export function YourWeekScreen() {
  const location = useLocation()
  const profile = useAuthStore((s) => s.profile)
  const role = profile?.role ?? null
  const isTalent = role === 'player' || role === 'coach'
  const forRole = role === 'coach' ? 'coach' : 'player'

  const vis = useWeeklyVisibility(isTalent, false)
  const viewers = useWeekViewers(isTalent)
  const roles = useNewRolesThisWeek(isTalent, forRole, role === 'coach' ? profile?.coach_specialization : profile?.position)
  const apps = useMyApplications(isTalent)
  const allApps = useMyApplicationsAll()
  const refs = useTrustedReferences(profile?.id ?? '')
  const notifications = useNotificationStore((s) => s.notifications)

  const views = vis.visibility?.views_7d ?? 0
  const priorViews = vis.visibility?.views_prior_7d ?? 0
  const byRole = vis.visibility?.viewers_by_role ?? {}
  const clubs = byRole.club ?? 0
  const coaches = byRole.coach ?? 0
  const headline = viewersHeadline({ views, uniqueViewers: vis.visibility?.unique_viewers_7d ?? 0, clubs, coaches })

  const replies = useMemo(() => apps.applications.filter((a) => a.status !== 'pending'), [apps.applications])

  const titles = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of allApps.rows) if (r.title) m.set(r.opportunityId, r.title)
    return m
  }, [allApps.rows])
  const happened = useMemo(() => happenedTimeline(notifications, titles), [notifications, titles])

  const newReference = useMemo(() => referenceArrivedThisWeek(refs.acceptedReferences), [refs.acceptedReferences])

  const tiles: WeekTile[] = [
    { id: 'views', value: views, label: views === 1 ? 'Profile view' : 'Profile views', sub: viewsDeltaLine(views, priorViews) },
    { id: 'recruiters', value: clubs + coaches, label: clubs + coaches === 1 ? 'Recruiter' : 'Recruiters', sub: recruitersLine(clubs, coaches) },
    { id: 'roles', value: roles.roles.total, label: roles.roles.total === 1 ? 'New role' : 'New roles', sub: newRolesLine(roles.roles.forPosition, role === 'coach' ? profile?.coach_specialization : profile?.position), to: '/opportunities' },
    { id: 'replies', value: replies.length, label: replies.length === 1 ? 'Club reply' : 'Club replies', sub: clubReplyLine(replies.map((r) => r.club_name)), to: '/opportunities/applications' },
  ]
  const tilesLoading = vis.loading || roles.loading || apps.loading

  return (
    <div className="min-h-screen bg-white" data-testid="your-week-screen">
      <DetailNavBar parent={backLabelFrom(location.state, 'Home')} title="Your week" fallbackPath="/home" />

      <div className="mx-auto flex max-w-md flex-col gap-5 px-4 pb-8 pt-1">
        <header className="px-1">
          <p className="text-caption font-semibold uppercase tracking-[0.06em] text-ink-3" data-testid="week-range">{weekRangeLabel()}</p>
          {vis.loading ? (
            <span className="mt-1.5 block h-6 w-3/4 animate-pulse rounded-md bg-surface-grouped" />
          ) : (
            <h1 className="mt-1 text-title text-ink-1" data-testid="week-headline">{headline}</h1>
          )}
        </header>

        <CheckInCard />

        <WeekTiles tiles={tiles} loading={tilesLoading} />

        {!viewers.loading && views > 0 && <WhoLookedAtYou rows={viewers.viewers} />}

        {newReference && (
          <section aria-label="A first this week" className="rounded-card border border-gold-line bg-white p-4" data-testid="first-reference">
            <p className="text-caption font-semibold uppercase tracking-[0.06em] text-gold">{refs.acceptedCount === 1 ? 'A first this week' : 'New this week'}</p>
            <Link to={REFERENCES_PATH} className="mt-2 flex items-center gap-3">
              <EntityAvatar
                src={getImageUrl(newReference.profile?.avatarUrl, 'avatar-md') ?? newReference.profile?.avatarUrl}
                name={newReference.profile?.fullName}
                role={newReference.profile?.role}
                size={44}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-row font-semibold text-ink-1">
                  {newReference.profile?.fullName ? `${newReference.profile.fullName} wrote you a reference` : 'You received a reference'}
                </span>
                {newReference.endorsementText && <span className="block truncate text-secondary text-ink-2">“{newReference.endorsementText}”</span>}
              </span>
            </Link>
            <p className="mt-3 text-secondary text-ink-2">
              Teammates can write you a reference ·{' '}
              <Link to={REFERENCES_PATH} className="font-semibold text-hockia-primary">Ask</Link>
            </p>
          </section>
        )}

        <WhatHappened lines={happened} />
      </div>
    </div>
  )
}
