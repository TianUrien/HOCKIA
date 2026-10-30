import { RoleAiEntry } from '@/components/hockiaAi/RoleAiEntry'
import { roleViewerGate } from '@/lib/roleViewerGate'
import { useEffect, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Check, ChevronRight, MessageCircle, Share, X } from 'lucide-react'
import type { Vacancy } from '@/lib/supabase'
import type { CrestPalette } from '@/lib/crestPalette'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { buttonClassName } from '@/components/ui/buttonClasses'
import { MoreMenu } from '@/components/safety/MoreMenu'
import { useReportAction } from '@/components/safety/useReportAction'
import { canReport } from '@/lib/report'
import { useToastStore } from '@/lib/toast'
import { useAuthStore } from '@/lib/auth'
import { useCountries } from '@/hooks/useCountries'
import { checkOpportunityEligibility } from '@/lib/opportunityEligibility'
import { getShareOrigin } from '@/lib/profileShare'
import { humanizeToken, positionLabel } from '@/lib/identity'
import { dayFirst } from '@/lib/dayFirst'
import { setStatusBarForBackground } from '@/lib/nativeUi'
import { getImageUrl } from '@/lib/imageUrl'
import {
  APPLICATION_TONE_CLASS,
  NOTE_TILE,
  PAID_TILE,
  SPECIALIST_TILE,
  specialistIcon,
  type TileIcon,
  applicationStatusPill,
  appliedOnLine,
  categoryFamily,
  categoryTagClass,
  closedRoleView,
  clubNoteFromFeedback,
  closesSoonLabel,
  compensationText,
  formatDurationText,
  genderPill,
  postedOnlyLine,
  roleBenefits,
  roleHeadline,
  CATEGORY_DOT_ON_PHOTO_CLASSES,
} from '@/lib/opportunityCopy'
import { askWhenApplying, asksHeading, messageLabel, offersHeading, onBehalfNote, reviewsLine, roleIdentity, wordsHeading, type RoleIdentity } from '@/lib/opportunityIdentity'
import { daysUntil, isRelevantForViewer, roleStatus } from '@/lib/opportunityRails'
import { CrestTile, GlassChip, RoleCover } from '@/components/opportunities/RoleCover'

interface OpportunityDetailMobileProps {
  vacancy: Vacancy
  clubName: string
  clubLogo: string | null
  clubId: string
  publisherRole: string | null | undefined
  /** Who is behind the role (hiring club + posted by); coach-aware copy (lib/opportunityIdentity). Defaults to the publisher as given. */
  identity?: RoleIdentity
  /** Club palette from the crest for the generated cover (null = Hockia violet). */
  palette?: CrestPalette | null
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
  /** App Store-style × (and Android back): back to where the role was opened. */
  onClose?: () => void
  /** D4: the applicant's own road (Shortlisted → Offer → Signed, Confirm
   *  signing, Withdraw) on an OPEN role. Rendered by the page. */
  ownApplicationSlot?: ReactNode
}

const HERO_HEIGHT = 440

/**
 * Opportunity detail (Figma O2 148:231 / O2b 156:606, Opportunities v2):
 * a 440 pt hero (the role's cover — photo, or generated from the club's
 * crest colours) with the title block pinned to its bottom, then the
 * identity card (HIRING CLUB + POSTED BY when a coach posted), four key
 * facts (Team in the category colour · Position · Starts · Apply by), what
 * the club offers, what they're looking for (+ the viewer's eligibility),
 * the publisher's own words and how applying works, above a fixed glass
 * Message / Apply bar.
 *
 * States kept from v1: after applying a tinted Applied ✓ with a status
 * line; Not this time / Withdrawn as one grey state; a CLOSED role stays
 * readable, greyed, under a "Closed" label with no Apply — an applicant sees
 * their own application block, anyone else "This role is closed".
 */
export function OpportunityDetailMobile({
  vacancy, clubName, clubLogo, clubId, publisherRole, identity: identityProp, palette = null, countryFlag, league, hasApplied, applicationStatus, canApply, isPublisher, isClosed = false, onApply, onMessage, onClose, ownApplicationSlot,
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
  const relevant = isRelevantForViewer(vacancy, { profile, countries })
  const pill = genderPill(vacancy.gender)
  const family = categoryFamily(vacancy.gender)
  const headline = roleHeadline(vacancy)
  const positionText = positionLabel(vacancy.position)
  const city = vacancy.location_city?.trim() || ''
  const country = vacancy.location_country?.trim() || ''
  const identity = identityProp ?? roleIdentity({ publisherRole, publisherName: clubName, publisherAvatar: clubLogo })
  const placeLine = [countryFlag && (city || country) ? `${countryFlag} ${city || country}` : city || country, league].filter(Boolean).join(' · ')
  const benefits = roleBenefits(vacancy)
  const customBenefits = vacancy.custom_benefits ?? []
  const specialists = vacancy.specialist_skills_wanted ?? []
  const status = hasApplied ? applicationStatusPill(applicationStatus ?? 'pending', null, vacancy.status === 'open') : null
  // Players only ever see "Not this time": one grey state in the footer, no chip.
  const notSelected = hasApplied && applicationStatus === 'rejected'
  // Withdrawn (D4): one grey state in the footer too — never next to an "Applied" button.
  const withdrawn = hasApplied && applicationStatus === 'withdrawn'
  const closedView = closedRoleView({ isClosed, hasApplied, isPublisher })
  // Who can act here (audit A7): non-applicants get a plain end note + Message, never apply copy.
  const viewerGate = roleViewerGate({ viewerRole: profile?.role, roleType: vacancy.opportunity_type, isPublisher, signedIn: Boolean(profile) })
  const showApplyCopy = viewerGate.applyCopy || hasApplied
  const closed = closedView !== 'open'
  const roleStat = closed ? null : roleStatus(vacancy)
  const deadlineDays = daysUntil(vacancy.application_deadline)
  const [wordsOpen, setWordsOpen] = useState(false)

  // The hero sits under the status bar: light icons while it is on screen,
  // dark again once the white body scrolls past it (and on unmount). Past the
  // hero a glass strip covers the status bar, or the body text would run
  // under the clock (Android device pass, 2026-10-30).
  const [pastHero, setPastHero] = useState(false)
  useEffect(() => {
    let light = true
    void setStatusBarForBackground('dark-bg')
    const onScroll = () => {
      const shouldBeLight = window.scrollY < HERO_HEIGHT - 80
      if (shouldBeLight !== light) { light = shouldBeLight; setPastHero(!light); void setStatusBarForBackground(light ? 'dark-bg' : 'light-bg') }
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => { window.removeEventListener('scroll', onScroll); void setStatusBarForBackground('light-bg') }
  }, [])

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
      if (!(err instanceof Error && err.name === 'AbortError')) addToast('Could not share this opportunity', 'error')
    }
  }

  const close = () => { if (onClose) onClose(); else navigate('/opportunities') }
  // The publisher's own profile: a club page, or the coach who posted.
  const openPublisher = () => navigate(publisherRole === 'coach' ? `/coaches/id/${clubId}` : `/clubs/id/${clubId}`)

  // Detail row (Figma 148:438): label ink-2 left, value semibold right.
  const askRow = (label: string, value: ReactNode) => (
    <div className="flex items-start justify-between gap-3 border-b-[0.5px] border-line px-3.5 py-3 last:border-b-0" data-testid="ask-row">
      <span className="shrink-0 text-[14px] leading-[19px] text-ink-2">{label}</span>
      <span className="min-w-0 text-right text-[14px] font-semibold leading-[19px] text-ink-1">{value}</span>
    </div>
  )
  const compensationKey = (vacancy.compensation ?? '').toLowerCase()
  const startsValue = (() => {
    if (!vacancy.start_date) return 'Immediately'
    const d = new Date(vacancy.start_date)
    return Number.isNaN(d.getTime()) ? 'Immediately' : d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
  })()
  const duration = formatDurationText(vacancy.duration_text)
  const applyByValue = vacancy.application_deadline ? dayFirst(vacancy.application_deadline, { year: 'never' }) ?? 'Open' : 'Open'
  const applyBySub = vacancy.application_deadline
    ? (deadlineDays !== null && deadlineDays >= 0 ? closesSoonLabel(vacancy.application_deadline) : 'Deadline passed')
    : 'Until filled'
  const eyebrow = [identity.hiringClub?.name ?? clubName, pill?.label].filter(Boolean).join(' · ').toUpperCase()
  const words = vacancy.description?.trim() ?? ''
  const wordsLong = words.length > 260
  const coachRoleLabel = identity.postedBy ? [identity.postedBy.roleLabel ?? 'Coach', identity.hiringClub?.name].filter(Boolean).join(' · ') : null

  return (
    <div className="bg-white pb-[calc(84px+env(safe-area-inset-bottom))]" data-testid="role-detail">
      {pastHero && (
        <div aria-hidden="true" className="fixed inset-x-0 top-0 z-30 bg-white/92 backdrop-blur-[12px] lg:hidden" style={{ height: 'env(safe-area-inset-top)' }} data-testid="role-status-scrim" />
      )}
      {/* Hero: the cover under the status bar, glass controls, the title pinned to the bottom. */}
      <RoleCover coverUrl={vacancy.cover_url} crestUrl={identity.displayLogo} palette={palette} scrim="hero" className="w-full" style={{ height: HERO_HEIGHT }}>
        <div className="absolute right-4 flex items-center gap-2.5" style={{ top: 'calc(env(safe-area-inset-top) + 8px)' }}>
          <button type="button" onClick={() => void share()} aria-label="Share" className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22)] backdrop-blur-[10px] before:absolute before:-inset-1 before:content-['']" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}>
            <Share className="h-[18px] w-[18px]" strokeWidth={1.8} />
          </button>
          {showMore && (
            <span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22)] backdrop-blur-[10px]" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}>
              <MoreMenu items={[report.item]} label="More options" title={vacancy.title ?? undefined} triggerClassName="flex h-9 w-9 items-center justify-center rounded-full text-white" iconClassName="h-[18px] w-[18px]" testId="role-more-menu" />
            </span>
          )}
          <button type="button" onClick={close} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-full border border-white/20 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22)] backdrop-blur-[10px]" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }} data-testid="role-close">
            <X className="h-[18px] w-[18px]" strokeWidth={2} />
          </button>
        </div>
        <div className="absolute inset-x-4 bottom-5 flex flex-col gap-2.5">
          {eyebrow && <p className="text-caption font-semibold tracking-[0.04em] text-white/85" data-testid="role-eyebrow">{eyebrow}</p>}
          <h1 className="break-words text-title-xl text-white" data-testid="role-title">{headline.title}</h1>
          <div className="flex flex-wrap gap-1.5" data-testid="role-detail-meta">
            {positionText && <GlassChip testId="role-detail-position">{positionText}</GlassChip>}
            {pill && family && <GlassChip dotClass={CATEGORY_DOT_ON_PHOTO_CLASSES[family]} testId="role-detail-team-tag">{pill.label}</GlassChip>}
            {roleStat && <GlassChip testId="role-detail-status">{roleStat.label}</GlassChip>}
            {closed && <GlassChip testId="role-closed-label">Closed</GlassChip>}
          </div>
        </div>
      </RoleCover>
      {report.sheet}

      {/* Who is hiring (+ who posted) */}
      <div className="px-4 pt-4">
        <div className="overflow-hidden rounded-[20px] bg-surface-subtle" data-testid="role-identity-card">
          <button type="button" onClick={openPublisher} className="flex w-full items-center gap-3 py-3 pl-3.5 pr-3 text-left active:bg-surface-muted-pressed" data-testid="role-club-row">
            {identity.hiringClub
              ? <CrestTile src={identity.hiringClub.logo} name={identity.hiringClub.name} size={48} radius={14} />
              : <EntityAvatar src={identity.displayLogo} name={identity.displayName} role="coach" size={48} />}
            <span className="min-w-0 flex-1">
              <span className="block text-micro font-semibold uppercase tracking-[0.02em] text-ink-3">{identity.hiringClub ? 'Hiring club' : 'Coach'}</span>
              <span className="block truncate text-[16px] font-semibold leading-[21px] text-ink-1">{identity.displayName}</span>
              {placeLine && <span className="block truncate text-secondary text-ink-2">{placeLine}</span>}
            </span>
            {(identity.kind !== 'coach-for-club') && <ChevronRight className="h-4 w-4 shrink-0 text-ink-4" strokeWidth={1.8} />}
          </button>
          {identity.kind === 'coach-for-club' && identity.postedBy && (
            <>
              <div className="mx-3.5 h-[0.5px] bg-line" />
              <button type="button" onClick={openPublisher} className="flex w-full items-center gap-3 py-3 pl-3.5 pr-3 text-left active:bg-surface-muted-pressed" data-testid="role-posted-by">
                <EntityAvatar src={identity.postedBy.avatar ? getImageUrl(identity.postedBy.avatar, 'avatar-md') ?? identity.postedBy.avatar : null} name={identity.postedBy.name} role="coach" size={48} />
                <span className="min-w-0 flex-1">
                  <span className="block text-micro font-semibold uppercase tracking-[0.02em] text-ink-3">Posted by</span>
                  <span className="block truncate text-[16px] font-semibold leading-[21px] text-ink-1">{identity.postedBy.name}</span>
                  {coachRoleLabel && <span className="block truncate text-secondary text-ink-2">{coachRoleLabel}</span>}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-ink-4" strokeWidth={1.8} />
              </button>
            </>
          )}
        </div>
        {onBehalfNote(identity) && <p className="pt-2 text-caption text-ink-3">{onBehalfNote(identity)}</p>}
        <p className="pt-2 text-caption text-ink-3">{postedOnlyLine(vacancy, new Date(), closed)}</p>
      </div>

      {!closed && !isPublisher && (
        <div className="px-4 pt-3"><RoleAiEntry vacancy={vacancy} clubName={identity.hiringClub?.name ?? clubName} clubLogo={identity.displayLogo ?? clubLogo} /></div>
      )}

      {!closed && hasApplied && ownApplicationSlot && (
        <section className="px-4 pt-3">{ownApplicationSlot}</section>
      )}

      {closedView === 'applicant' && status && (
        <section className="px-4 pt-3" data-testid="own-application">
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
        <section className="px-4 pt-3" data-testid="role-closed-notice">
          <div className="rounded-card bg-surface-grouped p-3.5">
            <p className="text-row font-semibold text-ink-1">This opportunity is closed</p>
            <p className="mt-1 text-secondary text-ink-2">It’s no longer taking applications.</p>
            <button type="button" onClick={() => navigate('/opportunities')} className="mt-2.5 text-secondary font-semibold text-hockia-primary">
              See open opportunities
            </button>
          </div>
        </section>
      )}

      <div className={closed ? 'opacity-60 grayscale' : undefined} data-testid={closed ? 'role-body-closed' : undefined}>
      {clubNote && !closed && (
        <section className="px-4 pt-3.5" data-testid="club-note">
          <div className="rounded-card bg-surface-grouped p-3.5">
            <p className="text-secondary font-semibold text-ink-2">Not this time · The club’s note</p>
            <p className="mt-1.5 whitespace-pre-wrap text-row leading-[21px] text-ink-1">{clubNote}</p>
            <p className="mt-1.5 text-caption text-ink-3">From {clubName}</p>
          </div>
        </section>
      )}

      {/* Key facts (Figma 148:397): Team in the category colour, never elsewhere. */}
      <section className="grid grid-cols-2 gap-2.5 px-4 pt-5" data-testid="role-key-facts">
        {pill && (
          <Fact label="Team" value={pill.label} sub={league ?? (vacancy.opportunity_type === 'coach' ? 'Coaching opportunity' : 'Senior')} className={categoryTagClass(vacancy.gender) ?? 'bg-surface-subtle text-ink-1'} tinted />
        )}
        {positionText && <Fact label="Position" value={positionText} sub={vacancy.opportunity_type === 'coach' ? 'Coaching opportunity' : vacancy.position_required ? 'Required' : null} />}
        <Fact label="Starts" value={startsValue} sub={duration} />
        <Fact label="Apply by" value={applyByValue} sub={applyBySub} />
      </section>

      <section className="px-4 pt-7">
        <h2 className="text-[20px] font-semibold leading-6 tracking-[-0.02em] text-ink-1">{offersHeading(identity)}</h2>
        <ul className="mt-2" data-testid="role-offers">
          {compensationKey === 'paid' && <BenefitItem icon={PAID_TILE.icon} tileClass={PAID_TILE.tileClass} title={PAID_TILE.label} detail={PAID_TILE.detail} type="benefit" />}
          {benefits.map((b) => <BenefitItem key={b.key} icon={b.icon} tileClass={b.tileClass} title={b.label} detail={b.detail} type="benefit" />)}
          {/* The club's own package items are real items: a check, not the Note's info icon. */}
          {customBenefits.map((b) => <BenefitItem key={b} icon={Check} tileClass="bg-surface-muted text-ink-1" title={b} type="benefit" />)}
          {compensationKey !== 'paid' && (
            <BenefitItem
              icon={NOTE_TILE.icon}
              tileClass={NOTE_TILE.tileClass}
              title={compensationText(vacancy)}
              detail={!vacancy.compensation && !closed && showApplyCopy ? askWhenApplying(identity) : null}
              type="note"
            />
          )}
        </ul>
      </section>

      <section className="px-4 pt-7">
        <h2 className="text-[20px] font-semibold leading-6 tracking-[-0.02em] text-ink-1">{asksHeading(identity)}</h2>
        <div className="mt-3 overflow-hidden rounded-[16px] bg-surface-subtle" data-testid="role-asks">
          {vacancy.opportunity_type === 'player' && vacancy.position && askRow('Position', `${humanizeToken(vacancy.position)}${vacancy.position_required ? ' · required' : ''}`)}
          {vacancy.opportunity_type === 'player' && pill && askRow('Category', pill.label)}
          {askRow('Passport', vacancy.eu_passport_required ? `EU passport required${lacksEuPassport ? ' · you don’t hold one' : ''}` : 'Any')}
          {vacancy.level_sought && askRow('Level', humanizeToken(vacancy.level_sought))}
          {specialists.length > 0 && askRow('Specialist', (
            <span className="flex flex-wrap justify-end gap-1.5">
              {specialists.map((s) => (
                <span key={s} className="flex items-center gap-1 text-[14px] leading-[19px] text-ink-1">
                  <span className={`flex h-5 w-5 items-center justify-center rounded-[6px] ${SPECIALIST_TILE.tileClass}`}>{(() => { const SkillIcon = specialistIcon(s); return <SkillIcon className="h-3 w-3" strokeWidth={1.8} /> })()}</span>
                  {humanizeToken(s)}
                </span>
              ))}
            </span>
          ))}
          {askRow('Available', `${startsValue}${duration ? ` · ${duration}` : ''}`)}
        </div>
        {!closed && !isPublisher && relevant && (
          <p className="mt-3 flex items-center gap-2 rounded-[12px] bg-positive-soft px-3 py-2.5 text-secondary text-positive" data-testid="role-eligibility">
            <Check className="h-4 w-4 shrink-0" strokeWidth={2.5} /> You match this opportunity’s position, team and passport
          </p>
        )}
      </section>

      {(words || (vacancy.requirements ?? []).length > 0) && (
        <section className="px-4 pt-7">
          <h2 className="text-[20px] font-semibold leading-6 tracking-[-0.02em] text-ink-1">{wordsHeading(identity)}</h2>
          {words && <p className={`mt-2 whitespace-pre-wrap text-[16px] leading-[22px] text-ink-1 ${wordsLong && !wordsOpen ? 'line-clamp-5' : ''}`} data-testid="role-words">{words}</p>}
          {wordsLong && (
            <button type="button" onClick={() => setWordsOpen((o) => !o)} className="mt-1.5 text-secondary font-semibold text-brand-primary" aria-expanded={wordsOpen}>{wordsOpen ? 'Less' : 'More'}</button>
          )}
          {(vacancy.requirements ?? []).length > 0 && <p className="mt-2 whitespace-pre-wrap text-row text-ink-2">{(vacancy.requirements ?? []).join(' · ')}</p>}
        </section>
      )}

      {!showApplyCopy && !closed && viewerGate.note && (
        <section className="px-4 pb-6 pt-7">
          <p className="rounded-[12px] bg-surface-subtle px-3.5 py-3 text-row text-ink-2" data-testid="role-viewer-note">{viewerGate.note}</p>
        </section>
      )}

      {showApplyCopy && (
      <section className="px-4 pb-6 pt-7">
        <h2 className="text-[20px] font-semibold leading-6 tracking-[-0.02em] text-ink-1">How applying works</h2>
        <ol className="mt-3 flex flex-col gap-3">
          {['Send your profile, no CV needed', reviewsLine(identity), 'You’ll see every update in Applied'].map((step, i) => (
            <li key={step} className="flex items-center gap-3 text-[14px] leading-[19px] text-ink-1">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-muted text-secondary font-semibold text-ink-1">{i + 1}</span>
              {step}
            </li>
          ))}
        </ol>
        <p className="mt-3 text-caption text-ink-3">Contact details stay private until the club replies.</p>
      </section>
      )}
      </div>

      {!isPublisher && !closed && (canApply || hasApplied) && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t-[0.5px] border-line bg-white/92 px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3 backdrop-blur-[12px] lg:hidden" data-testid="role-action-bar">
          {/* Status chip (rebrand page 20): In review violet, Shortlisted green,
              Not this time / Withdrawn neutral grey, never a red or a grey bar. */}
          {hasApplied && status && (
            <div className="mb-2 flex items-center justify-between">
              <span className={`rounded-full px-2.5 py-1 text-caption font-semibold ${APPLICATION_TONE_CLASS[status.tone]}`} data-testid={notSelected ? 'not-selected-state' : withdrawn ? 'withdrawn-state' : undefined}>{status.label}</span>
              <button type="button" onClick={() => navigate('/opportunities/applications', { state: { from: location.pathname } })} className="text-secondary font-semibold text-hockia-primary">
                View my applications
              </button>
            </div>
          )}
          {notSelected || withdrawn ? (
            // The application ended: the chip above says so; the club can still be messaged.
            <button type="button" onClick={onMessage} className="flex h-[52px] w-full items-center justify-center gap-2 rounded-full border border-line bg-white text-body font-semibold text-ink-1 active:bg-surface-muted-pressed" data-testid="role-message">
              <MessageCircle className="h-5 w-5" strokeWidth={1.6} /> {messageLabel(identity)}
            </button>
          ) : (
          <div className="flex items-center gap-2.5">
            <button type="button" onClick={onMessage} aria-label={identity.postedBy ? messageLabel(identity) : 'Message club'} className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full border border-line bg-white text-ink-1 active:bg-surface-muted-pressed" data-testid="role-message">
              <MessageCircle className="h-[22px] w-[22px]" strokeWidth={1.6} />
            </button>
            {hasApplied ? (
              <span className={buttonClassName({ variant: 'tonal', size: 'large', radius: 'rounded-full', className: 'flex-1' })} data-testid="applied-state">
                <Check className="h-[18px] w-[18px]" strokeWidth={2.5} /> Applied
              </span>
            ) : (
              <button type="button" onClick={onApply} className={buttonClassName({ variant: 'primary', size: 'large', radius: 'rounded-full', className: 'flex-1' })} data-testid="role-apply">
                Apply
              </button>
            )}
          </div>
          )}
        </div>
      )}

      {/* Can't apply here (coach on a player role, brand, umpire): Message only (audit A7). */}
      {!isPublisher && !closed && !canApply && !hasApplied && viewerGate.messageOnly && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t-[0.5px] border-line bg-white/92 px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3 backdrop-blur-[12px] lg:hidden" data-testid="role-message-bar">
          <button type="button" onClick={onMessage} className="flex h-[52px] w-full items-center justify-center gap-2 rounded-full border border-line bg-white text-body font-semibold text-ink-1 active:opacity-90">
            <MessageCircle className="h-5 w-5" strokeWidth={1.6} /> {messageLabel(identity)}
          </button>
        </div>
      )}

      {/* Closed role, viewer applied: no Apply, but they can still message
          the club about their application. Visitors get no bar at all. */}
      {closedView === 'applicant' && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t-[0.5px] border-line bg-white/92 px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-3 backdrop-blur-[12px] lg:hidden" data-testid="closed-message-bar">
          <button type="button" onClick={onMessage} className="flex h-[52px] w-full items-center justify-center gap-2 rounded-full bg-surface-grouped text-body font-semibold text-ink-1 active:opacity-90">
            <MessageCircle className="h-5 w-5" strokeWidth={1.6} /> {messageLabel(identity)}
          </button>
        </div>
      )}
    </div>
  )
}

/** Key fact tile (Figma 148:399): 11 label · 16 value · 13 sub, r12. */
export function Fact({ label, value, sub, className, tinted = false }: { label: string; value: string; sub?: string | null; className?: string; tinted?: boolean }) {
  return (
    <div className={`flex flex-col gap-0.5 rounded-[12px] px-3.5 py-3 ${className ?? 'bg-surface-subtle'}`} data-testid="role-fact">
      <span className={`text-micro font-semibold uppercase tracking-[0.02em] ${tinted ? '' : 'text-ink-3'}`}>{label}</span>
      <span className={`truncate text-[16px] font-semibold leading-[21px] ${tinted ? '' : 'text-ink-1'}`}>{value}</span>
      {sub && <span className={`truncate text-secondary ${tinted ? 'opacity-90' : 'text-ink-2'}`}>{sub}</span>}
    </div>
  )
}

/**
 * List item / Benefit (Figma 148:418): a 40 px tile in the Package colours,
 * title 16 semibold, detail 13 ink-2. Note type = subtle grey tile, info.
 */
export function BenefitItem({ icon: Icon, tileClass, title, detail, type, className }: { icon: TileIcon; tileClass: string; title: string; detail?: string | null; type: 'benefit' | 'note'; className?: string }) {
  return (
    <li className={className ?? 'flex items-center gap-3 py-2'} data-type={type}>
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] ${tileClass}`}><Icon className="h-[18px] w-[18px]" strokeWidth={1.8} /></span>
      <span className="min-w-0">
        <span className="block text-[16px] font-semibold leading-[21px] text-ink-1">{title}</span>
        {detail && <span className="block text-secondary text-ink-2">{detail}</span>}
      </span>
    </li>
  )
}
