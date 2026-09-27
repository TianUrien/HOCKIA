import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Briefcase, Calendar, ChevronRight, Clock, DollarSign, Info, Plus, Star, Users } from 'lucide-react'
import { LargeTitleBar } from '@/components/ui/LargeTitleBar'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { useAuthStore } from '@/lib/auth'
import { useRoleShortlist, useScoutingContext } from '@/hooks/useScouting'
import { useRecruitingViewKind } from '@/hooks/useRecruitingContext'
import { useClubRoles, type ClubRole } from '@/hooks/useClubRoles'
import { formatDurationText, genderPill, isPaid, roleBenefits, rolePostedAt, roleTitle } from '@/lib/opportunityCopy'
import { waitingNotice } from '@/lib/clubRecruiting'
import { isFirstRunOpportunities } from '@/lib/clubEdit'
import { cn } from '@/lib/utils'
import { RoleActions } from './RoleActions'


/**
 * The club's Opportunities tab (Figma 04 Club · Opportunities — club v2,
 * 324:264; DEV NOTE 327:547). Open / Closed roles; an amber notice only when
 * applications are waiting (time-sensitive: the oldest closes after
 * expiry_days); each role card carries its pipeline, the grey count of
 * applications that closed without a reply, and "Review N applicants".
 * Applicant counts live here, on the club's own surface only.
 */
type Segment = 'open' | 'closed'

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthDay = (iso: string | null | undefined) => {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : `${MONTH[d.getMonth()]} ${d.getDate()}`
}

function whenLine(r: ClubRole): string {
  const from = r.start_date ? `From ${monthDay(r.start_date)}` : 'Starts immediately'
  return [from, formatDurationText(r.duration_text), r.location_city?.trim() || null].filter(Boolean).join(' · ')
}

function closedLabel(r: ClubRole): string {
  if (r.closed_reason === 'filled') return r.filled_via_hockia ? 'Filled through Hockia' : 'Filled'
  if (r.closed_reason === 'withdrawn') return 'Closed without hiring'
  return 'Closed'
}

/** A saved draft (Post a role · Save draft): title, what's set so far, Continue. */
function DraftCard({ role, onContinue }: { role: ClubRole; onContinue: () => void }) {
  const pill = genderPill(role.gender)
  return (
    <article className="flex flex-col gap-3 rounded-[18px] border border-line bg-white p-4" data-testid="club-draft-card">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-secondary font-semibold text-ink-2">{role.title}</span>
        <span className="shrink-0 rounded-full bg-surface-grouped px-2 py-0.5 text-caption font-semibold text-ink-2">Draft</span>
      </div>
      <div className="flex items-center gap-2">
        <h3 className="text-[22px] font-bold leading-7 tracking-[-0.11px] text-ink-1">{roleTitle(role)}</h3>
        {pill && <span className={cn('rounded-full px-2 py-0.5 text-secondary font-semibold', pill.className)}>{pill.label}</span>}
      </div>
      <p className="text-[14px] leading-[19px] text-ink-2">Only you can see this. Post it when it’s ready.</p>
      <button type="button" onClick={onContinue} className="flex h-11 items-center justify-center rounded-full bg-surface-grouped text-row font-semibold text-ink-1">
        Continue
      </button>
    </article>
  )
}

function RoleCard({ role, expiryDays, onReview, onChanged }: { role: ClubRole; expiryDays: number; onReview: () => void; onChanged: () => void }) {
  const pill = genderPill(role.gender)
  const benefits = roleBenefits(role)
  const paid = isPaid(role)
  const p = role.pipeline
  const open = role.status === 'open'
  const stat = (value: number, label: string, accent = false) => (
    <div className="flex flex-1 flex-col items-start">
      <span className={cn('text-[22px] font-bold leading-7 tabular-nums', accent && value > 0 ? 'text-hockia-primary' : 'text-ink-1')}>{value}</span>
      <span className="text-caption text-ink-2">{label}</span>
    </div>
  )
  return (
    <article className="flex flex-col gap-3 rounded-[18px] border border-line bg-white p-4" data-testid="club-role-card">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-secondary font-semibold text-ink-2">{role.title}</span>
        <span className="flex shrink-0 items-center gap-1 text-secondary text-ink-3">
          <Clock className="h-3.5 w-3.5" strokeWidth={2} /> {open ? `Posted ${monthDay(rolePostedAt(role))}` : closedLabel(role)}
          <RoleActions role={role} onChanged={onChanged} />
        </span>
      </div>
      <div className="flex items-center gap-2">
        <h3 className="text-[22px] font-bold leading-7 tracking-[-0.11px] text-ink-1">{roleTitle(role)}</h3>
        {pill && <span className={cn('rounded-full px-2 py-0.5 text-secondary font-semibold', pill.className)}>{pill.label}</span>}
      </div>
      <p className="flex items-center gap-1.5 text-[14px] leading-[19px] text-ink-2">
        <Calendar className="h-4 w-4 shrink-0" strokeWidth={1.8} /> {whenLine(role)}
      </p>
      {(paid || benefits.length > 0) && (
        <div className="flex flex-wrap gap-x-3.5 gap-y-2">
          {paid && (
            <span className="flex items-center gap-[7px] text-[14px] font-medium text-ink-1">
              <span className="flex h-[22px] w-[22px] items-center justify-center rounded-[7px] bg-positive-soft text-positive"><DollarSign className="h-3.5 w-3.5" strokeWidth={2} /></span>
              Paid
            </span>
          )}
          {benefits.map((b) => {
            const Icon = b.icon
            return (
              <span key={b.key} className="flex items-center gap-[7px] text-[14px] font-medium text-ink-1">
                <span className={cn('flex h-[22px] w-[22px] items-center justify-center rounded-[7px]', b.tileClass)}><Icon className="h-3.5 w-3.5" strokeWidth={2} /></span>
                {b.label}
              </span>
            )
          })}
        </div>
      )}
      <div className="h-[0.5px] bg-line" />
      <button type="button" onClick={onReview} className="flex gap-2 text-left" aria-label="Open applicants">
        {stat(p.toReview, 'To review', true)}
        {stat(p.shortlisted, 'Shortlisted')}
        {stat(p.declined, 'Declined')}
      </button>
      {p.closed > 0 && (
        <p className="flex items-center gap-1.5 text-caption text-ink-3">
          <Info className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          {p.closed} more closed without a reply after {expiryDays} days
        </p>
      )}
      <button type="button" onClick={onReview} className={cn('flex h-11 items-center justify-center rounded-full text-row font-semibold', p.toReview > 0 ? 'bg-hockia-primary text-white' : 'bg-surface-grouped text-ink-1')}>
        {p.toReview > 0 ? `Review ${p.toReview} applicant${p.toReview === 1 ? '' : 's'}` : p.total > 0 ? 'View applicants' : 'No applicants yet'}
      </button>
    </article>
  )
}

/**
 * First run (Figma 04 Club D1.25, DEV NOTE 368:1093): a club with no roles
 * yet. One clear action, Post a role, and a way to start scouting before
 * posting. No segmented control, no waiting notice, no counters.
 */
function FirstRunOpportunities({ onPostRole, onFindPlayers }: { onPostRole: () => void; onFindPlayers: () => void }) {
  return (
    <div className="flex flex-col px-5" data-testid="club-opportunities-first-run">
      <section className="mt-2 flex flex-col items-center rounded-[20px] bg-surface-grouped px-6 pb-6 pt-6 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-hockia-soft text-hockia-primary">
          <Briefcase className="h-7 w-7" strokeWidth={1.8} />
        </span>
        <h2 className="mt-2.5 text-[20px] font-semibold leading-[25px] tracking-[-0.2px] text-ink-1">Post your first role</h2>
        <p className="mt-2.5 text-[15px] leading-[21px] text-ink-2">Describe the role once. Players who fit find it in Opportunities and apply straight to you, and you review everyone here.</p>
        <button type="button" onClick={onPostRole} className="mt-4 flex h-12 w-full items-center justify-center rounded-full bg-hockia-primary text-row font-semibold text-white">
          Post a role
        </button>
      </section>
      <p className="mt-3 px-1 pb-2 text-secondary text-ink-2">Not ready to post? Find players and shortlist them first.</p>
      <div className="mt-3 overflow-hidden rounded-2xl bg-surface-grouped">
        <button type="button" onClick={onFindPlayers} className="flex h-[52px] w-full items-center gap-3 pl-3.5 pr-2.5 text-left">
          <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-hockia-soft text-hockia-primary"><Users className="h-[18px] w-[18px]" strokeWidth={2} /></span>
          <span className="flex-1 text-[16px] font-medium text-ink-1">Find players now</span>
          <ChevronRight className="h-[18px] w-[18px] text-ink-4" strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}

export default function ClubOpportunitiesScreen() {
  const navigate = useNavigate()
  const profile = useAuthStore((s) => s.profile)
  const data = useClubRoles(profile?.id)
  const [segment, setSegment] = useState<Segment>('open')
  const location = useLocation()
  const highlight = (location.state as { highlight?: string } | null)?.highlight ?? null
  // Land on Opportunities with the role just posted or saved on top (DEV NOTE 330:781).
  const roles = useMemo(() => {
    const list = segment === 'open' ? data.open : data.closed
    if (!highlight) return list
    const hit = list.find((r) => r.id === highlight)
    return hit ? [hit, ...list.filter((r) => r.id !== highlight)] : list
  }, [segment, data.open, data.closed, highlight])
  const postRole = () => navigate('/dashboard/opportunities/new')
  // "Open · N" counts published open roles only — drafts are listed under Open
  // but aren't open (same number as desktop's "Published").
  const publishedOpen = data.open.filter((r) => r.status === 'open').length
  // "Shortlist · N" = the list for the ACTIVE role (the one Shortlist opens on;
  // with no context, the no-context list) — same hook, same number.
  // Only PLAYER roles rank players here (round 6): a coach-role context
  // stays stored for the Coaches tab.
  useRecruitingViewKind('player')
  const scouting = useScoutingContext()
  const scoutRoleId = scouting.ctx?.type === 'opportunity' ? scouting.ctx.opportunity_id : null
  const activeShortlist = useRoleShortlist(scouting.ctx, scoutRoleId, scouting.roleTitle)
  // Find players, ranked for this role (DEV NOTE 327:554): with one open player role, that role.
  const playerRoles = data.open.filter((r) => r.status === 'open' && r.opportunity_type === 'player')
  const findPlayersPath = playerRoles.length === 1 ? `/dashboard/find-players?role=${playerRoles[0].id}` : '/dashboard/find-players'

  const pending = useMemo(() => data.open.flatMap((r) => r.pendingAppliedAt), [data.open])
  const notice = waitingNotice(pending, data.expiryDays)
  const rolesWithPending = data.open.filter((r) => r.pipeline.toReview > 0)
  const applicantsPath = (id: string) => `/dashboard/opportunities/${id}/applicants`
  const openNotice = () => {
    if (rolesWithPending.length === 1) navigate(applicantsPath(rolesWithPending[0].id), { state: { from: '/opportunities' } })
    else setSegment('open')
  }

  const firstRun = isFirstRunOpportunities(data.loading, data.open, data.closed)

  return (
    <div className="min-h-screen bg-white pb-28 lg:hidden" data-testid="club-opportunities-screen">
      <LargeTitleBar
        title="Opportunities"
        trailing={(
          <button type="button" onClick={postRole} aria-label="Post a role" className="flex h-11 w-11 items-center justify-center text-ink-1">
            <Plus className="h-6 w-6" strokeWidth={2} />
          </button>
        )}
      />
      {firstRun ? (
        // Find players now opens Find players with "No context" active.
        <FirstRunOpportunities onPostRole={postRole} onFindPlayers={() => navigate('/dashboard/find-players?context=none')} />
      ) : (
      <>
      <div className="px-5 pb-3.5 pt-1">
        <SegmentedControl<Segment>
          ariaLabel="Role status"
          value={segment}
          onChange={setSegment}
          options={[{ value: 'open', label: 'Open', count: publishedOpen }, { value: 'closed', label: 'Closed', count: data.closed.length }]}
        />
      </div>

      {segment === 'open' && notice && (
        <div className="px-5 pb-3.5">
          <button type="button" onClick={openNotice} className="flex w-full items-center gap-3 rounded-2xl bg-[#fdf1e4] py-3 pl-3.5 pr-2.5 text-left" data-testid="club-waiting-notice">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-white text-[#b45309]"><Clock className="h-5 w-5" strokeWidth={2} /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-row font-semibold text-ink-1">{notice.title}</span>
              {notice.detail && <span className="block text-secondary text-[#b45309]">{notice.detail}</span>}
            </span>
            <ChevronRight className="h-[18px] w-[18px] shrink-0 text-[#b45309]" strokeWidth={2} />
          </button>
        </div>
      )}

      <div className="flex flex-col gap-3 px-5">
        {!data.loading && roles.length === 0 && (
          segment === 'open' ? (
            <button type="button" onClick={postRole} className="flex h-[52px] w-full items-center justify-between rounded-card bg-surface-grouped px-4 text-row text-ink-2">
              Post a role <Plus className="h-4 w-4 text-hockia-primary" strokeWidth={2.2} />
            </button>
          ) : <p className="py-2 text-row text-ink-3">No closed roles yet.</p>
        )}
        {roles.map((r) => (r.status === 'draft'
          ? <DraftCard key={r.id} role={r} onContinue={() => navigate(`/dashboard/opportunities/${r.id}/edit`)} />
          : <RoleCard key={r.id} role={r} expiryDays={data.expiryDays} onReview={() => navigate(applicantsPath(r.id), { state: { from: '/opportunities' } })} onChanged={data.refresh} />
        ))}

        {segment === 'open' && (
          <div className="overflow-hidden rounded-2xl bg-surface-grouped" data-testid="club-scouting-group">
            <button type="button" onClick={() => navigate(findPlayersPath)} className="flex h-[52px] w-full items-center gap-3 pl-3.5 pr-2.5 text-left">
              <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-hockia-soft text-hockia-primary"><Users className="h-[18px] w-[18px]" strokeWidth={2} /></span>
              <span className="flex-1 text-[16px] font-medium text-ink-1">Find players for this role</span>
              <ChevronRight className="h-[18px] w-[18px] text-ink-4" strokeWidth={2} />
            </button>
            <div className="ml-[58px] h-[0.5px] bg-line" />
            <button type="button" onClick={() => navigate('/dashboard/shortlist', { state: { parent: 'Opportunities' } })} className="flex h-[52px] w-full items-center gap-3 pl-3.5 pr-2.5 text-left">
              <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-hockia-soft text-hockia-primary"><Star className="h-[18px] w-[18px]" strokeWidth={2} /></span>
              <span className="flex-1 text-[16px] font-medium text-ink-1">Shortlist</span>
              <span className="text-[16px] text-ink-2 tabular-nums" data-testid="club-shortlist-count">{activeShortlist.loading ? '' : activeShortlist.rows.length}</span>
              <ChevronRight className="h-[18px] w-[18px] text-ink-4" strokeWidth={2} />
            </button>
          </div>
        )}
      </div>

      </>
      )}
    </div>
  )
}
