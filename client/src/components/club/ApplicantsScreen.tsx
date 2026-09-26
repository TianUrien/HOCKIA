import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ChevronRight, Info } from 'lucide-react'
import { DetailNavBar } from '@/components/ui/DetailNavBar'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { FitChip } from './FitChip'
import { UndoToast } from './UndoToast'
import { useAuthStore } from '@/lib/auth'
import { useCountries } from '@/hooks/useCountries'
import { useRoleApplicants, type Applicant } from '@/hooks/useRoleApplicants'
import { getImageUrl } from '@/lib/imageUrl'
import { genderPill, roleTitle } from '@/lib/opportunityCopy'
import { daysLeftLabel, daysLeftToReply, isDaysLeftUrgent, personRoleLine, pipelineOf } from '@/lib/clubRecruiting'
import { cn } from '@/lib/utils'

/**
 * Applicants of one role (Figma 04 Club · Applicants — club v2, 324:411;
 * DEV NOTE 327:555). Status chips; To review oldest first, the others by
 * the most recent decision. A "New" dot until this club opens the
 * application; "days left" before it closes, amber at 5 or fewer
 * (time-sensitive). The role line shows under every name. Fit chip is
 * club-only.
 */
type Chip = 'pending' | 'shortlisted' | 'maybe' | 'rejected' | 'no_response'

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthDay = (iso: string | null | undefined) => {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : `${MONTH[d.getMonth()]} ${d.getDate()}`
}

export default function ApplicantsScreen({ roleId }: { roleId: string }) {
  const navigate = useNavigate()
  const location = useLocation()
  const clubId = useAuthStore((s) => s.profile?.id)
  const data = useRoleApplicants(roleId, clubId)
  const { countries } = useCountries()
  const [chip, setChip] = useState<Chip>('pending')
  const p = pipelineOf(data.applicants.map((a) => a.status))

  const list = useMemo(() => {
    const rows = data.applicants.filter((a) => a.status === chip)
    return chip === 'pending'
      ? rows.sort((a, b) => (a.appliedAt ?? '').localeCompare(b.appliedAt ?? ''))
      : rows.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
  }, [data.applicants, chip])

  const role = data.role
  const pill = role ? genderPill(role.gender) : null
  const chips: { id: Chip; label: string }[] = [
    { id: 'pending', label: p.toReview ? `To review · ${p.toReview}` : 'To review' },
    { id: 'shortlisted', label: 'Shortlisted' },
    { id: 'maybe', label: 'Maybe' },
    { id: 'rejected', label: 'Declined' },
    { id: 'no_response', label: p.closed ? `Closed · ${p.closed}` : 'Closed' },
  ]
  const caption = chip === 'pending'
    ? `Oldest first · each closes ${data.expiryDays} days after it arrives`
    : chip === 'no_response' ? `Closed without a reply after ${data.expiryDays} days` : 'Most recent decision first'
  const emptyCopy: Record<Chip, string> = {
    pending: 'Nobody waiting. New applicants show up here.',
    shortlisted: 'No one shortlisted yet.',
    maybe: 'No one on maybe.',
    rejected: 'No one declined.',
    no_response: 'None closed without a reply.',
  }
  const flagFor = (id: number | null) => {
    const c = id ? countries.find((x) => x.id === id) : null
    return c ? [c.flag_emoji, c.common_name || c.name].filter(Boolean).join(' ') : null
  }
  const open = (a: Applicant) => navigate(`/dashboard/opportunities/${roleId}/applicants/${a.applicationId}`, { state: { from: location.pathname } })

  return (
    <div className="min-h-screen bg-white pb-28 lg:hidden" data-testid="applicants-screen">
      <DetailNavBar parent="Opportunities" fallbackPath="/opportunities" onBack={() => navigate('/opportunities')} />
      {role && (
        <div className="px-5 pb-3.5 pt-0.5">
          <div className="flex items-center gap-2">
            <h1 className="text-[30px] font-bold leading-9 tracking-[-0.36px] text-ink-1">{roleTitle(role)}</h1>
            {pill && <span className={cn('rounded-full px-2 py-0.5 text-secondary font-semibold', pill.className)}>{pill.label}</span>}
          </div>
          <p className="text-[14px] leading-[19px] text-ink-2">
            {[role.title, `${p.total} applied since ${monthDay(role.published_at ?? role.created_at)}`].filter(Boolean).join(' · ')}
          </p>
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Application status">
        {chips.map((c) => (
          <button key={c.id} type="button" role="tab" aria-selected={chip === c.id} onClick={() => setChip(c.id)} className={cn('shrink-0 rounded-full px-3.5 py-2 text-[14px] font-semibold', chip === c.id ? 'bg-ink-1 text-white' : 'bg-surface-grouped text-ink-1')}>
            {c.label}
          </button>
        ))}
      </div>
      <p className="px-5 pb-1 pt-3.5 text-secondary text-ink-2">{caption}</p>

      {data.error && <p className="px-5 py-3 text-row text-ink-2">{data.error}</p>}
      {!data.loading && !data.error && list.length === 0 && <p className="px-5 py-3 text-row text-ink-3">{emptyCopy[chip]}</p>}

      <div>
        {list.map((a, i) => {
          const isNew = !a.viewed && a.status === 'pending'
          const days = a.status === 'pending' ? daysLeftToReply(a.appliedAt, data.expiryDays) : null
          const right = a.status === 'pending' ? daysLeftLabel(days) : monthDay(a.updatedAt)
          const country = flagFor(a.person.nationalityCountryId)
          const avatar = a.person.avatarUrl ? getImageUrl(a.person.avatarUrl, 'avatar-md') ?? a.person.avatarUrl : null
          return (
            <div key={a.applicationId}>
              <button type="button" onClick={() => open(a)} className="flex w-full items-center gap-3 py-3 pl-5 pr-3.5 text-left" data-testid="applicant-row">
                <span className="relative shrink-0">
                  <EntityAvatar src={avatar} name={a.person.fullName} role={a.person.role} size={52} />
                  {isNew && <span className="absolute -right-0.5 -top-0.5 h-3.5 w-3.5 rounded-full border-2 border-white bg-hockia-primary" aria-label="New" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[16px] font-semibold leading-[21px] text-ink-1">{a.person.fullName}</span>
                    {isNew && <span className="shrink-0 text-caption font-semibold text-hockia-primary">New</span>}
                  </span>
                  <span className="block truncate text-[14px] leading-[19px] text-ink-2">{personRoleLine(a.person)}</span>
                  {(a.fit?.state && a.fit.state !== 'grey') || country ? (
                    <span className="flex items-center gap-2 pt-[3px]">
                      <FitChip state={a.fit?.state} />
                      {country && <span className="truncate text-secondary text-ink-2">{country}</span>}
                    </span>
                  ) : null}
                </span>
                <span className="flex shrink-0 items-center gap-0.5">
                  {right && <span className={cn('text-secondary', isDaysLeftUrgent(days) ? 'font-semibold text-[#b45309]' : 'text-ink-3')}>{right}</span>}
                  <ChevronRight className="h-[18px] w-[18px] text-ink-4" strokeWidth={2} />
                </span>
              </button>
              {i < list.length - 1 && <div className="ml-[84px] h-[0.5px] bg-line" />}
            </div>
          )
        })}
      </div>

      {chip === 'pending' && !data.loading && (
        <div className="px-5 pt-[18px]">
          <div className="flex items-start gap-2.5 rounded-card bg-surface-grouped p-3.5">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" strokeWidth={2} />
            <p className="text-secondary leading-[18px] text-ink-2">
              Shortlist, Maybe or Decline. Anything you don’t answer closes after {data.expiryDays} days{p.closed > 0 ? ` — ${p.closed} ${p.closed === 1 ? 'has' : 'have'} closed on this role so far` : ''}.
            </p>
          </div>
        </div>
      )}

      <UndoToast />
    </div>
  )
}
