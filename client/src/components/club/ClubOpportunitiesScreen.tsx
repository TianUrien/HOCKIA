import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ChevronRight, Info, Plus } from 'lucide-react'
import { CATEGORY_DOT_CLASSES, categoryFamily } from '@/lib/opportunityCopy'
import { GlassChip, RoleCover } from '@/components/opportunities/RoleCover'
import { useOwnerCrest, type OwnerCrest } from '@/hooks/useOwnerCrest'
import { usePressSpring } from '@/hooks/usePressSpring'
import { LargeTitleBar } from '@/components/ui/LargeTitleBar'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { useAuthStore } from '@/lib/auth'
import { useRoleShortlist, useScoutingContext } from '@/hooks/useScouting'
import { useRecruitingViewKind } from '@/hooks/useRecruitingContext'
import { useClubRoles, type ClubRole, type ClubRolesData } from '@/hooks/useClubRoles'
import { formatDurationText, genderPill, rolePostedAt, roleTitle } from '@/lib/opportunityCopy'
import { closedBreakdown, waitingNotice } from '@/lib/clubRecruiting'
import { shortDayOf } from '@/lib/signing'
import { isFirstRunOpportunities } from '@/lib/clubEdit'
import { cn } from '@/lib/utils'
import { RoleActions } from './RoleActions'
import { PostRoleStartSheet } from './PostRoleStartSheet'
import { useYourReplies } from '@/hooks/useYourReplies'
import { yourRepliesCopy } from '@/lib/yourReplies'
import { ClubRoleCardSkeleton } from '@/components/ScreenSkeletons'


/**
 * The club's Opportunities tab (Figma 04 Club · Opportunities — club v2,
 * 324:264; DEV NOTE 327:547). Open / Closed roles; an amber notice only when
 * applications are waiting (time-sensitive: the oldest closes after
 * expiry_days); each role card carries its pipeline, the grey count of
 * applications that closed without a reply, and "Review N applicants".
 * Applicant counts live here, on the club's own surface only.
 */
type Segment = 'open' | 'closed'

// Dates read day first app-wide ("2 Oct"), the one format the signing road uses.
const monthDay = (iso: string | null | undefined) => shortDayOf(iso)

function whenLine(r: ClubRole): string {
  const from = r.start_date ? `Starts ${monthDay(r.start_date)}` : 'Starts immediately'
  return [from, formatDurationText(r.duration_text)].filter(Boolean).join(' · ')
}

function closedLabel(r: ClubRole): { label: string; tone: 'positive' | 'grey' } {
  if (r.closed_reason === 'filled') return r.filled_via_hockia ? { label: 'Filled through Hockia', tone: 'positive' } : { label: 'Filled', tone: 'grey' }
  if (r.closed_reason === 'withdrawn') return { label: 'Closed without hiring', tone: 'grey' }
  return { label: 'Closed', tone: 'grey' }
}

/** Draft card (Figma O5 162:542): dashed outline, Draft pill, the title, Continue. */
function DraftCard({ role, onContinue }: { role: ClubRole; onContinue: () => void }) {
  return (
    <article className="flex flex-col gap-1.5 self-start rounded-[24px] border border-dashed border-line px-4 py-3.5" data-testid="club-draft-card">
      <div className="flex items-center gap-2">
        <span className="shrink-0 rounded-full bg-surface-muted px-2 py-[3px] text-caption font-semibold text-ink-2">Draft</span>
        <h3 className="min-w-0 flex-1 truncate text-[16px] font-semibold leading-[21px] text-ink-1">{roleTitle(role)}</h3>
        <button type="button" onClick={onContinue} className="shrink-0 text-[16px] font-semibold leading-[21px] text-brand-primary">Continue</button>
      </div>
      <p className="text-secondary text-ink-2">Only you can see this. Post it when it’s ready.</p>
    </article>
  )
}

/**
 * Role card (Figma O5 162:486 / O5b 166:654): an 88 pt cover band in the
 * club's colours with the category chip and the "…" actions, the title, a
 * meta line, three big pipeline figures (To review in brand when > 0), the
 * grey closed-without-reply note and "Review N applicants" — Primary while
 * a reply is owed, quiet otherwise. Closed roles lead with their outcome
 * pill ("Filled through Hockia" positive, the rest neutral).
 */
function RoleCard({ role, expiryDays, cover, onReview, onChanged, onEdit, onPostAgain }: { role: ClubRole; expiryDays: number; cover: OwnerCrest; onReview: () => void; onChanged: () => void; onEdit?: () => void; onPostAgain?: () => void }) {
  const press = usePressSpring<HTMLButtonElement>()
  const pill = genderPill(role.gender)
  const family = categoryFamily(role.gender)
  const p = role.pipeline
  const open = role.status === 'open'
  const outcome = open ? null : closedLabel(role)
  const meta = [
    `Posted ${monthDay(rolePostedAt(role))}`,
    open ? whenLine(role) : role.closed_at ? `Closed ${monthDay(role.closed_at)}` : null,
    role.location_city?.trim() || null,
  ].filter(Boolean).join(' · ')
  const stat = (value: number, label: string, accent = false) => {
    const lit = accent && value > 0
    return (
      <div className={cn('flex flex-1 flex-col items-start rounded-[12px] py-2.5 pl-3', lit ? 'bg-brand-soft text-brand-primary' : 'bg-surface-subtle')}>
        <span className={cn('text-figure tabular-nums', lit ? 'text-brand-primary' : 'text-ink-1')}>{value}</span>
        <span className={cn('text-caption', lit ? 'text-brand-primary' : 'text-ink-2')}>{label}</span>
      </div>
    )
  }
  const reviewLabel = open && p.toReview > 0 ? `Review ${p.toReview} applicant${p.toReview === 1 ? '' : 's'}` : p.total > 0 ? 'View applicants' : 'No applicants yet'
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-[24px] border border-line bg-white shadow-[0_4px_16px_rgba(0,0,0,0.05)] lg:transition-[transform,box-shadow] lg:duration-200 lg:hover:-translate-y-0.5 lg:hover:shadow-[0_12px_24px_rgba(15,15,20,0.1)]" data-testid="club-role-card" data-status={role.status}>
      <RoleCover coverUrl={role.cover_url} crestUrl={cover.crestUrl} palette={cover.palette} scrim="band" className="h-[88px]">
        {pill && family && <span className="absolute left-3 top-3"><GlassChip dotClass={CATEGORY_DOT_CLASSES[family]}>{pill.label}</GlassChip></span>}
        <span className="absolute right-2.5 top-2.5 flex h-8 w-8 items-center justify-center rounded-full text-white backdrop-blur-[8px]" style={{ backgroundColor: 'rgba(0,0,0,0.32)' }}>
          <RoleActions role={role} onChanged={onChanged} onEdit={onEdit} onPostAgain={onPostAgain} className="flex h-8 w-8 items-center justify-center rounded-full text-white" />
        </span>
      </RoleCover>
      <div className="flex flex-1 flex-col gap-1 px-4 pb-4 pt-3.5">
        {outcome && (
          <span className={cn('mb-1 self-start rounded-full px-2.5 py-[3px] text-caption font-semibold', outcome.tone === 'positive' ? 'bg-positive-soft text-positive' : 'bg-surface-muted text-ink-2')} data-testid="club-role-outcome">{outcome.label}</span>
        )}
        <h3 className="text-body font-semibold text-ink-1">{roleTitle(role)}</h3>
        <p className="text-secondary text-ink-2">{meta}</p>
        <button type="button" onClick={onReview} className="flex gap-2 pt-3 text-left" aria-label="Open applicants">
          {stat(p.toReview, 'To review', open)}
          {stat(p.shortlisted, 'Shortlisted')}
          {stat(p.declined, 'Not a fit')}
        </button>
        {closedBreakdown(p, expiryDays) && (
          <p className="flex items-center gap-1.5 pt-1 text-caption text-ink-3" data-testid="role-closed-breakdown">
            <Info className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
            {closedBreakdown(p, expiryDays)}
          </p>
        )}
        <span aria-hidden="true" className="h-3 shrink-0" />
        {/* Primary only while this role owes a reply (Figma O5); quiet otherwise. */}
        <button ref={press.ref} type="button" onClick={onReview} {...press.handlers} data-testid="role-review-button" className={cn('mt-auto flex h-11 items-center justify-center rounded-full text-[16px] font-semibold leading-[21px] [transform-origin:center]', open && p.toReview > 0 ? 'bg-brand-primary text-white' : 'bg-surface-subtle text-ink-1')}>
          {reviewLabel}
        </button>
      </div>
    </article>
  )
}

/**
 * First run (Figma 04 Club D1.25, DEV NOTE 368:1093): a club with no roles
 * yet. One clear action, Post a role, and a way to start scouting before
 * posting. No segmented control, no waiting notice, no counters.
 */
function FirstRunOpportunities({ cover, onPostRole, onFindPlayers }: { cover: OwnerCrest; onPostRole: () => void; onFindPlayers: () => void }) {
  return (
    <div className="flex flex-col px-4" data-testid="club-opportunities-first-run">
      {/* Figma O8 164:663: a cover in the club's colours shows what a posted role will look like. */}
      <RoleCover crestUrl={cover.crestUrl} palette={cover.palette} scrim="none" className="mt-2 h-[196px] rounded-[24px]">
        <span aria-hidden="true" className="absolute bottom-8 left-4 h-4 w-[170px] rounded-full bg-white/60" />
        <span aria-hidden="true" className="absolute bottom-[14px] left-4 h-3 w-[110px] rounded-full bg-white/45" />
      </RoleCover>
      <h2 className="mt-6 text-title text-ink-1">Post your first opportunity</h2>
      <p className="mt-2 text-[16px] leading-[22px] text-ink-2">Describe the opportunity once. Players who fit find it in Opportunities and apply straight to you, and you review everyone here.</p>
      <button type="button" onClick={onPostRole} className="mt-5 flex h-[52px] w-full items-center justify-center rounded-full bg-brand-primary text-[16px] font-semibold text-white">
        Post an opportunity
      </button>
      <p className="mt-4 text-center text-secondary text-ink-2">Not ready to post? Find players and shortlist them first.</p>
      <button type="button" onClick={onFindPlayers} className="mt-2 h-11 text-[16px] font-semibold text-brand-primary">Find players now</button>
    </div>
  )
}

/**
 * The recruiter's roles — everything under the title on the club's
 * Opportunities tab: Open / Closed, the amber waiting notice, the role cards
 * with their pipeline and "Review N applicants", then Find players and
 * Shortlist. The owner is whoever posted the roles: a club, or a coach who
 * recruits for their team (Coach v2 · My roles, Figma D6.4 377:1814 — "the
 * Club v2 component with owner = coach"). The host passes the owner's roles
 * and decides where posting and editing go; nothing here reads the role.
 */
export interface RecruiterRolesProps {
  data: ClubRolesData
  /** Post a role (the "+" lives in the host's header). */
  onPostRole: () => void
  /** Continue a draft / edit a role. Default: the club's phone editor. */
  onEditRole?: (role: ClubRole) => void
  /** Club speed CS3 · Post again from a closed role. Default: a club on its phone opens Post a role prefilled. */
  onPostAgainRole?: (role: ClubRole) => void
  /** Where the applicant screens return to. */
  from?: string
  /** 'always' = the club tab; 'when-closed' = only once a closed role exists
   *  (Coach v2 · My roles sits under the page's own segmented control). */
  statusSegment?: 'always' | 'when-closed'
  /** Parent label the Shortlist screen's back button names. */
  parentLabel?: string
  /** 'desktop' = Figma D3 195:889: a header row (title + subtitle, Open|Closed,
   *  "+ Post a role" Primary), full-width waiting notice, role cards three
   *  across (two under 1200) with the draft in the grid, scouting rows below. */
  layout?: 'phone' | 'desktop'
  /** Desktop header copy (title defaults to "Opportunities"; null = controls only, the host owns the title). */
  title?: string | null
  subtitle?: string | null
}

export function RecruiterRoles({ data, onPostRole, onEditRole, onPostAgainRole, from = '/opportunities', statusSegment = 'always', parentLabel = 'Opportunities', layout = 'phone', title = 'Opportunities', subtitle = null }: RecruiterRolesProps) {
  const desktop = layout === 'desktop'
  const navigate = useNavigate()
  const [segment, setSegment] = useState<Segment>('open')
  const location = useLocation()
  const owner = useAuthStore((s) => s.profile)
  const cover = useOwnerCrest(owner)
  const highlight = (location.state as { highlight?: string } | null)?.highlight ?? null
  // Land on Opportunities with the role just posted or saved on top (DEV NOTE 330:781).
  const roles = useMemo(() => {
    const list = segment === 'open' ? data.open : data.closed
    if (!highlight) return list
    const hit = list.find((r) => r.id === highlight)
    return hit ? [hit, ...list.filter((r) => r.id !== highlight)] : list
  }, [segment, data.open, data.closed, highlight])
  const postRole = onPostRole
  const editRole = (r: ClubRole) => (onEditRole ? onEditRole(r) : navigate(`/dashboard/opportunities/${r.id}/edit`))
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
  const replies = useYourReplies(owner?.id)
  const rolesWithPending = data.open.filter((r) => r.pipeline.toReview > 0)
  const applicantsPath = (id: string) => `/dashboard/opportunities/${id}/applicants`
  const openNotice = () => {
    if (rolesWithPending.length === 1) navigate(applicantsPath(rolesWithPending[0].id), { state: { from } })
    else setSegment('open')
  }

  const firstRun = isFirstRunOpportunities(data.loading, data.open, data.closed)

  const showSegment = statusSegment === 'always' || data.closed.length > 0

  if (firstRun) {
    // Find players now opens Find players with "No context" active.
    const first = <FirstRunOpportunities cover={cover} onPostRole={postRole} onFindPlayers={() => navigate('/dashboard/find-players?context=none')} />
    return desktop ? <div className="mx-auto max-w-[520px] pt-6" data-testid="club-opportunities-desktop">{first}</div> : first
  }

  return (
    <>
      {desktop ? (
        <div className="mb-6 flex items-center gap-4" data-testid="club-opportunities-desktop-header">
          <div className="min-w-0 flex-1">
            {title && <h1 className="text-[34px] font-bold leading-[41px] tracking-[-0.015em] text-ink-1">{title}</h1>}
            {subtitle && <p className={cn('text-[16px] leading-[22px] text-ink-2', title && 'mt-1')}>{subtitle}</p>}
          </div>
          {showSegment && (
            <div className="shrink-0">
              <SegmentedControl<Segment>
                ariaLabel="Opportunity status"
                value={segment}
                onChange={setSegment}
                className="[&_button]:whitespace-nowrap [&_button]:px-4"
                options={[{ value: 'open', label: 'Open', count: publishedOpen }, { value: 'closed', label: 'Closed', count: data.closed.length }]}
              />
            </div>
          )}
          {/* One Primary per screen (audit B6): while a reply is owed the
              Primary is the role card's "Review N applicants", so Post a role
              steps down to Tonal. */}
          <button type="button" onClick={postRole} className={cn('inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full px-5 text-[16px] font-semibold transition-colors', rolesWithPending.length > 0 ? 'bg-brand-soft text-brand-primary hover:bg-brand-soft-hover' : 'bg-brand-primary text-white hover:bg-brand-primary-hover')} data-testid="desktop-post-role" data-emphasis={rolesWithPending.length > 0 ? 'tonal' : 'primary'}>
            <Plus className="h-5 w-5" strokeWidth={2.2} /> Post an opportunity
          </button>
        </div>
      ) : showSegment && (
        <div className="px-4 pb-3.5 pt-1">
          <SegmentedControl<Segment>
            ariaLabel="Opportunity status"
            value={segment}
            onChange={setSegment}
            options={[{ value: 'open', label: 'Open', count: publishedOpen }, { value: 'closed', label: 'Closed', count: data.closed.length }]}
          />
        </div>
      )}

      {segment === 'open' && notice && (
        <div className={desktop ? 'pb-5' : 'px-4 pb-3.5'}>
          {/* Amber only because the viewer must act (Figma O5 162:477). */}
          <button type="button" onClick={openNotice} className="flex w-full items-center gap-3 rounded-[16px] bg-status-warning-soft py-3 pl-3.5 pr-3 text-left" data-testid="club-waiting-notice">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-status-warning text-secondary font-semibold text-white tabular-nums">{pending.length}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-semibold leading-[19px] text-ink-1">{notice.title}</span>
              {notice.detail && <span className="block text-secondary text-ink-2">{notice.detail}</span>}
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-ink-4" strokeWidth={2} />
          </button>
        </div>
      )}

      {segment === 'open' && replies && (
        <div className={desktop ? 'pb-5' : 'px-4 pb-3.5'}>
          {/* Figma 05 CS8 205:5742: neutral surface, the club's own last 30 days, from 5 applicants. */}
          <div className="flex flex-col gap-2 rounded-[16px] bg-surface-subtle px-4 py-3.5" data-testid="your-replies">
            <p className="text-caption font-semibold uppercase tracking-[0.48px] text-ink-2">Your replies · last 30 days</p>
            <p className="text-[16px] font-semibold leading-[21px] text-ink-1">{yourRepliesCopy(replies).title}</p>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={replies.total} aria-valuenow={replies.answered} aria-label="Applicants answered">
              <div className="h-full rounded-full bg-brand-primary" style={{ width: `${Math.round((replies.answered / replies.total) * 100)}%` }} />
            </div>
            {yourRepliesCopy(replies).detail && <p className="text-secondary text-ink-2">{yourRepliesCopy(replies).detail}</p>}
          </div>
        </div>
      )}

      <div className={desktop ? 'flex flex-col gap-5' : 'flex flex-col gap-3.5 px-4'}>
        {!data.loading && roles.length === 0 && (
          segment === 'open' ? (
            <button type="button" onClick={postRole} className="flex h-[52px] w-full items-center justify-between rounded-card bg-surface-grouped px-4 text-row text-ink-2">
              Post a role <Plus className="h-4 w-4 text-hockia-primary" strokeWidth={2.2} />
            </button>
          ) : <p className="py-2 text-row text-ink-3">No closed opportunities yet.</p>
        )}
        {/* First load: role-card skeletons in the same grid, so the cards land without a jump. */}
        {data.loading && roles.length === 0 && (desktop
          ? <div className="grid grid-cols-2 gap-4 min-[1200px]:grid-cols-3" data-testid="club-roles-loading"><ClubRoleCardSkeleton /><ClubRoleCardSkeleton /></div>
          : <div className="flex flex-col gap-3.5" data-testid="club-roles-loading"><ClubRoleCardSkeleton /><ClubRoleCardSkeleton /></div>)}
        {(() => {
          const cards = roles.map((r) => (r.status === 'draft'
            ? <DraftCard key={r.id} role={r} onContinue={() => editRole(r)} />
            : <RoleCard key={r.id} role={r} expiryDays={data.expiryDays} cover={cover} onReview={() => navigate(applicantsPath(r.id), { state: { from } })} onChanged={data.refresh} onEdit={onEditRole ? () => onEditRole(r) : undefined} onPostAgain={onPostAgainRole ? () => onPostAgainRole(r) : undefined} />
          ))
          return desktop
            ? cards.length > 0 && <div className="grid grid-cols-2 gap-4 min-[1200px]:grid-cols-3" data-testid="club-role-grid">{cards}</div>
            : cards
        })()}

        {segment === 'open' && (
          <div className={cn('overflow-hidden rounded-[16px] bg-surface-subtle', desktop ? 'mt-2' : 'mt-1.5')} data-testid="club-scouting-group">
            <button type="button" onClick={() => navigate(findPlayersPath)} className="flex min-h-[48px] w-full items-center gap-2 py-3 pl-3.5 pr-3 text-left active:bg-surface-muted-pressed">
              <span className="flex-1 text-[16px] leading-[22px] text-ink-1">Find players for this opportunity</span>
              <ChevronRight className="h-3.5 w-3.5 text-ink-4" strokeWidth={2} />
            </button>
            <div className="mx-3.5 h-[0.5px] bg-line" />
            <button type="button" onClick={() => navigate('/dashboard/shortlist', { state: { parent: parentLabel } })} className="flex min-h-[48px] w-full items-center gap-2 py-3 pl-3.5 pr-3 text-left active:bg-surface-muted-pressed">
              <span className="flex-1 text-[16px] leading-[22px] text-ink-1">Shortlist</span>
              <span className="text-[16px] leading-[22px] text-ink-3 tabular-nums" data-testid="club-shortlist-count">{activeShortlist.loading ? '' : activeShortlist.rows.length}</span>
              <ChevronRight className="h-3.5 w-3.5 text-ink-4" strokeWidth={2} />
            </button>
          </div>
        )}
      </div>
    </>
  )
}

export default function ClubOpportunitiesScreen() {
  const profile = useAuthStore((s) => s.profile)
  const data = useClubRoles(profile?.id)
  // Club speed CS1: "+" asks how to start — Hockia AI or from scratch.
  const [starting, setStarting] = useState(false)
  const postRole = () => setStarting(true)
  return (
    <div className="min-h-screen bg-white pt-[env(safe-area-inset-top)] pb-28 lg:hidden" data-testid="club-opportunities-screen">
      <LargeTitleBar
        title="Opportunities"
        trailing={(
          <button type="button" onClick={postRole} aria-label="Post an opportunity" className="mr-2 flex h-11 w-11 items-center justify-center rounded-full bg-brand-primary text-white active:opacity-90">
            <Plus className="h-6 w-6" strokeWidth={2.2} />
          </button>
        )}
      />
      <RecruiterRoles data={data} onPostRole={postRole} />
      <PostRoleStartSheet open={starting} onClose={() => setStarting(false)} />
    </div>
  )
}
