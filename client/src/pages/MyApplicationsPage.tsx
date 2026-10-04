import { useMemo, useState } from 'react'
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom'
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
import { buttonClassName } from '@/components/ui/buttonClasses'
import { dayFirst } from '@/lib/dayFirst'
import { APPLICATION_TONE_TEXT, applicationStatusPill, roleHeadline } from '@/lib/opportunityCopy'

type Segment = 'active' | 'closed'

/**
 * My applications (Figma 101:353, 115:1382). Where "Applied · 3" lands.
 * Rows are List item / Application (551:647): crest 52, title, "Club ·
 * Country", the status in words + "Applied <day-first date>", chevron. The
 * status is coloured text, not a pill, and its tone comes from
 * lib/opportunityCopy applicationStatusPill (Shortlisted / offer / signed
 * positive; Replied, No reply · Nd, Not selected and Role closed grey — amber
 * only when the viewer must act, and a waiting player cannot). The one piece
 * of advice is the one the data supports: clubs answer messages, so message
 * them.
 */
export default function MyApplicationsPage() {
  useScrollRestore()
  useDocumentTitle('My applications')
  const navigate = useNavigate()
  const location = useLocation()
  const { rows, loading } = useMyApplicationsAll()
  // `?segment=closed` lands on the Closed tab (the Pulse "expired with no reply" row).
  const [searchParams] = useSearchParams()
  const [segment, setSegment] = useState<Segment>(() => (searchParams.get('segment') === 'closed' ? 'closed' : 'active'))

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
    const applied = dayFirst(r.appliedAt)
    return (
      <li key={r.id} className="group" data-testid="application-row" data-tone={pill.tone}>
        <button
          type="button"
          onClick={() => r.title && navigate(`/opportunities/${r.opportunityId}`, { state: { from: location.pathname } })}
          className="flex w-full items-center gap-3 pl-4 text-left active:bg-surface-muted"
        >
          <EntityAvatar src={r.club?.avatarUrl} name={r.club?.name} role={r.club?.role ?? 'club'} size={52} />
          <span className="flex min-w-0 flex-1 items-center gap-2 border-b border-line py-3 pr-3 group-last:border-b-0">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[16px] font-semibold leading-[21px] text-ink-1" data-testid="application-role-title">{headline}</span>
            {role?.detail && <span className="block truncate text-secondary text-ink-2">{role.detail}</span>}
            {sub && <span className="block truncate text-secondary text-ink-2">{sub}</span>}
            {r.hasClubNote ? (
              <span className="mt-1 block truncate text-secondary text-ink-2" data-testid="club-note-line">
                Not selected · <span className="font-semibold text-hockia-primary">Read the club’s note</span>
              </span>
            ) : (
              <span className="mt-1 flex items-baseline gap-2 text-secondary">
                <span className={`shrink-0 font-semibold ${APPLICATION_TONE_TEXT[pill.tone]}`} data-testid="application-status">{pill.label}</span>
                {applied && <span className="truncate text-ink-3" data-testid="application-applied">Applied {applied}</span>}
              </span>
            )}
          </span>
          {r.title && <ChevronRight className="h-[18px] w-[18px] shrink-0 text-ink-4" strokeWidth={1.6} data-testid="application-row-chevron" />}
          </span>
        </button>
      </li>
    )
  }

  return (
    <div className="min-h-screen bg-white">
      <Header mobileHidden />
      <main className="mx-auto max-w-2xl pb-24 pt-[env(safe-area-inset-top)] lg:pt-24">
        <DetailNavBar parent={backLabelFrom(location.state, 'Opportunities')} title="My applications" fallbackPath="/opportunities" />
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
              <button type="button" onClick={() => navigate('/opportunities')} className={buttonClassName({ variant: 'primary', size: 'large', radius: 'rounded-full', className: 'mt-4' })}>
                Browse open roles
              </button>
            )}
          </div>
        ) : (
          // Inset dividers: the hairline sits under the text column, so it
          // starts at the text and every chevron shares one right edge.
          <ul data-testid="applications-list">
            {list.map(renderRow)}
          </ul>
        )}

        {segment === 'active' && waitingLongest?.club && (
          <div className="px-5 pt-5">
            <div className="rounded-card bg-surface-muted px-4 py-3.5" data-testid="no-reply-help">
              <p className="text-row font-semibold text-ink-1">No reply after two weeks?</p>
              <p className="mt-1 text-secondary text-ink-2">
                Send the club a message. Clubs answer messages far more often than they update applications — and a full match video is the thing they ask for most.
              </p>
              {/* Link button (Figma Button, Style: Link, Small): brand text, no chevron. */}
              <button
                type="button"
                onClick={() => navigate(`/messages?new=${waitingLongest.club!.id}`, { state: { from: location.pathname } })}
                className={buttonClassName({ variant: 'link', size: 'small', className: 'mt-1 !px-0' })}
                data-testid="no-reply-message-link"
              >
                Message {waitingLongest.club.name}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
