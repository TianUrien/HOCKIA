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
import { APPLICATION_TONE_CLASS, applicationStatusPill, roleHeadline } from '@/lib/opportunityCopy'

type Segment = 'active' | 'closed'

/**
 * My applications (rebrand page 20; was Figma 101:353, 115:1382). Where
 * "Applied · 3" lands. Each application is a card: crest 44, title, "Club ·
 * Country", the status chip + "Applied <day-first date>". Active | Archived
 * (the archived tab keeps the `closed` value for links). The tone comes from
 * lib/opportunityCopy applicationStatusPill (Shortlisted / offer / signed
 * positive; Replied, No reply · Nd, Not this time and Role closed grey — amber
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
  // `?segment=closed` lands on the Archived tab (the Pulse "expired with no reply" row).
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
    const headline = role?.title ?? 'Opportunity no longer available'
    const sub = [r.club?.name, r.country].filter(Boolean).join(' · ')
    const applied = dayFirst(r.appliedAt)
    // Card (rebrand page 20 · My applications): crest, title, club, then
    // the status chip and "Applied <day>". In review violet with a dot,
    // Shortlisted green, Not this time and other endings neutral grey.
    return (
      <li key={r.id} data-testid="application-row" data-tone={pill.tone}>
        <button
          type="button"
          onClick={() => r.title && navigate(`/opportunities/${r.opportunityId}`, { state: { from: location.pathname } })}
          className="flex w-full flex-col gap-3 rounded-[20px] border border-line bg-white p-4 text-left shadow-card active:bg-surface-subtle"
        >
          <span className="flex w-full items-center gap-3">
            <EntityAvatar src={r.club?.avatarUrl} name={r.club?.name} role={r.club?.role ?? 'club'} size={44} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-display text-[17px] font-bold leading-[22px] text-ink-1" data-testid="application-role-title">{headline}</span>
              {role?.detail && <span className="block truncate text-secondary text-ink-2">{role.detail}</span>}
              {sub && <span className="block truncate text-secondary text-ink-2">{sub}</span>}
            </span>
            {r.title && <ChevronRight className="h-[18px] w-[18px] shrink-0 text-ink-4" strokeWidth={1.6} data-testid="application-row-chevron" />}
          </span>
          {r.hasClubNote ? (
            <span className="flex w-full items-center gap-2 text-secondary" data-testid="club-note-line">
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-caption font-semibold ${APPLICATION_TONE_CLASS.grey}`}>Not this time</span>
              <span className="truncate font-semibold text-hockia-primary">Read the club’s note</span>
            </span>
          ) : (
            <span className="flex w-full items-center justify-between gap-2 text-secondary">
              <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-caption font-semibold ${APPLICATION_TONE_CLASS[pill.tone]}`} data-testid="application-status">
                {pill.tone === 'neutral' && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />}
                {pill.label}
              </span>
              {applied && <span className="truncate text-caption text-ink-3" data-testid="application-applied">Applied {applied}</span>}
            </span>
          )}
        </button>
      </li>
    )
  }

  return (
    <div className="min-h-screen bg-surface-subtle">
      <Header mobileHidden />
      <main className="mx-auto max-w-2xl pb-24 pt-[calc(env(safe-area-inset-top)+0.5rem)] lg:pt-24">
        <DetailNavBar parent={backLabelFrom(location.state, 'Opportunities')} title="My applications" fallbackPath="/opportunities" />
        <h1 className="hidden px-5 pb-2 text-title text-ink-1 lg:block">My applications</h1>

        <div className="px-5 pb-1.5 pt-2">
          <SegmentedControl<Segment>
            ariaLabel="Application status"
            value={segment}
            onChange={setSegment}
            options={[
              { value: 'active', label: 'Active', count: active.length },
              { value: 'closed', label: 'Archived', count: closed.length },
            ]}
          />
        </div>

        {loading ? (
          <div><ConversationSkeleton /><ConversationSkeleton /></div>
        ) : list.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="text-row font-semibold text-ink-1">{segment === 'active' ? 'No active applications' : 'Nothing archived yet'}</p>
            <p className="mt-1 text-secondary text-ink-2">
              {segment === 'active' ? 'Opportunities you apply to show up here with the club’s answer.' : 'Opportunities you weren’t selected for, and closed opportunities, keep their outcome here.'}
            </p>
            {segment === 'active' && (
              <button type="button" onClick={() => navigate('/opportunities')} className={buttonClassName({ variant: 'primary', size: 'large', radius: 'rounded-full', className: 'mt-4' })}>
                Browse open opportunities
              </button>
            )}
          </div>
        ) : (
          <ul className="flex flex-col gap-3 px-4 pt-2" data-testid="applications-list">
            {list.map(renderRow)}
          </ul>
        )}

        {segment === 'active' && waitingLongest?.club && (
          <div className="px-5 pt-5">
            <div className="rounded-card bg-surface-muted px-4 py-3.5" data-testid="no-reply-help">
              <p className="text-row font-semibold text-ink-1">No reply after two weeks?</p>
              <p className="mt-1 text-secondary text-ink-2">
                Send the club a message to ask where your application stands.
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
