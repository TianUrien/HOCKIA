import { useMemo, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { Header } from '@/components'
import { DetailNavBar } from '@/components/ui/DetailNavBar'
import { backLabelFrom } from '@/lib/backLabel'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { ConversationSkeleton } from '@/components/Skeleton'
import { useMyApplicationsAll, type MyApplicationRow } from '@/hooks/useMyApplicationsAll'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { useScrollRestore } from '@/hooks/useScrollRestore'
import { APPLICATION_TONE_CLASS, appliedLine, applicationStatusPill, roleHeadline } from '@/lib/opportunityCopy'

type Segment = 'active' | 'closed'

/**
 * My applications (Figma 101:353, 115:1382). Where "Applied · 3" lands.
 * "No reply · 16d" is a real status; it and closed outcomes keep their words
 * in grey (amber only when the viewer must act). The one piece of advice is the one the data supports:
 * clubs answer messages, so message them.
 */
export default function MyApplicationsPage() {
  useScrollRestore()
  useDocumentTitle('My applications')
  const navigate = useNavigate()
  const location = useLocation()
  const { rows, loading } = useMyApplicationsAll()
  const [segment, setSegment] = useState<Segment>('active')

  const active = useMemo(() => rows.filter((r) => r.active), [rows])
  const closed = useMemo(() => rows.filter((r) => !r.active), [rows])
  const list = segment === 'active' ? active : closed
  const waitingLongest = active.find((r) => r.status === 'pending' && applicationStatusPill(r.status, r.appliedAt, r.roleOpen).waitingLong === true)

  const renderRow = (r: MyApplicationRow) => {
    const pill = applicationStatusPill(r.status, r.appliedAt, r.roleOpen)
    // Title first, then position · team (the role title was missing, so two
    // roles for the same position read identically).
    const role = r.title ? roleHeadline({ position: r.position, title: r.title, opportunity_type: r.opportunityType ?? 'player', gender: r.gender }) : null
    const headline = role?.title ?? 'Role no longer available'
    const sub = [r.club?.name, r.country].filter(Boolean).join(' · ')
    return (
      <li key={r.id}>
        <button
          type="button"
          onClick={() => r.title && navigate(`/opportunities/${r.opportunityId}`, { state: { from: location.pathname } })}
          className="flex w-full items-center gap-3 px-5 py-3 text-left active:bg-surface-muted"
        >
          <EntityAvatar src={r.club?.avatarUrl} name={r.club?.name} role={r.club?.role ?? 'club'} size={52} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-row font-semibold text-ink-1" data-testid="application-role-title">{headline}</span>
            {role?.detail && <span className="block truncate text-secondary text-ink-2">{role.detail}</span>}
            {sub && <span className="block truncate text-secondary text-ink-2">{sub}</span>}
            {r.hasClubNote ? (
              <span className="mt-1 block text-secondary text-ink-2" data-testid="club-note-line">
                Not selected · <span className="font-semibold text-hockia-primary">Read the club’s note</span>
              </span>
            ) : (
              <span className="mt-1 flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-caption font-semibold ${APPLICATION_TONE_CLASS[pill.tone]}`}>{pill.label}</span>
                <span className="text-caption text-ink-3">{appliedLine(r.appliedAt)}</span>
              </span>
            )}
          </span>
          {r.title && <ChevronRight className="h-[18px] w-[18px] shrink-0 text-ink-4" strokeWidth={1.6} />}
        </button>
      </li>
    )
  }

  return (
    <div className="min-h-screen bg-white">
      <Header mobileHidden />
      <main className="mx-auto max-w-2xl pb-24 pt-[env(safe-area-inset-top)] lg:pt-24">
        <DetailNavBar parent={backLabelFrom(location.state, 'Opportunities')} title="My applications" showParent wideParent fallbackPath="/opportunities" />
        <h1 className="hidden px-5 pb-2 text-title text-ink-1 lg:block">My applications</h1>

        <div className="px-5 pb-1.5 pt-2">
          <SegmentedControl<Segment>
            ariaLabel="Application status"
            value={segment}
            onChange={setSegment}
            options={[
              { value: 'active', label: 'Active', count: active.length },
              { value: 'closed', label: 'Closed', count: closed.length },
            ]}
          />
        </div>

        {loading ? (
          <div><ConversationSkeleton /><ConversationSkeleton /></div>
        ) : list.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="text-row font-semibold text-ink-1">{segment === 'active' ? 'No active applications' : 'Nothing closed yet'}</p>
            <p className="mt-1 text-secondary text-ink-2">
              {segment === 'active' ? 'Roles you apply to show up here with the club’s answer.' : 'Roles you weren’t selected for, and closed roles, keep their outcome here.'}
            </p>
            {segment === 'active' && (
              <button type="button" onClick={() => navigate('/opportunities')} className="mt-4 rounded-full bg-hockia-primary px-5 py-2.5 text-row font-semibold text-white">
                Browse open roles
              </button>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-line [&>li+li]:ml-[84px] [&>li+li]:pl-0 [&>li+li>button]:-ml-[84px]">
            {list.map(renderRow)}
          </ul>
        )}

        {segment === 'active' && waitingLongest?.club && (
          <div className="px-5 pt-5">
            <div className="rounded-card bg-surface-grouped px-4 py-3.5">
              <p className="text-row font-semibold text-ink-1">No reply after two weeks?</p>
              <p className="mt-1 text-secondary text-ink-2">
                Send the club a message. Clubs answer messages far more often than they update applications — and a full match video is the thing they ask for most.
              </p>
              <button
                type="button"
                onClick={() => navigate(`/messages?new=${waitingLongest.club!.id}`, { state: { from: location.pathname } })}
                className="mt-2 flex items-center gap-1 text-row font-semibold text-hockia-primary"
              >
                Message {waitingLongest.club.name} <ChevronRight className="h-4 w-4" strokeWidth={2} />
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
