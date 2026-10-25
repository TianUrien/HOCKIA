import { RoleAiEntry } from '@/components/hockiaAi/RoleAiEntry'
import { roleViewerGate } from '@/lib/roleViewerGate'
import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Check, ChevronLeft, ChevronRight, MessageCircle, Share } from 'lucide-react'
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
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { checkOpportunityEligibility } from '@/lib/opportunityEligibility'
import { humanizeToken, positionLabel } from '@/lib/identity'
import { getImageUrl } from '@/lib/imageUrl'
import {
  APPLICATION_TONE_CLASS, CATEGORY_DOT_CLASSES, NOTE_TILE, PAID_TILE, SPECIALIST_TILE, applicationStatusPill, appliedOnLine, categoryFamily, categoryTagClass, closedRoleView,
  compensationText, genderPill, postedOnlyLine, roleBenefits, roleHeadline,
} from '@/lib/opportunityCopy'
import { askWhenApplying, asksHeading, messageLabel, offersHeading, onBehalfNote, reviewsLine, roleIdentity, wordsHeading, type RoleIdentity } from '@/lib/opportunityIdentity'
import { isRelevantForViewer, roleStatus } from '@/lib/opportunityRails'
import { CrestTile, GlassChip, RoleCover } from '@/components/opportunities/RoleCover'
import { BenefitItem, Fact } from '@/components/opportunities/OpportunityDetailMobile'
import { roleDates, shareRole, useOwnApplicationRow } from '@/components/opportunities/roleDetailShared'

export interface OpportunityDetailDesktopProps {
  vacancy: Vacancy
  clubName: string
  clubLogo: string | null
  clubId: string
  publisherRole: string | null | undefined
  identity?: RoleIdentity
  palette?: CrestPalette | null
  countryFlag: string | null
  league: string | null
  hasApplied: boolean
  applicationStatus: string | null
  canApply: boolean
  isPublisher: boolean
  isClosed?: boolean
  onApply: () => void
  onMessage: () => void
  /** "‹ Opportunities": back to where the role was opened. */
  onClose?: () => void
  ownApplicationSlot?: ReactNode
}

const GLASS_BUTTON = 'flex h-9 w-9 items-center justify-center rounded-full border border-white/20 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22)] backdrop-blur-[10px] transition-colors hover:bg-black/50'
const H2 = 'text-[22px] font-bold leading-[27px] tracking-[-0.01em] text-ink-1'
const CARD = 'rounded-[16px] border-[0.5px] border-line bg-white'

/**
 * Role page on desktop (Figma D2 194:885, ≥ 1024): the role opens as a PAGE,
 * not the phone expansion. Left column (420, 360 at 1024–1199) is sticky:
 * the cover 420×520 with the title block, then Apply 52 + Message. Right
 * column: identity (hiring club | posted by), four facts in one row, what the
 * club offers 3-up, what they're looking for as a table, the publisher's
 * words at Body L, how applying works 3-up. Same states as the phone page:
 * Applied ✓ with the status line, Not this time / Withdrawn, a closed role
 * greyed under "Closed" with the viewer's own application block.
 */
export function OpportunityDetailDesktop({
  vacancy, clubName, clubLogo, clubId, publisherRole, identity: identityProp, palette = null, countryFlag, league, hasApplied, applicationStatus, canApply, isPublisher, isClosed = false, onApply, onMessage, onClose, ownApplicationSlot,
}: OpportunityDetailDesktopProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const addToast = useToastStore((s) => s.addToast)
  const profile = useAuthStore((s) => s.profile)
  const { countries } = useCountries()
  const wide = useMediaQuery('(min-width: 1200px)')
  const report = useReportAction({ targetId: vacancy.club_id, subject: 'role', contentId: vacancy.id })
  const showMore = !isPublisher && canReport(profile?.id, vacancy.club_id)
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
  const notSelected = hasApplied && applicationStatus === 'rejected'
  const withdrawn = hasApplied && applicationStatus === 'withdrawn'
  const closedView = closedRoleView({ isClosed, hasApplied, isPublisher })
  // Who can act here (audit A7): non-applicants get a plain note + Message, never apply copy.
  const viewerGate = roleViewerGate({ viewerRole: profile?.role, roleType: vacancy.opportunity_type, isPublisher, signedIn: Boolean(profile) })
  const showApplyCopy = viewerGate.applyCopy || hasApplied
  const closed = closedView !== 'open'
  const roleStat = closed ? null : roleStatus(vacancy)
  const { startsValue, duration, applyByValue, applyBySub } = roleDates(vacancy)
  const userId = profile?.id ?? null
  const needsOwnRow = hasApplied && !!userId && (applicationStatus === 'rejected' || closed)
  const { clubNote, appliedAt } = useOwnApplicationRow(vacancy.id, userId, needsOwnRow, applicationStatus)
  const appliedOn = appliedOnLine(appliedAt)
  const compensationKey = (vacancy.compensation ?? '').toLowerCase()
  const eyebrow = [identity.hiringClub?.name ?? clubName, pill?.label].filter(Boolean).join(' · ').toUpperCase()
  const words = vacancy.description?.trim() ?? ''
  const coachRoleLabel = identity.postedBy ? [identity.postedBy.roleLabel ?? 'Coach', identity.hiringClub?.name].filter(Boolean).join(' · ') : null
  const showPostedBy = identity.kind === 'coach-for-club' && !!identity.postedBy

  const back = () => { if (onClose) onClose(); else navigate('/opportunities') }
  const openPublisher = () => navigate(publisherRole === 'coach' ? `/coaches/id/${clubId}` : `/clubs/id/${clubId}`)
  const goApplications = () => navigate('/opportunities/applications', { state: { from: location.pathname } })

  const askRow = (label: string, value: ReactNode) => (
    <div className="flex items-start justify-between gap-6 border-b-[0.5px] border-line px-4 py-3 last:border-b-0" data-testid="ask-row">
      <span className="shrink-0 text-[14px] leading-[19px] text-ink-2">{label}</span>
      <span className="min-w-0 text-right text-[14px] font-semibold leading-[19px] text-ink-1">{value}</span>
    </div>
  )
  const benefitCard = `${CARD} flex items-center gap-3 px-3.5 py-3`

  return (
    <div className="mx-auto w-full max-w-[1232px] px-4 pb-20 pt-4" data-testid="role-detail-desktop">
      <button type="button" onClick={back} className="inline-flex h-9 items-center gap-0.5 text-[14px] font-semibold leading-[19px] text-brand-primary hover:underline" data-testid="role-close">
        <ChevronLeft className="h-4 w-4" strokeWidth={2.2} /> Opportunities
      </button>
      {report.sheet}

      <div className="mt-3 grid gap-10" style={{ gridTemplateColumns: `${wide ? 420 : 360}px minmax(0, 1fr)` }}>
        {/* Left column: sticky cover + actions */}
        <aside className="sticky top-[88px] self-start" data-testid="role-detail-aside">
          <RoleCover coverUrl={vacancy.cover_url} crestUrl={identity.displayLogo} palette={palette} scrim="hero" className="rounded-[28px] shadow-[0_12px_30px_rgba(0,0,0,0.12)]" style={{ height: wide ? 520 : 460 }}>
            <div className="absolute right-4 top-4 flex items-center gap-2.5">
              <button type="button" onClick={() => void shareRole(vacancy, `${headline.title} · ${clubName}`, addToast)} aria-label="Share" className={GLASS_BUTTON} style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}>
                <Share className="h-[18px] w-[18px]" strokeWidth={1.8} />
              </button>
              {showMore && (
                <span className={GLASS_BUTTON} style={{ backgroundColor: 'rgba(0,0,0,0.35)' }}>
                  <MoreMenu items={[report.item]} label="More options" title={vacancy.title ?? undefined} triggerClassName="flex h-9 w-9 items-center justify-center rounded-full text-white" iconClassName="h-[18px] w-[18px]" testId="role-more-menu" />
                </span>
              )}
            </div>
            <div className="absolute inset-x-6 bottom-6 flex flex-col gap-2.5">
              {eyebrow && <p className="text-caption font-semibold tracking-[0.04em] text-white/85" data-testid="role-eyebrow">{eyebrow}</p>}
              <h1 className="break-words text-[28px] font-bold leading-[34px] tracking-[-0.015em] text-white" data-testid="role-title">{headline.title}</h1>
              <div className="flex flex-wrap gap-1.5" data-testid="role-detail-meta">
                {positionText && <GlassChip testId="role-detail-position">{positionText}</GlassChip>}
                {pill && family && <GlassChip dotClass={CATEGORY_DOT_CLASSES[family]} testId="role-detail-team-tag">{pill.label}</GlassChip>}
                {roleStat && <GlassChip testId="role-detail-status">{roleStat.label}</GlassChip>}
                {closed && <GlassChip testId="role-closed-label">Closed</GlassChip>}
              </div>
            </div>
          </RoleCover>

          {!isPublisher && !closed && (canApply || hasApplied) && (
            <div className="mt-4" data-testid="role-action-bar">
              {hasApplied && status && !notSelected && (
                <div className={`mb-2.5 flex items-center ${withdrawn ? 'justify-end' : 'justify-between'}`}>
                  {!withdrawn && <span className={`rounded-full px-2 py-0.5 text-caption font-semibold ${APPLICATION_TONE_CLASS[status.tone]}`}>{status.label}</span>}
                  <button type="button" onClick={goApplications} className="text-secondary font-semibold text-hockia-primary hover:underline">View my applications</button>
                </div>
              )}
              <div className="flex items-center gap-3">
                {notSelected ? (
                  <span className="flex h-[52px] flex-1 items-center justify-center rounded-full bg-surface-grouped text-body font-semibold text-ink-2" data-testid="not-selected-state">Not this time</span>
                ) : withdrawn ? (
                  <span className="flex h-[52px] flex-1 items-center justify-center rounded-full bg-surface-grouped text-body font-semibold text-ink-2" data-testid="withdrawn-state">Withdrawn</span>
                ) : hasApplied ? (
                  <span className={buttonClassName({ variant: 'tonal', size: 'large', radius: 'rounded-full', className: 'flex-1' })} data-testid="applied-state">
                    <Check className="h-[18px] w-[18px]" strokeWidth={2.5} /> Applied
                  </span>
                ) : (
                  <button type="button" onClick={onApply} className={buttonClassName({ variant: 'primary', size: 'large', radius: 'rounded-full', className: 'flex-1' })} data-testid="role-apply">Apply</button>
                )}
                <button type="button" onClick={onMessage} className="inline-flex h-[52px] shrink-0 items-center justify-center gap-2 rounded-full border border-line bg-white px-5 text-[16px] font-semibold text-ink-1 transition-colors hover:bg-surface-subtle" data-testid="role-message">
                  <MessageCircle className="h-5 w-5" strokeWidth={1.6} /> {messageLabel(identity)}
                </button>
              </div>
            </div>
          )}

          {!isPublisher && !closed && !canApply && !hasApplied && viewerGate.messageOnly && (
            <div className="mt-4 flex flex-col gap-3" data-testid="role-message-bar">
              {viewerGate.note && <p className="rounded-[12px] bg-surface-subtle px-3.5 py-3 text-row text-ink-2" data-testid="role-viewer-note">{viewerGate.note}</p>}
              <button type="button" onClick={onMessage} className="inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-full border border-line bg-white text-[16px] font-semibold text-ink-1 hover:bg-surface-muted">
                <MessageCircle className="h-5 w-5" strokeWidth={1.6} /> {messageLabel(identity)}
              </button>
            </div>
          )}

          {closedView === 'open' && !isPublisher && (
            <div className="mt-4"><RoleAiEntry vacancy={vacancy} clubName={identity.hiringClub?.name ?? clubName} clubLogo={identity.displayLogo ?? clubLogo} /></div>
          )}

          {closedView === 'applicant' && (
            <div className="mt-4" data-testid="closed-message-bar">
              <button type="button" onClick={onMessage} className="flex h-[52px] w-full items-center justify-center gap-2 rounded-full bg-surface-grouped text-body font-semibold text-ink-1 transition-opacity hover:opacity-90">
                <MessageCircle className="h-5 w-5" strokeWidth={1.6} /> {messageLabel(identity)}
              </button>
            </div>
          )}
        </aside>

        {/* Right column */}
        <section className="min-w-0">
          <div className="grid overflow-hidden rounded-[20px] bg-surface-subtle" style={{ gridTemplateColumns: showPostedBy ? '1fr 1fr' : '1fr' }} data-testid="role-identity-card">
            <button type="button" onClick={openPublisher} className="flex min-w-0 items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-muted" data-testid="role-club-row">
              {identity.hiringClub
                ? <CrestTile src={identity.hiringClub.logo} name={identity.hiringClub.name} size={48} radius={14} />
                : <EntityAvatar src={identity.displayLogo} name={identity.displayName} role="coach" size={48} />}
              <span className="min-w-0 flex-1">
                <span className="block text-micro font-semibold uppercase tracking-[0.02em] text-ink-3">{identity.hiringClub ? 'Hiring club' : 'Coach'}</span>
                <span className="block truncate text-[16px] font-semibold leading-[21px] text-ink-1">{identity.displayName}</span>
                {placeLine && <span className="block truncate text-secondary text-ink-2">{placeLine}</span>}
              </span>
              {!showPostedBy && <ChevronRight className="h-4 w-4 shrink-0 text-ink-4" strokeWidth={1.8} />}
            </button>
            {showPostedBy && identity.postedBy && (
              <button type="button" onClick={openPublisher} className="flex min-w-0 items-center gap-3 border-l-[0.5px] border-line px-4 py-3.5 text-left transition-colors hover:bg-surface-muted" data-testid="role-posted-by">
                <EntityAvatar src={identity.postedBy.avatar ? getImageUrl(identity.postedBy.avatar, 'avatar-md') ?? identity.postedBy.avatar : null} name={identity.postedBy.name} role="coach" size={48} />
                <span className="min-w-0 flex-1">
                  <span className="block text-micro font-semibold uppercase tracking-[0.02em] text-ink-3">Posted by</span>
                  <span className="block truncate text-[16px] font-semibold leading-[21px] text-ink-1">{identity.postedBy.name}</span>
                  {coachRoleLabel && <span className="block truncate text-secondary text-ink-2">{coachRoleLabel}</span>}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-ink-4" strokeWidth={1.8} />
              </button>
            )}
          </div>
          {onBehalfNote(identity) && <p className="pt-2 text-caption text-ink-3">{onBehalfNote(identity)}</p>}
          <p className="pt-2 text-caption text-ink-3">{postedOnlyLine(vacancy, new Date(), closed)}</p>

          {!closed && hasApplied && ownApplicationSlot && <section className="pt-4">{ownApplicationSlot}</section>}

          {closedView === 'applicant' && status && (
            <section className="pt-4" data-testid="own-application">
              <div className="rounded-card border border-line bg-white p-4">
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
                <button type="button" onClick={goApplications} className="mt-3 text-secondary font-semibold text-hockia-primary hover:underline">View my applications</button>
              </div>
            </section>
          )}

          {closedView === 'visitor' && (
            <section className="pt-4" data-testid="role-closed-notice">
              <div className="rounded-card bg-surface-grouped p-4">
                <p className="text-row font-semibold text-ink-1">This opportunity is closed</p>
                <p className="mt-1 text-secondary text-ink-2">It’s no longer taking applications.</p>
                <button type="button" onClick={() => navigate('/opportunities')} className="mt-2.5 text-secondary font-semibold text-hockia-primary hover:underline">See open opportunities</button>
              </div>
            </section>
          )}

          <div className={closed ? 'opacity-60 grayscale' : undefined} data-testid={closed ? 'role-body-closed' : undefined}>
            {clubNote && !closed && (
              <section className="pt-4" data-testid="club-note">
                <div className="rounded-card bg-surface-grouped p-4">
                  <p className="text-secondary font-semibold text-ink-2">Not this time · The club’s note</p>
                  <p className="mt-1.5 whitespace-pre-wrap text-row leading-[21px] text-ink-1">{clubNote}</p>
                  <p className="mt-1.5 text-caption text-ink-3">From {clubName}</p>
                </div>
              </section>
            )}

            {/* Four facts in one row (Figma 194:946): Team in the category colour, never elsewhere. */}
            <section className="grid grid-cols-4 gap-3 pt-6" data-testid="role-key-facts">
              {pill && (
                <Fact label="Team" value={pill.label} sub={league ?? (vacancy.opportunity_type === 'coach' ? 'Coaching opportunity' : 'Senior')} className={categoryTagClass(vacancy.gender) ?? 'bg-surface-subtle text-ink-1'} tinted />
              )}
              {positionText && <Fact label="Position" value={positionText} sub={vacancy.opportunity_type === 'coach' ? 'Coaching opportunity' : vacancy.position_required ? 'Required' : null} />}
              <Fact label="Starts" value={startsValue} sub={duration} />
              <Fact label="Apply by" value={applyByValue} sub={applyBySub} />
            </section>

            <section className="pt-9">
              <h2 className={H2}>{offersHeading(identity)}</h2>
              <ul className="mt-3.5 grid grid-cols-3 gap-3" data-testid="role-offers">
                {compensationKey === 'paid' && <BenefitItem icon={PAID_TILE.icon} tileClass={PAID_TILE.tileClass} title={PAID_TILE.label} detail={PAID_TILE.detail} type="benefit" className={benefitCard} />}
                {benefits.map((b) => <BenefitItem key={b.key} icon={b.icon} tileClass={b.tileClass} title={b.label} detail={b.detail} type="benefit" className={benefitCard} />)}
                {customBenefits.map((b) => <BenefitItem key={b} icon={Check} tileClass="bg-surface-muted text-ink-1" title={b} type="benefit" className={benefitCard} />)}
                {compensationKey !== 'paid' && (
                  <BenefitItem icon={NOTE_TILE.icon} tileClass={NOTE_TILE.tileClass} title={compensationText(vacancy)} detail={!vacancy.compensation && !closed && showApplyCopy ? askWhenApplying(identity) : null} type="note" className={benefitCard} />
                )}
              </ul>
            </section>

            <section className="pt-9">
              <h2 className={H2}>{asksHeading(identity)}</h2>
              <div className="mt-3.5 overflow-hidden rounded-[16px] bg-surface-subtle" data-testid="role-asks">
                {vacancy.opportunity_type === 'player' && vacancy.position && askRow('Position', `${humanizeToken(vacancy.position)}${vacancy.position_required ? ' · required' : ''}`)}
                {vacancy.opportunity_type === 'player' && pill && askRow('Category', pill.label)}
                {askRow('Passport', vacancy.eu_passport_required ? `EU passport required${lacksEuPassport ? ' · you don’t hold one' : ''}` : 'Any')}
                {vacancy.level_sought && askRow('Level', humanizeToken(vacancy.level_sought))}
                {specialists.length > 0 && askRow('Specialist', (
                  <span className="flex flex-wrap justify-end gap-1.5">
                    {specialists.map((s) => (
                      <span key={s} className="flex items-center gap-1 text-[14px] leading-[19px] text-ink-1">
                        <span className={`flex h-5 w-5 items-center justify-center rounded-[6px] ${SPECIALIST_TILE.tileClass}`}><SPECIALIST_TILE.icon className="h-3 w-3" strokeWidth={1.8} /></span>
                        {humanizeToken(s)}
                      </span>
                    ))}
                  </span>
                ))}
                {askRow('Available', `${startsValue}${duration ? ` · ${duration}` : ''}`)}
              </div>
              {!closed && !isPublisher && relevant && (
                <p className="mt-3 flex items-center gap-2 rounded-[12px] bg-positive-soft px-3.5 py-2.5 text-secondary text-positive" data-testid="role-eligibility">
                  <Check className="h-4 w-4 shrink-0" strokeWidth={2.5} /> You match this opportunity’s position, team and passport
                </p>
              )}
            </section>

            {(words || (vacancy.requirements ?? []).length > 0) && (
              <section className="pt-9">
                <h2 className={H2}>{wordsHeading(identity)}</h2>
                {words && <p className="mt-3 max-w-[72ch] whitespace-pre-wrap text-[17px] leading-[26px] text-ink-1" data-testid="role-words">{words}</p>}
                {(vacancy.requirements ?? []).length > 0 && <p className="mt-2 whitespace-pre-wrap text-row text-ink-2">{(vacancy.requirements ?? []).join(' · ')}</p>}
              </section>
            )}

            {showApplyCopy && (
            <section className="pt-9">
              <h2 className={H2}>How applying works</h2>
              <ol className="mt-3.5 grid grid-cols-3 gap-3">
                {['Send your profile, no CV needed', reviewsLine(identity), 'You’ll see every update in Applied'].map((step, i) => (
                  <li key={step} className={`${CARD} flex items-center gap-3 px-4 py-3.5 text-[14px] leading-[19px] text-ink-1`}>
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-muted text-secondary font-semibold text-ink-1">{i + 1}</span>
                    {step}
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-caption text-ink-3">Contact details stay private until the club replies.</p>
            </section>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
