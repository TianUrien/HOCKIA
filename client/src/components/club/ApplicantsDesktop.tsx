import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Check, ChevronLeft, Info } from 'lucide-react'
import Header from '@/components/Header'
import { CrestTile } from '@/components/opportunities/RoleCover'
import { useOwnerCrest } from '@/hooks/useOwnerCrest'
import { CATEGORY_DOT_CLASSES, categoryFamily, genderPill, roleTitle } from '@/lib/opportunityCopy'
import { Chip } from '@/components/ui/Chip'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { FitBadge } from '@/components/ui/FitBadge'
import { UndoToast } from './UndoToast'
import { BulkDeclineSheet } from './BulkDeclineSheet'
import { ApplicantsAiSummary } from './ApplicantsAiSummary'
import { useBulkDecisions } from '@/hooks/useBulkDecisions'
import { firstWord, namesLine } from '@/lib/declineNotes'
import { RoleActions } from './RoleActions'
import ApplicantReviewScreen, { type ReviewActions } from './ApplicantReviewScreen'
import { useAuthStore } from '@/lib/auth'
import { useCountries } from '@/hooks/useCountries'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useRoleApplicants, type Applicant } from '@/hooks/useRoleApplicants'
import { getImageUrl } from '@/lib/imageUrl'
import { shortDayOf, applicantChipFor, closedApplicantTag, clubRoadTag } from '@/lib/signing'
import { clubReplyLineClass, daysLeftLabel, daysLeftToReply, isClubReplyUrgent, personRoleLine, pipelineOf, appliedSinceLine, toReviewClosedNote } from '@/lib/clubRecruiting'
import { recruiterRolesHome } from '@/lib/coachRoles'
import { cn } from '@/lib/utils'
import { ApplicantRowsSkeleton } from '@/components/ScreenSkeletons'

type ChipId = 'pending' | 'shortlisted' | 'maybe' | 'rejected' | 'no_response'
const monthDay = (iso: string | null | undefined) => shortDayOf(iso)

/**
 * Applicants on desktop (Figma D4 195:987, ruling 16 Oct 2026: replaces the v1
 * list). Master (420, 360 at 1024–1199): the role header, the status chips on
 * the shared soft-violet Chip (wrapping), the caption and one row per
 * applicant — the selected row carries a 2 px brand border. Detail: the
 * applicant review in its pane layout, with the same decisions, decline
 * sheet, road to signing and undo toast as on the phone.
 *
 * Keyboard: ↑ / ↓ move through the list; S / M / D = Shortlist / Maybe /
 * Decline on the selected applicant. After a decision the next applicant in
 * the same list is selected. The selected application is in ?a= so a link
 * (or the phone review URL on desktop) opens it directly.
 *
 * Hockia suggests is phone-only for now (its route sends desktop back here),
 * so the entry is not shown on desktop.
 *
 * Club speed CS4/CS5 on desktop: "Select" on To review and Maybe → a checkbox
 * per row, and the detail pane becomes the selection (N selected · Maybe ·
 * Decline N) with the same fixed-note decline sheet and one Undo as the phone.
 */
export default function ApplicantsDesktop({ roleId }: { roleId: string }) {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const owner = useAuthStore((s) => s.profile)
  const clubId = owner?.id
  const home = recruiterRolesHome(owner)
  const data = useRoleApplicants(roleId, clubId)
  const cover = useOwnerCrest(owner)
  const { countries } = useCountries()
  const wide = useMediaQuery('(min-width: 1200px)')
  const p = pipelineOf(data.applicants.map((a) => a.status))
  const [chip, setChip] = useState<ChipId>('pending')
  const actions = useRef<ReviewActions | null>(null)
  const [selecting, setSelecting] = useState(false)
  const [picks, setPicks] = useState<Set<string>>(() => new Set())
  const [bulkDeclining, setBulkDeclining] = useState(false)
  const bulk = useBulkDecisions(roleId)

  const list = useMemo(() => {
    const rows = data.applicants.filter((a) => applicantChipFor(a.status) === chip)
    return chip === 'pending'
      ? rows.sort((a, b) => (a.appliedAt ?? '').localeCompare(b.appliedAt ?? ''))
      : rows.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
  }, [data.applicants, chip])

  const wanted = params.get('a')
  // A deep link to an application lands on its own status chip.
  const landed = useRef(false)
  useEffect(() => {
    if (landed.current || !wanted || data.loading) return
    const hit = data.applicants.find((a) => a.applicationId === wanted)
    landed.current = true
    if (hit) setChip(applicantChipFor(hit.status) as ChipId)
  }, [wanted, data.loading, data.applicants])

  const selected = list.find((a) => a.applicationId === wanted) ?? list[0] ?? null
  const selectable = chip === 'pending' || chip === 'maybe'
  const picked = list.filter((a) => picks.has(a.applicationId))
  const allPicked = list.length > 0 && picked.length === list.length
  const endSelect = () => { setSelecting(false); setPicks(new Set()); setBulkDeclining(false) }
  const toggle = (id: string) => setPicks((cur) => { const next = new Set(cur); if (next.has(id)) next.delete(id); else next.add(id); return next })
  const changeChip = (c: ChipId) => { setChip(c); endSelect() }
  const select = useCallback((a: Applicant | null) => {
    const next = new URLSearchParams(params)
    if (a) next.set('a', a.applicationId)
    else next.delete('a')
    setParams(next, { replace: true })
  }, [params, setParams])

  // The list a decision was taken from, so "next" means the row after it.
  const listRef = useRef(list)
  listRef.current = list
  const onDecided = useCallback(() => {
    const before = listRef.current
    const i = selected ? before.findIndex((a) => a.applicationId === selected.applicationId) : -1
    const rest = before.filter((a) => a.applicationId !== selected?.applicationId)
    select(rest[Math.min(Math.max(i, 0), rest.length - 1)] ?? null)
  }, [selected, select])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      if (document.querySelector('[role="dialog"]')) return
      // Selecting several: the keys act on one applicant, so they rest.
      if (selecting) return
      const i = selected ? list.findIndex((a) => a.applicationId === selected.applicationId) : -1
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const next = list[Math.min(Math.max(i + (e.key === 'ArrowDown' ? 1 : -1), 0), list.length - 1)]
        if (next) {
          select(next)
          document.querySelector(`[data-application-id="${next.applicationId}"]`)?.scrollIntoView({ block: 'nearest' })
        }
        return
      }
      const k = e.key.toLowerCase()
      if (k === 's') actions.current?.shortlist()
      else if (k === 'm') actions.current?.maybe()
      else if (k === 'd') actions.current?.decline()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [list, selected, select, selecting])

  const role = data.role
  const pill = role ? genderPill(role.gender) : null
  const family = role ? categoryFamily(role.gender) : null
  const chips: { id: ChipId; label: string }[] = [
    { id: 'pending', label: p.toReview ? `To review · ${p.toReview}` : 'To review' },
    { id: 'shortlisted', label: 'Shortlisted' },
    { id: 'maybe', label: 'Maybe' },
    { id: 'rejected', label: 'Not a fit' },
    { id: 'no_response', label: p.closed ? `Closed · ${p.closed}` : 'Closed' },
  ]
  const caption = chip === 'pending'
    ? `Oldest first · each closes ${data.expiryDays} days after it arrives`
    : chip === 'no_response' ? `Closed without a reply after ${data.expiryDays} days, filled, or withdrawn by the applicant` : 'Most recent decision first'
  const emptyCopy: Record<ChipId, string> = {
    pending: 'Nobody waiting. New applicants show up here.',
    shortlisted: 'No one shortlisted yet.',
    maybe: 'No one on maybe.',
    rejected: 'No one declined.',
    no_response: 'None closed yet.',
  }
  const flagFor = (id: number | null) => {
    const c = id ? countries.find((x) => x.id === id) : null
    return c?.flag_emoji ?? null
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header mobileHidden />
      <main className="mx-auto w-full max-w-[1232px] px-4 pb-20 pt-[88px]" data-testid="applicants-desktop">
        <button type="button" onClick={() => navigate(home.path)} className="inline-flex h-9 items-center gap-0.5 text-[14px] font-semibold leading-[19px] text-brand-primary hover:underline" data-testid="applicants-back">
          <ChevronLeft className="h-4 w-4" strokeWidth={2.2} /> {home.label}
        </button>

        <div className="mt-3 grid gap-8" style={{ gridTemplateColumns: `${wide ? 420 : 360}px minmax(0, 1fr)` }}>
          {/* Master */}
          <aside className="flex flex-col gap-4 self-start" data-testid="applicants-master">
            {role && (
              <div className="flex items-start gap-3" data-testid="applicants-role-header">
                <CrestTile src={cover.crestUrl} name={cover.clubName ?? 'Club'} size={48} radius={14} className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <h1 className="text-[22px] font-bold leading-[27px] tracking-[-0.01em] text-ink-1">{roleTitle(role)}</h1>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {pill && family && (
                      <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-secondary font-semibold', pill.className)}>
                        <span aria-hidden="true" className={`h-[7px] w-[7px] rounded-full ${CATEGORY_DOT_CLASSES[family]}`} />{pill.label}
                      </span>
                    )}
                    <span className="text-secondary text-ink-2">{appliedSinceLine(data.applicants, monthDay) ?? role.title}</span>
                  </div>
                </div>
                {clubId && role.club_id === clubId && role.status !== 'draft' && (
                  <RoleActions
                    role={role}
                    onChanged={data.refresh}
                    onEdit={() => navigate(home.path, { state: { editRoleId: role.id } })}
                    onPostAgain={() => navigate(home.path, { state: { postAgainRoleId: role.id } })}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-2 hover:bg-white"
                  />
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Application status">
              {chips.map((c) => (
                <Chip key={c.id} label={c.label} selected={chip === c.id} role="tab" aria-selected={chip === c.id} aria-pressed={undefined} onClick={() => changeChip(c.id)} />
              ))}
            </div>
            <div className="-mt-1 flex items-center gap-3">
              <p className="min-w-0 flex-1 text-secondary text-ink-2">{selecting ? 'Select applicants to answer them together' : caption}</p>
              {selecting ? (
                <>
                  <button type="button" onClick={() => setPicks(allPicked ? new Set() : new Set(list.map((a) => a.applicationId)))} className="shrink-0 text-secondary font-semibold text-brand-primary hover:underline" data-testid="select-all">{allPicked ? 'Deselect all' : 'Select all'}</button>
                  <button type="button" onClick={endSelect} className="shrink-0 text-secondary font-semibold text-brand-primary hover:underline">Cancel</button>
                </>
              ) : selectable && list.length > 0 && (
                <button type="button" onClick={() => setSelecting(true)} className="shrink-0 text-secondary font-semibold text-brand-primary hover:underline" data-testid="applicants-select">Select</button>
              )}
            </div>

            {chip === 'pending' && !selecting && role && clubId && role.club_id === clubId && (
              <ApplicantsAiSummary roleId={roleId} pending={list} expiryDays={data.expiryDays} />
            )}
            {data.error && (
              <div className="rounded-[16px] bg-white p-4" role="alert" data-testid="applicants-error">
                <h1 className="text-[17px] font-semibold leading-[22px] text-ink-1">Can’t open these applicants</h1>
                <p className="mt-1 text-row text-ink-2">{data.error.replace('Pull to try again.', 'Please try again.')}</p>
              </div>
            )}
            {!data.loading && !data.error && list.length === 0 && <p className="text-row text-ink-3">{emptyCopy[chip]}</p>}
            {data.loading && !data.error && list.length === 0 && <ApplicantRowsSkeleton />}

            <div className="flex flex-col gap-2" data-testid="applicants-list">
              {list.map((a) => {
                const isNew = !a.viewed && a.status === 'pending'
                const days = a.status === 'pending' ? daysLeftToReply(a.appliedAt, data.expiryDays) : null
                const right = a.status === 'pending' ? daysLeftLabel(days) : monthDay(a.updatedAt)
                const flags = [flagFor(a.person.nationalityCountryId)].filter(Boolean).join(' ')
                const avatar = a.person.avatarUrl ? getImageUrl(a.person.avatarUrl, 'avatar-md') ?? a.person.avatarUrl : null
                const tag = clubRoadTag(a.status) ?? closedApplicantTag(a.status)
                const isSel = selected?.applicationId === a.applicationId
                return (
                  <button
                    key={a.applicationId}
                    type="button"
                    onClick={() => (selecting ? toggle(a.applicationId) : select(a))}
                    aria-current={!selecting && isSel ? 'true' : undefined}
                    {...(selecting ? { role: 'checkbox', 'aria-checked': picks.has(a.applicationId) } : {})}
                    data-application-id={a.applicationId}
                    className={cn('flex w-full items-center gap-3 rounded-[16px] border-2 p-3 text-left transition-colors', (selecting ? picks.has(a.applicationId) : isSel) ? 'border-brand-primary bg-white' : 'border-transparent bg-white hover:border-line')}
                    data-testid="applicant-row"
                  >
                    {selecting && (
                      <span aria-hidden="true" className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full', picks.has(a.applicationId) ? 'bg-brand-primary text-white' : 'border-2 border-ink-4')} data-testid="applicant-check">
                        {picks.has(a.applicationId) && <Check className="h-4 w-4" strokeWidth={3} />}
                      </span>
                    )}
                    <span className="relative shrink-0">
                      <EntityAvatar src={avatar} name={a.person.fullName} role={a.person.role} size={48} />
                      {isNew && <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-white bg-brand-primary" aria-label="New" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-[16px] font-semibold leading-[21px] text-ink-1">{a.person.fullName}</span>
                        {a.invited
                          ? <span className="shrink-0 rounded-full bg-brand-soft px-2 py-[2px] text-caption font-semibold text-brand-primary" data-testid="applicant-invited-tag">Invited</span>
                          : isNew && <span className="shrink-0 rounded-full bg-brand-soft px-2 py-[2px] text-caption font-semibold text-brand-primary">New</span>}
                        {tag && <span className="shrink-0 rounded-full bg-surface-muted px-2 py-[2px] text-caption font-semibold text-ink-2" data-testid="applicant-status-tag">{tag}</span>}
                      </span>
                      <span className="block truncate text-secondary text-ink-2">{[personRoleLine(a.person), flags].filter(Boolean).join(' · ')}</span>
                      {a.fit?.state && a.fit.state !== 'grey' ? <span className="mt-1 flex"><FitBadge state={a.fit.state} /></span> : null}
                    </span>
                    {right && <span className={cn('shrink-0 text-secondary font-semibold', clubReplyLineClass(a.status === 'pending' && isClubReplyUrgent(a.appliedAt, days)))}>{right}</span>}
                  </button>
                )
              })}
            </div>

            {chip === 'pending' && !data.loading && (
              <div className="flex items-start gap-2.5 rounded-[12px] bg-white p-3.5">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" strokeWidth={2} />
                <p className="text-secondary leading-[18px] text-ink-2">
                  Shortlist, Maybe or Decline. Anything you don’t answer closes after {data.expiryDays} days{toReviewClosedNote(p) ? `. ${toReviewClosedNote(p)}` : ''}.
                </p>
              </div>
            )}
            {list.length > 0 && !selecting && (
              <p className="text-caption text-ink-3" data-testid="applicants-keyboard-hint">Keyboard: ↑ ↓ to move · S Shortlist · M Maybe · D Decline</p>
            )}
          </aside>

          {/* Detail */}
          <section className="min-w-0 rounded-[24px] bg-white p-6" data-testid="applicants-detail">
            {selecting ? (
              <div className="flex flex-col items-start gap-4 py-10" data-testid="selection-pane">
                <h2 className="text-[22px] font-bold leading-[27px] text-ink-1">{picked.length === 1 ? '1 selected' : `${picked.length} selected`}</h2>
                <p className="text-row text-ink-2">{picked.length ? namesLine(picked.map((a) => a.person.fullName)) : 'Tick the applicants you want to answer together.'}</p>
                <div className="flex gap-3">
                  {chip === 'pending' && (
                    <button type="button" disabled={picked.length === 0} onClick={() => { bulk.maybe(picked); endSelect() }} className="flex h-12 items-center rounded-full bg-surface-subtle px-6 text-[16px] font-semibold text-ink-1 hover:bg-surface-muted disabled:opacity-40" data-testid="bulk-maybe">Maybe</button>
                  )}
                  <button type="button" disabled={picked.length === 0} onClick={() => setBulkDeclining(true)} className="flex h-12 items-center rounded-full bg-hockia-primary px-6 text-[16px] font-semibold text-white hover:opacity-90 disabled:opacity-40" data-testid="bulk-decline">
                    {picked.length ? `Not a fit · ${picked.length}` : 'Not a fit'}
                  </button>
                </div>
              </div>
            ) : selected
              ? <ApplicantReviewScreen key={selected.applicationId} roleId={roleId} applicationId={selected.applicationId} layout="pane" onDecided={onDecided} actionsRef={actions} />
              : <p className="py-16 text-center text-row text-ink-3">{data.loading ? '' : 'Pick an applicant to review.'}</p>}
          </section>
        </div>
      </main>
      {role && (
        <BulkDeclineSheet
          open={bulkDeclining}
          roleTitle={roleTitle(role)}
          names={picked.map((a) => a.person.fullName)}
          firstNames={picked.map((a) => firstWord(a.person.fullName))}
          onCancel={() => setBulkDeclining(false)}
          onSend={(reason, body) => { bulk.decline(picked, reason, body); endSelect() }}
        />
      )}
      <UndoToast />
    </div>
  )
}
