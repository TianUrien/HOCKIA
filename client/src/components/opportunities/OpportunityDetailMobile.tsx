import { useEffect, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Calendar, Check, ChevronRight, Clock, MessageCircle, Share, type LucideIcon } from 'lucide-react'
import type { Vacancy } from '@/lib/supabase'
import { DetailNavBar } from '@/components/ui/DetailNavBar'
import { backLabelFrom } from '@/lib/backLabel'
import { IconButton } from '@/components/ui/IconButton'
import { buttonClassName } from '@/components/ui/buttonClasses'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { MoreMenu } from '@/components/safety/MoreMenu'
import { useReportAction } from '@/components/safety/useReportAction'
import { canReport } from '@/lib/report'
import { useToastStore } from '@/lib/toast'
import { useAuthStore } from '@/lib/auth'
import { useCountries } from '@/hooks/useCountries'
import { checkOpportunityEligibility } from '@/lib/opportunityEligibility'
import { getShareOrigin } from '@/lib/profileShare'
import { humanizeToken, identityLine, positionLabel } from '@/lib/identity'
import {
  APPLICATION_TONE_CLASS, NOTE_TILE, PAID_TILE, SPECIALIST_TILE, applicationStatusPill, appliedOnLine, closedRoleView, clubNoteFromFeedback,
  compensationText, deadlineLine, genderPill, postedLine, roleBenefits, roleHeadline, startsLine,
} from '@/lib/opportunityCopy'

interface OpportunityDetailMobileProps {
  vacancy: Vacancy
  clubName: string
  clubLogo: string | null
  clubId: string
  publisherRole: string | null | undefined
  countryFlag: string | null
  league: string | null
  hasApplied: boolean
  applicationStatus: string | null
  /** Show the Apply bar at all (players → player roles, coaches → coach roles, guests). */
  canApply: boolean
  isPublisher: boolean
  /** The role no longer takes applications (status isn't open). */
  isClosed?: boolean
  onApply: () => void
  onMessage: () => void
  /** D4: the applicant's own road (Shortlisted → Offer → Signed, Confirm
   *  signing, Withdraw) on an OPEN role. Rendered by the page. */
  ownApplicationSlot?: ReactNode
}

/**
 * Opportunity detail (Figma 43:195 / 218:556): every field the club filled,
 * in the order a player decides — who → what → what you get → what they ask
 * → their own words → how applying works — above a fixed Message / Apply bar.
 * After applying: tinted Applied with a check, a status line, and a link to
 * My applications. Re-applying is impossible.
 *
 * A CLOSED role (opened from My applications or a notification) is still
 * this page, greyed with a "Closed" label and no Apply: an applicant sees
 * their own application block (status, applied date, the club's note) and
 * a "Message the club" bar;
 * anyone else sees "This role is closed" with a link to open roles.
 */
export function OpportunityDetailMobile({
  vacancy, clubName, clubLogo, clubId, publisherRole, countryFlag, league, hasApplied, applicationStatus, canApply, isPublisher, isClosed = false, onApply, onMessage, ownApplicationSlot,
}: OpportunityDetailMobileProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const addToast = useToastStore((s) => s.addToast)
  const profile = useAuthStore((s) => s.profile)
  const { countries } = useCountries()
  const report = useReportAction({ targetId: vacancy.club_id, subject: 'role', contentId: vacancy.id })
  const showMore = !isPublisher && canReport(profile?.id, vacancy.club_id)
  // Same two rules as the apply sheet and the DB trigger, so the block is
  // never a surprise two taps later.
  const eligibility = checkOpportunityEligibility(vacancy, profile, countries)
  const lacksEuPassport = vacancy.eu_passport_required === true && !eligibility.eligible && /EU passport/i.test(eligibility.reason ?? '')
  // Player and coach roles alike (same as the list card, RoleCard): position
  // or coaching specialisation as text + the soft-purple team Tag.
  const pill = genderPill(vacancy.gender)
  const headline = roleHeadline(vacancy)
  const positionText = positionLabel(vacancy.position)
  const place = [vacancy.location_city, vacancy.location_country].map((s) => s?.trim()).filter(Boolean).join(', ')
  const clubLine = [identityLine(publisherRole ?? 'club'), countryFlag && place ? `${countryFlag} ${place}` : place, league].filter(Boolean).join(' · ')
  const benefits = roleBenefits(vacancy)
  const customBenefits = vacancy.custom_benefits ?? []
  const specialists = vacancy.specialist_skills_wanted ?? []
  const status = hasApplied ? applicationStatusPill(applicationStatus ?? 'pending', null, vacancy.status === 'open') : null
  // Players only ever see "Not selected": one grey state in the footer, no chip.
  const notSelected = hasApplied && applicationStatus === 'rejected'
  // Withdrawn (D4): one grey state in the footer too — never next to an "Applied" button.
  const withdrawn = hasApplied && applicationStatus === 'withdrawn'
  const closedView = closedRoleView({ isClosed, hasApplied, isPublisher })
  const closed = closedView !== 'open'

  // A decline can carry the club's own note (Figma 04 Club · Decline). The
  // player reads it here, where My applications' "Read the club's note" lands.
  // A closed role also shows the applied date. The applicant's OWN row only
  // (RLS: applicant_id = auth.uid()) — never other applicants or counts.
  const [clubNote, setClubNote] = useState<string | null>(null)
  const [appliedAt, setAppliedAt] = useState<string | null>(null)
  const userId = profile?.id ?? null
  const needsOwnRow = hasApplied && !!userId && (applicationStatus === 'rejected' || closed)
  useEffect(() => {
    if (!needsOwnRow || !userId) { setClubNote(null); setAppliedAt(null); return }
    let cancelled = false
    void supabase
      .from('opportunity_applications')
      .select('applied_at, ai_feedback')
      .eq('opportunity_id', vacancy.id)
      .eq('applicant_id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        const row = data as { applied_at?: string | null; ai_feedback?: unknown } | null
        setClubNote(clubNoteFromFeedback(row?.ai_feedback, applicationStatus))
        setAppliedAt(row?.applied_at ?? null)
      })
    return () => { cancelled = true }
  }, [needsOwnRow, applicationStatus, userId, vacancy.id])
  const appliedOn = appliedOnLine(appliedAt)

  const share = async () => {
    const url = `${getShareOrigin()}/opportunities/${vacancy.id}`
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title: `${headline.title} · ${clubName}`, url })
        return
      }
      await navigator.clipboard.writeText(url)
      addToast('Link copied', 'success')
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) addToast('Could not share this role', 'error')
    }
  }

  const openClub = () => navigate(publisherRole === 'coach' ? `/coaches/id/${clubId}` : `/clubs/id/${clubId}`)

  // Detail row (Figma 467:128): label ink-2 left, value semibold right.
  const askRow = (label: string, value: React.ReactNode) => (
    <div className="flex items-start justify-between gap-3 border-b border-line py-3 last:border-b-0" data-testid="ask-row">
      <span className="shrink-0 text-row text-ink-2">{label}</span>
      <span className="min-w-0 text-right text-row font-semibold text-ink-1">{value}</span>
    </div>
  )
  const compensationKey = (vacancy.compensation ?? '').toLowerCase()

  return (
    <div className="bg-white pb-[calc(72px+env(safe-area-inset-bottom))]">
      <DetailNavBar
        parent={backLabelFrom(location.state, 'Opportunities')}
        fallbackPath="/opportunities"
        trailing={(
          <span className="flex items-center">
            <IconButton label="Share" onClick={() => void share()}><Share className="h-6 w-6" strokeWidth={1.8} /></IconButton>
            {showMore && <MoreMenu items={[report.item]} label="More options" title={vacancy.title ?? undefined} triggerClassName="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-1" iconClassName="h-6 w-6" testId="role-more-menu" />}
          </span>
        )}
      />
      {report.sheet}

      <div className="px-5 pt-1">
      <button type="button" onClick={openClub} className="flex w-full items-center gap-3 rounded-card bg-surface-muted p-3 text-left active:bg-surface-muted-pressed" data-testid="role-club-row">
        <EntityAvatar src={clubLogo} name={clubName} role={publisherRole ?? 'club'} size={48} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-row font-semibold text-ink-1">{clubName}</span>
          <span className="block truncate text-secondary text-ink-2">{clubLine}</span>
        </span>
        <ChevronRight className="h-[18px] w-[18px] shrink-0 text-ink-4" strokeWidth={1.6} />
      </button>
      </div>

      {/* A closed role stays readable, greyed out, under a "Closed" label. */}
      {closed && (
        <div className="px-5 pt-2.5">
          <span className="inline-block rounded-full bg-surface-grouped px-2 py-0.5 text-caption font-semibold text-ink-2" data-testid="role-closed-label">Closed</span>
        </div>
      )}
      <div className={closed ? 'opacity-60 grayscale' : undefined} data-testid={closed ? 'role-body-closed' : undefined}>
      <div className={`px-5 pb-1.5 ${closed ? 'pt-1.5' : 'pt-2.5'}`}>
        <h1 className="break-words text-title-xl text-ink-1" data-testid="role-title">{headline.title}</h1>
        {(positionText || pill) && (
          <div className="mt-1 flex flex-wrap items-center gap-2" data-testid="role-detail-meta">
            {positionText && <span className="text-row font-semibold text-ink-2" data-testid="role-detail-position">{positionText}</span>}
            {pill && <span className={`rounded-full px-2 py-0.5 text-secondary font-semibold ${pill.className}`} data-testid="role-detail-team-tag">{pill.label}</span>}
          </div>
        )}
        <p className="mt-2 flex items-center gap-1.5 text-row text-ink-2">
          <Calendar className="h-4 w-4" strokeWidth={1.6} /> {startsLine(vacancy)}
        </p>
        <p className="mt-1 flex items-start gap-1.5 text-secondary text-ink-3">
          <Clock className="mt-0.5 h-[13px] w-[13px] shrink-0" strokeWidth={1.6} /> {postedLine(vacancy, new Date(), closed)}
        </p>
      </div>
      </div>

      {!closed && hasApplied && ownApplicationSlot && (
        <section className="px-5 pt-2">{ownApplicationSlot}</section>
      )}

      {closedView === 'applicant' && status && (
        <section className="px-5 pt-2" data-testid="own-application">
          <div className="rounded-card border border-line bg-white p-3.5">
            <p className="text-secondary font-semibold text-ink-2">Your application</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-caption font-semibold ${APPLICATION_TONE_CLASS[status.tone]}`} data-testid="own-application-status">{status.label}</span>
              {appliedOn && <span className="text-caption text-ink-3">{appliedOn}</span>}
            </div>
            {clubNote && (
              <div className="mt-3 border-t border-line pt-3" data-testid="club-note">
                <p className="text-secondary font-semibold text-ink-2">The club’s note</p>
                <p className="mt-1.5 whitespace-pre-wrap break-words text-row leading-[21px] text-ink-1">{clubNote}</p>
                <p className="mt-1.5 text-caption text-ink-3">From {clubName}</p>
              </div>
            )}
            <button type="button" onClick={() => navigate('/opportunities/applications', { state: { from: location.pathname } })} className="mt-3 text-secondary font-semibold text-hockia-primary">
              View my applications
            </button>
          </div>
        </section>
      )}

      {closedView === 'visitor' && (
        <section className="px-5 pt-2" data-testid="role-closed-notice">
          <div className="rounded-card bg-surface-grouped p-3.5">
            <p className="text-row font-semibold text-ink-1">This role is closed</p>
            <p className="mt-1 text-secondary text-ink-2">It’s no longer taking applications.</p>
            <button type="button" onClick={() => navigate('/opportunities')} className="mt-2.5 text-secondary font-semibold text-hockia-primary">
              See open roles
            </button>
          </div>
        </section>
      )}

      <div className={closed ? 'opacity-60 grayscale' : undefined}>
      {clubNote && !closed && (
        <section className="px-5 pt-3.5" data-testid="club-note">
          <div className="rounded-card bg-surface-grouped p-3.5">
            <p className="text-secondary font-semibold text-ink-2">Not selected · The club’s note</p>
            <p className="mt-1.5 whitespace-pre-wrap text-row leading-[21px] text-ink-1">{clubNote}</p>
            <p className="mt-1.5 text-caption text-ink-3">From {clubName}</p>
          </div>
        </section>
      )}

      <section className="px-5 pt-3.5">
        <h2 className="text-body font-semibold text-ink-1">What the club offers</h2>
        <ul className="mt-1" data-testid="role-offers">
          {compensationKey === 'paid' && <BenefitItem icon={PAID_TILE.icon} tileClass={PAID_TILE.tileClass} title={PAID_TILE.label} detail={PAID_TILE.detail} type="benefit" />}
          {benefits.map((b) => <BenefitItem key={b.key} icon={b.icon} tileClass={b.tileClass} title={b.label} detail={b.detail} type="benefit" />)}
          {/* The club's own package items are real items: a check, not the Note's info icon. */}
          {customBenefits.map((b) => <BenefitItem key={b} icon={Check} tileClass="bg-surface-muted text-ink-1" title={b} type="benefit" />)}
          {compensationKey !== 'paid' && (
            <BenefitItem
              icon={NOTE_TILE.icon}
              tileClass={NOTE_TILE.tileClass}
              title={compensationText(vacancy)}
              detail={!vacancy.compensation && !closed ? 'Ask the club when you apply' : null}
              type="note"
            />
          )}
        </ul>
      </section>

      <section className="px-5 pt-4">
        <h2 className="text-body font-semibold text-ink-1">What the club asks</h2>
        <div className="mt-1">
          {vacancy.opportunity_type === 'player' && vacancy.position && askRow('Position', `${humanizeToken(vacancy.position)}${vacancy.position_required ? ' · required' : ''}`)}
          {vacancy.opportunity_type === 'player' && pill && askRow('Category', pill.label)}
          {askRow('Passport', vacancy.eu_passport_required ? `EU passport required${lacksEuPassport ? ' · you don’t hold one' : ''}` : 'Any')}
          {specialists.length > 0 && askRow('Specialist', (
            <span className="flex flex-wrap justify-end gap-1.5">
              {specialists.map((s) => (
                <span key={s} className="flex items-center gap-1 text-row text-ink-1">
                  <span className={`flex h-5 w-5 items-center justify-center rounded-[6px] ${SPECIALIST_TILE.tileClass}`}><SPECIALIST_TILE.icon className="h-3 w-3" strokeWidth={1.8} /></span>
                  {humanizeToken(s)}
                </span>
              ))}
            </span>
          ))}
          {askRow('Available', startsLine(vacancy).replace(/^Starts /, ''))}
          {!closed && askRow('Apply by', deadlineLine(vacancy).replace(/^Apply by /, ''))}
        </div>
      </section>

      {(vacancy.description?.trim() || (vacancy.requirements ?? []).length > 0) && (
        <section className="px-5 pt-[18px]">
          <h2 className="text-body font-semibold text-ink-1">In the club’s words</h2>
          {vacancy.description?.trim() && <p className="mt-1 whitespace-pre-wrap text-row text-ink-2">“{vacancy.description.trim()}”</p>}
          {(vacancy.requirements ?? []).length > 0 && <p className="mt-2 whitespace-pre-wrap text-row text-ink-2">{(vacancy.requirements ?? []).join(' · ')}</p>}
        </section>
      )}

      <section className="px-5 pb-6 pt-[18px]">
        <h2 className="text-body font-semibold text-ink-1">How applying works</h2>
        <p className="mt-2 text-[14px] leading-[19px] text-ink-2">
          Your Hockia profile is your application — the club sees your career, videos and references. Contact details stay private until the club replies.
        </p>
      </section>
      </div>

      {!isPublisher && !closed && (canApply || hasApplied) && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white px-5 pb-[max(env(safe-area-inset-bottom),0.625rem)] pt-2.5 lg:hidden">
          {hasApplied && status && !notSelected && (
            <div className={`mb-2 flex items-center ${withdrawn ? 'justify-end' : 'justify-between'}`}>
              {!withdrawn && <span className={`rounded-full px-2 py-0.5 text-caption font-semibold ${APPLICATION_TONE_CLASS[status.tone]}`}>{status.label}</span>}
              <button type="button" onClick={() => navigate('/opportunities/applications', { state: { from: location.pathname } })} className="text-secondary font-semibold text-hockia-primary">
                View my applications
              </button>
            </div>
          )}
          <div className="flex items-center gap-2.5">
            <IconButton variant="muted" size="large" label="Message club" onClick={onMessage}>
              <MessageCircle className="h-5 w-5" strokeWidth={1.6} />
            </IconButton>
            {notSelected ? (
              <span className="flex h-12 flex-1 items-center justify-center rounded-full bg-surface-grouped text-body font-semibold text-ink-2" data-testid="not-selected-state">
                Not selected
              </span>
            ) : withdrawn ? (
              <span className="flex h-12 flex-1 items-center justify-center rounded-full bg-surface-grouped text-body font-semibold text-ink-2" data-testid="withdrawn-state">
                Withdrawn
              </span>
            ) : hasApplied ? (
              <span className={buttonClassName({ variant: 'tonal', size: 'large', radius: 'rounded-full', className: 'flex-1' })} data-testid="applied-state">
                <Check className="h-[18px] w-[18px]" strokeWidth={2.5} /> Applied
              </span>
            ) : (
              <button type="button" onClick={onApply} className={buttonClassName({ variant: 'primary', size: 'large', radius: 'rounded-full', className: 'flex-1' })} data-testid="apply-button">
                Apply
              </button>
            )}
          </div>
        </div>
      )}

      {/* Closed role, viewer applied: no Apply, but they can still message
          the club about their application. Visitors get no bar at all. */}
      {closedView === 'applicant' && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white px-5 pb-[max(env(safe-area-inset-bottom),0.625rem)] pt-2.5 lg:hidden" data-testid="closed-message-bar">
          <button type="button" onClick={onMessage} className="flex h-[52px] w-full items-center justify-center gap-2 rounded-full bg-surface-grouped text-body font-semibold text-ink-1 active:opacity-90">
            <MessageCircle className="h-5 w-5" strokeWidth={1.6} /> Message the club
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * List item / Benefit (Figma 543:629): a 32 px tile in the Package colours,
 * title 16 semibold, detail 13 ink-2. Note type = subtle grey tile, check.
 */
function BenefitItem({ icon: Icon, tileClass, title, detail, type }: { icon: LucideIcon; tileClass: string; title: string; detail?: string | null; type: 'benefit' | 'note' }) {
  return (
    <li className="flex items-center gap-3 py-2" data-type={type}>
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-tile ${tileClass}`}><Icon className="h-4 w-4" strokeWidth={1.8} /></span>
      <span className="min-w-0">
        <span className="block text-[16px] font-semibold leading-[21px] text-ink-1">{title}</span>
        {detail && <span className="block text-secondary text-ink-2">{detail}</span>}
      </span>
    </li>
  )
}
