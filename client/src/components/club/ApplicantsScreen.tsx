import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ChevronRight, Info, Sparkles } from 'lucide-react'
import { CrestTile } from '@/components/opportunities/RoleCover'
import { useOwnerCrest } from '@/hooks/useOwnerCrest'
import { CATEGORY_DOT_CLASSES, categoryFamily } from '@/lib/opportunityCopy'
import { Chip } from '@/components/ui/Chip'
import { DetailNavBar } from '@/components/ui/DetailNavBar'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { FitChip } from './FitChip'
import { UndoToast } from './UndoToast'
import { RoleActions } from './RoleActions'
import { useAuthStore } from '@/lib/auth'
import { useCountries } from '@/hooks/useCountries'
import { useRoleApplicants, type Applicant } from '@/hooks/useRoleApplicants'
import { useRoleSuggestions } from '@/hooks/useRoleSuggestions'
import { SUGGESTS_TITLE, suggestsEntryDetail } from '@/lib/roleSuggestions'
import { getImageUrl } from '@/lib/imageUrl'
import { genderPill, roleTitle } from '@/lib/opportunityCopy'
import { shortDayOf } from '@/lib/signing'
import { clubReplyLineClass, daysLeftLabel, daysLeftToReply, isClubReplyUrgent, personRoleLine, pipelineOf, appliedSinceLine, toReviewClosedNote } from '@/lib/clubRecruiting'
import { applicantChipFor, closedApplicantTag, clubRoadTag } from '@/lib/signing'
import { isRecruitingCoach, recruiterRolesHome } from '@/lib/coachRoles'
import { cn } from '@/lib/utils'

/**
 * Applicants of one role (Figma 04 Club · Applicants — club v2, 324:411;
 * DEV NOTE 327:555). Status chips; To review oldest first, the others by
 * the most recent decision. A "New" dot until this club opens the
 * application; "days left" before it closes, amber at 5 or fewer
 * (time-sensitive). The role line shows under every name. Fit chip is
 * club-only. An application that came from an invite shows the Invited tag
 * (Figma D3.4 393:452; DEV NOTE 394:111).
 *
 * D4: applicants past Shortlist (offered / accepted / waiting to confirm /
 * signed) stay under Shortlisted with a grey tag naming the step
 * (applicantChipFor / clubRoadTag). Closed holds no reply, role filled and —
 * since the re-check of 2026-10-02 — applications the player withdrew, each
 * with a grey tag saying why; all of them read-only.
 */
type Chip = 'pending' | 'shortlisted' | 'maybe' | 'rejected' | 'no_response'

// Dates read day first app-wide ("2 Oct"), the one format the signing road uses.
const monthDay = (iso: string | null | undefined) => shortDayOf(iso)

export default function ApplicantsScreen({ roleId }: { roleId: string }) {
  const navigate = useNavigate()
  const location = useLocation()
  const owner = useAuthStore((s) => s.profile)
  const clubId = owner?.id
  // A coach who recruits owns these screens too: back is their My roles, and
  // Edit role is their own role form there (the phone editor is the club's).
  const home = recruiterRolesHome(owner)
  const coachOwner = isRecruitingCoach(owner)
  const data = useRoleApplicants(roleId, clubId)
  const cover = useOwnerCrest(owner)
  const { countries } = useCountries()
  const [chip, setChip] = useState<Chip>('pending')
  const p = pipelineOf(data.applicants.map((a) => a.status))
  // D5 entry (Figma D5.1 398:83): the publisher's open player roles only.
  const suggestable = !!data.role && !!clubId && data.role.club_id === clubId && data.role.status === 'open' && data.role.opportunity_type === 'player'
  const suggests = useRoleSuggestions(suggestable ? roleId : null)
  const suggestsDetail = suggests.loading ? null : suggestsEntryDetail(suggests.data ? suggests.suggestions.length : 0)

  const list = useMemo(() => {
    const rows = data.applicants.filter((a) => applicantChipFor(a.status) === chip)
    return chip === 'pending'
      ? rows.sort((a, b) => (a.appliedAt ?? '').localeCompare(b.appliedAt ?? ''))
      : rows.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
  }, [data.applicants, chip])

  const role = data.role
  const pill = role ? genderPill(role.gender) : null
  const family = role ? categoryFamily(role.gender) : null
  const chips: { id: Chip; label: string }[] = [
    { id: 'pending', label: p.toReview ? `To review · ${p.toReview}` : 'To review' },
    { id: 'shortlisted', label: 'Shortlisted' },
    { id: 'maybe', label: 'Maybe' },
    { id: 'rejected', label: 'Declined' },
    { id: 'no_response', label: p.closed ? `Closed · ${p.closed}` : 'Closed' },
  ]
  const caption = chip === 'pending'
    ? `Oldest first · each closes ${data.expiryDays} days after it arrives`
    : chip === 'no_response' ? `Closed without a reply after ${data.expiryDays} days, filled, or withdrawn by the applicant` : 'Most recent decision first'
  const emptyCopy: Record<Chip, string> = {
    pending: 'Nobody waiting. New applicants show up here.',
    shortlisted: 'No one shortlisted yet.',
    maybe: 'No one on maybe.',
    rejected: 'No one declined.',
    no_response: 'None closed yet.',
  }
  const flagFor = (id: number | null) => {
    const c = id ? countries.find((x) => x.id === id) : null
    return c ? [c.flag_emoji, c.common_name || c.name].filter(Boolean).join(' ') : null
  }
  const open = (a: Applicant) => navigate(`/dashboard/opportunities/${roleId}/applicants/${a.applicationId}`, { state: { from: location.pathname } })

  return (
    <div className="min-h-screen bg-white pt-[env(safe-area-inset-top)] pb-28 lg:hidden" data-testid="applicants-screen">
      <DetailNavBar
        parent={home.label}
        fallbackPath={home.path}
        onBack={() => navigate(home.path)}
        trailing={role && clubId && role.club_id === clubId && role.status !== 'draft'
          ? (
            <RoleActions
              role={role}
              onChanged={data.refresh}
              onEdit={coachOwner ? () => navigate(home.path, { state: { editRoleId: role.id } }) : undefined}
              className="flex h-11 w-11 items-center justify-center rounded-full text-hockia-primary"
            />
          )
          : undefined}
      />
      {role && (
        <div className="flex items-start gap-3 px-4 pb-4 pt-0.5" data-testid="applicants-role-header">
          <CrestTile src={cover.crestUrl} name={cover.clubName ?? 'Club'} size={48} radius={14} className="mt-1" />
          <div className="min-w-0 flex-1">
            <h1 className="text-title-xl text-ink-1">{roleTitle(role)}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {pill && family && (
                <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-secondary font-semibold', pill.className)}>
                  <span aria-hidden="true" className={`h-[7px] w-[7px] rounded-full ${CATEGORY_DOT_CLASSES[family]}`} />{pill.label}
                </span>
              )}
              <span className="text-secondary text-ink-2">{appliedSinceLine(data.applicants, monthDay) ?? role.title}</span>
            </div>
          </div>
        </div>
      )}

      {suggestable && (
        <div className="px-4 pb-3">
          {/* Figma O6 163:499: the Hockia suggests entry in the brand soft, players who fit and haven't applied. */}
          <button
            type="button"
            onClick={() => navigate(`/dashboard/opportunities/${roleId}/suggested`, { state: { from: location.pathname } })}
            className="flex min-h-[56px] w-full items-center gap-3 rounded-[16px] bg-brand-soft px-3.5 py-2.5 text-left active:opacity-90"
            data-testid="suggests-entry"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-brand-primary"><Sparkles className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[16px] font-semibold leading-[21px] text-brand-primary">{SUGGESTS_TITLE}</span>
              {suggestsDetail && <span className="block truncate text-secondary text-ink-2" data-testid="suggests-entry-detail">{suggestsDetail}</span>}
            </span>
            <ChevronRight className="h-[18px] w-[18px] shrink-0 text-brand-primary" strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Application status">
        {chips.map((c) => (
          // ui/Chip: selected = soft purple (Chip ruling 2026-10-04); tab semantics kept. Figma O6 draws an ink pill here — raised in the PR.
          <Chip key={c.id} label={c.label} selected={chip === c.id} role="tab" aria-selected={chip === c.id} aria-pressed={undefined} onClick={() => setChip(c.id)} />
        ))}
      </div>
      <p className="px-4 pb-2.5 pt-3.5 text-secondary text-ink-2">{caption}</p>

      {data.error && <p className="px-4 py-3 text-row text-ink-2">{data.error}</p>}
      {!data.loading && !data.error && list.length === 0 && <p className="px-4 py-3 text-row text-ink-3">{emptyCopy[chip]}</p>}

      <div className="flex flex-col gap-2.5 px-4">
        {list.map((a) => {
          const isNew = !a.viewed && a.status === 'pending'
          const days = a.status === 'pending' ? daysLeftToReply(a.appliedAt, data.expiryDays) : null
          const right = a.status === 'pending' ? daysLeftLabel(days) : monthDay(a.updatedAt)
          const country = flagFor(a.person.nationalityCountryId)
          const avatar = a.person.avatarUrl ? getImageUrl(a.person.avatarUrl, 'avatar-md') ?? a.person.avatarUrl : null
          // Grey, never amber: the road step past Shortlist, or why a closed row closed.
          const tag = clubRoadTag(a.status) ?? closedApplicantTag(a.status)
          return (
            // Figma O6 163:499: one card per applicant; amber only on the days left when a reply is urgent.
            <button key={a.applicationId} type="button" onClick={() => open(a)} className="flex w-full items-center gap-3 rounded-[16px] bg-surface-subtle p-3 text-left active:bg-surface-muted-pressed" data-testid="applicant-row">
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
                <span className="block truncate text-secondary text-ink-2">{[personRoleLine(a.person), country].filter(Boolean).join(' · ')}</span>
                {a.fit?.state && a.fit.state !== 'grey' ? <span className="mt-1 flex"><FitChip state={a.fit.state} /></span> : null}
              </span>
              {right && <span className={cn('shrink-0 text-secondary font-semibold', clubReplyLineClass(a.status === 'pending' && isClubReplyUrgent(a.appliedAt, days)))}>{right}</span>}
            </button>
          )
        })}
      </div>

      {chip === 'pending' && !data.loading && (
        <div className="px-4 pt-[18px]">
          <div className="flex items-start gap-2.5 rounded-[12px] bg-surface-subtle p-3.5">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" strokeWidth={2} />
            <p className="text-secondary leading-[18px] text-ink-2">
              Shortlist, Maybe or Decline. Anything you don’t answer closes after {data.expiryDays} days{toReviewClosedNote(p) ? ` — ${toReviewClosedNote(p)}` : ''}.
            </p>
          </div>
        </div>
      )}

      <UndoToast />
    </div>
  )
}
