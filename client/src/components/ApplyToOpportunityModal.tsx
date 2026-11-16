import { useCallback, useMemo, useState } from 'react'
import { nationalityLine } from '@/lib/nationalityLine'
import { useNavigate, useLocation } from 'react-router-dom'
import { ChevronRight, Info, Play } from 'lucide-react'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { calculateAge } from '@/lib/utils'
import { format } from 'date-fns'
import { logger } from '@/lib/logger'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import type { Vacancy } from '@/lib/supabase'
import { reportSupabaseError } from '@/lib/sentryHelpers'
import { extractErrorMessage } from '@/lib/utils'
import { useCountries, isEuCountryCode } from '@/hooks/useCountries'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { buttonClassName } from '@/components/ui/buttonClasses'
import { ApplicationSent } from '@/components/opportunities/ApplicationSent'
import { genderPill, roleTitle } from '@/lib/opportunityCopy'
import { applySubline, messageLabel, noteHeading, roleIdentity, type RoleIdentity } from '@/lib/opportunityIdentity'
import { useOpportunitiesT } from '@/i18n/ns/opportunities'
import { getDateFnsLocale } from '@/i18n/format'
import { CrestTile } from '@/components/opportunities/RoleCover'
import { hapticSuccess } from '@/lib/haptics'
import { Check } from 'lucide-react'
import { CloseIcon, VideoIcon } from '@/components/icons/HockiaIcons'
import { getRoleBadgeClasses } from '@/lib/roleColors'
import { positionLabel } from '@/lib/identity'
import { checkOpportunityEligibility } from '@/lib/opportunityEligibility'
import { submitApplication } from '@/lib/submitApplication'
import { requestPushAsk } from '@/lib/pushAsk'
import { maybeShowGetReady } from '@/components/marketplace/getReadyStore'

interface ApplyToVacancyModalProps {
  isOpen: boolean
  onClose: () => void
  vacancy: Vacancy
  onSuccess: (vacancyId: string) => void
  onError?: (vacancyId: string) => void
  /** Club identity for the sheet header; falls back to the organisation name. */
  clubName?: string | null
  clubLogo?: string | null
  publisherRole?: string | null
  league?: string | null
  /** Who is behind the role (hiring club + posted-by coach): coach-aware copy. */
  identity?: RoleIdentity
  /** Where the member came from (lib/navSource); tags application_submit. */
  source?: string
}

/**
 * Apply sheet (Figma 43:274 / 285:629): "The profile is the application."
 * Three prefilled facts in an inset group, one optional message, one button.
 * Eligibility is evaluated HERE with the same two rules as the
 * check_application_eligibility trigger — (A) EU passport, (B) team category
 * vs gender; missing data never blocks — so the server error is never the
 * first time the player hears about it. Not eligible: a NEUTRAL callout with
 * an info icon (never amber — the player cannot act on it here), no message
 * box, Secondary "Message the club", Primary "Send application" disabled. On
 * success the Application sent screen takes over.
 *
 * Header: crest 48, "Apply to <club>", the role, Ghost ✕. The facts are
 * Detail rows with a chevron (each opens its Edit profile field).
 */
export default function ApplyToVacancyModal({
  isOpen, onClose, vacancy, onSuccess, onError, clubName, clubLogo, publisherRole, league, identity: identityProp, source,
}: ApplyToVacancyModalProps) {
  const t = useOpportunitiesT()
  const { user, profile } = useAuthStore()
  const { addToast } = useToastStore()
  const { countries } = useCountries()
  const navigate = useNavigate()
  const location = useLocation()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const isDesktop = useMediaQuery('(min-width: 1024px)')

  const displayClub = clubName?.trim() || vacancy.organization_name?.trim() || t('apply.clubFallback')
  const identity = identityProp ?? roleIdentity({ publisherRole, publisherName: displayClub, publisherAvatar: clubLogo ?? null })
  const pill = vacancy.opportunity_type === 'player' ? genderPill(vacancy.gender) : null
  const roleLine = [roleTitle(vacancy), pill?.label].filter(Boolean).join(' · ')
  const subtitle = [applySubline(identity), league].filter(Boolean).join(' · ')
  const [sending, setSending] = useState<'idle' | 'sending' | 'done'>('idle')
  const noteLabel = t('apply.noteOptional', { heading: noteHeading(identity) })

  // ── The three facts ──
  const passports = useMemo(() => {
    const ids = [profile?.nationality_country_id, profile?.nationality2_country_id].filter((id): id is number => typeof id === 'number')
    return ids.map((id) => countries.find((c) => c.id === id)).filter((c): c is NonNullable<typeof c> => Boolean(c))
  }, [countries, profile?.nationality_country_id, profile?.nationality2_country_id])
  const passportText =
    nationalityLine(passports, { suffix: (c) => (isEuCountryCode((c as { code?: string }).code) ? '(EU)' : null) }) ??
    (profile?.nationality?.trim() || t('apply.addNationality'))
  const nationalityWord = passports[0]?.nationality_name ?? profile?.nationality ?? null

  // Same rules, same order, same missing-data leniency as the DB trigger.
  const eligibility = useMemo(() => checkOpportunityEligibility(vacancy, profile, countries), [vacancy, profile, countries])
  const blocked = !eligibility.eligible
  const blockedByPassport = blocked && eligibility.code === 'eu_passport'
  const blockedReason = blockedByPassport
    ? (nationalityWord ? t('apply.blocked.passport', { club: displayClub, nationality: nationalityWord }) : t('apply.blocked.passportNotEu', { club: displayClub }))
    : eligibility.code === 'womens_team' ? t('apply.blocked.womensTeams')
      : eligibility.code === 'mens_team' ? t('apply.blocked.mensTeams')
        : t('apply.blocked.otherCategory')
  const blockedFooter = blockedByPassport ? t('apply.blocked.passportFooter') : t('apply.blocked.categoryFooter')
  const messageClub = () => {
    onClose()
    navigate(`/messages?new=${vacancy.club_id}`, { state: { from: location.pathname } })
  }

  const durationLabel = (value: string) => {
    switch (value) {
      case 'full_season': return t('apply.duration.fullSeason')
      case 'half_season': return t('apply.duration.halfSeason')
      case 'short_term': return t('apply.duration.shortTerm')
      case 'flexible': return t('apply.duration.flexible')
      default: return value
    }
  }
  const availableText = (() => {
    const from = profile?.available_from ? new Date(profile.available_from) : null
    const when = from && !Number.isNaN(from.getTime()) ? format(from, 'MMM yyyy', { locale: getDateFnsLocale() }) : null
    const duration = profile?.availability_duration ? durationLabel(profile.availability_duration) : null
    return [when ?? t('apply.availableNow'), duration].filter(Boolean).join(' · ')
  })()
  const contactText = profile?.contact_email_masked || (profile?.contact_email ? `${profile.contact_email.slice(0, 3)}…` : t('apply.contactLater'))

  const handleClose = useCallback(() => {
    if (isSubmitting) return
    setError(null)
    onClose()
  }, [isSubmitting, onClose])

  const handleSubmit = async () => {
    if (isSubmitting || blocked) return
    if (!user) { setError(t('apply.errors.signedOut')); return }
    if (vacancy.club_id === user.id) { setError(t('apply.errors.ownOpportunity')); return }

    setIsSubmitting(true)
    setSending('sending')
    setError(null)
    try {
      const res = await submitApplication(vacancy, user.id, message, { viewerRole: profile?.role ?? null, source: source ?? 'direct', via: 'apply_sheet' })
      if (res.ok && res.already) {
        onSuccess(vacancy.id)
        onClose()
        addToast(t('apply.alreadyApplied'), 'info')
      } else if (!res.ok) {
        onError?.(vacancy.id)
        setError(res.message)
        addToast(res.message, 'error')
      } else {
        onSuccess(vacancy.id)
        // Send morph (Motion spec): spinner → green check → the sent screen.
        setSending('done')
        void hapticSuccess()
        await new Promise((r) => setTimeout(r, 520))
        setSent(true)
      }
    } catch (err) {
      logger.error('Unexpected error:', err)
      reportSupabaseError('vacancies.apply_exception', err, { vacancyId: vacancy.id }, { feature: 'vacancies', operation: 'apply_vacancy' })
      onError?.(vacancy.id)
      const msg = extractErrorMessage(err, t('apply.errors.network'))
      setError(msg)
      addToast(msg, 'error')
    } finally {
      setIsSubmitting(false)
      setSending((v) => (v === 'done' ? v : 'idle'))
    }
  }

  // Closing the Application sent screen is a moment of intent: the one-time
  // notification ask may follow (lib/pushAsk.ts, audit A1).
  // Applying to a club in another country may open "Get ready for <Country>"
  // instead (Figma 08 · Brands P6 MK4); then the push ask waits for another moment.
  const closeSent = () => {
    setSent(false); setSending('idle'); setMessage(''); onClose()
    if (!user) { requestPushAsk('apply'); return }
    void maybeShowGetReady({ userId: user.id, baseCountryId: profile?.base_country_id ?? null, roleCountry: vacancy.location_country ?? null, clubName: displayClub })
      .then((shown) => { if (!shown) requestPushAsk('apply') })
  }

  if (sent) {
    return (
      <BottomSheet open={isOpen} onClose={closeSent} ariaLabel={t('apply.sentAria')} initialFocus="panel">
        <ApplicationSent
          clubName={displayClub}
          clubLogo={clubLogo ?? null}
          publisherRole={publisherRole}
          identity={identity}
          roleLine={roleLine}
          onClose={closeSent}
        />
      </BottomSheet>
    )
  }

  // The three facts are read from the profile; a row opens the matching Edit
  // profile field (players have the field-level leaf; other roles get the
  // editor). Nothing here is sent until Send application.
  const editField = (field: 'availability' | 'passports' | 'contact') => {
    handleClose()
    navigate(profile?.role === 'player' ? `/dashboard/profile/edit?field=${field}` : '/dashboard/profile?action=edit')
  }
  const Row = ({ label, value, field }: { label: string; value: string; field: 'availability' | 'passports' | 'contact' }) => (
    <button type="button" onClick={() => editField(field)} aria-label={t('apply.rowAria', { label, value })} className="flex min-h-[48px] w-full items-center gap-3 py-3 pl-4 pr-3 text-left active:bg-surface-muted-pressed" data-testid="apply-detail-row">
      <span className="shrink-0 text-row text-ink-2">{label}</span>
      <span className="min-w-0 flex-1 truncate text-right text-row font-semibold text-ink-1">{value}</span>
      <ChevronRight className="h-4 w-4 shrink-0 text-ink-4" strokeWidth={1.8} aria-hidden="true" />
    </button>
  )

  const sendButton = (block: boolean) => (
    // Send morph: the pill narrows to a 52 pt circle with a spinner, then a green check.
    <button
      type="button"
      disabled={blocked || isSubmitting || sending === 'done'}
      aria-disabled={blocked || undefined}
      aria-busy={sending === 'sending' || undefined}
      onClick={() => void handleSubmit()}
      className={`flex h-[52px] items-center justify-center rounded-full text-[16px] font-semibold leading-[21px] text-white transition-[width,background-color] duration-[var(--spring-ms,420ms)] [transition-timing-function:var(--spring,cubic-bezier(0.2,0.8,0.2,1))] ${sending === 'done' ? 'w-[52px] bg-positive' : sending === 'sending' ? 'w-[52px] bg-brand-primary' : `${block ? 'w-full' : 'px-6 shadow-glow-brand'} bg-brand-primary active:opacity-90 disabled:opacity-50`}`}
      data-testid="send-application"
      data-state={sending}
    >
      {sending === 'done' ? <Check className="h-6 w-6" strokeWidth={2.5} aria-label={t('apply.sentIconAria')} /> : sending === 'sending' ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-label={t('apply.sendingAria')} /> : t('apply.sendButton')}
    </button>
  )

  // Rebrand page 27 · Web · Apply dialog (560): one centred dialog over the
  // opportunity — what the club will see (the profile card), an optional
  // message, Cancel + Send application. The detail rows stay on phones.
  if (isDesktop) {
    const age = calculateAge(profile?.date_of_birth)
    const flags = passports.map((c) => c.flag_emoji).filter(Boolean).join(' ')
    const profileLine = [positionLabel(profile?.position), genderPill(profile?.gender)?.label, flags, profile?.base_location?.split(',')[0]?.trim()].filter(Boolean).join(' · ')
    const hasVideo = Boolean(profile?.highlight_video_url)
    const seer = identity.postedBy?.firstName ?? null
    return (
      <BottomSheet open={isOpen} onClose={handleClose} ariaLabel={t('apply.dialogAria', { club: displayClub })} className="lg:max-w-[560px]">
        <div className="flex flex-col gap-4 px-7 pb-5" data-testid="apply-dialog-desktop">
          <div className="flex items-center gap-3">
            <h2 className="min-w-0 flex-1 font-display text-[24px] font-bold leading-[1.2] tracking-[-0.025em] text-ink-1">{t('apply.titleNamed', { club: identity.hiringClub?.name ?? displayClub })}</h2>
            <button type="button" onClick={handleClose} className="-mr-2.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-2 hover:bg-surface-subtle" aria-label={t('apply.close')} data-testid="apply-close">
              <CloseIcon className="h-5 w-5" />
            </button>
          </div>
          <p className="text-[15px] leading-[1.45] text-ink-2">
            {seer
              ? (hasVideo ? t('apply.seesNamedVideo', { name: seer }) : t('apply.seesNamed', { name: seer }))
              : (hasVideo ? t('apply.seesClubVideo') : t('apply.seesClub'))}
          </p>
          <div className="flex items-center gap-3 rounded-[16px] bg-surface-subtle p-3.5" data-testid="apply-profile-card">
            <EntityAvatar src={profile?.avatar_url ?? null} name={profile?.full_name ?? ''} role={profile?.role ?? 'player'} size={48} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-medium leading-[1.3] text-ink-1">{profile?.full_name || t('apply.yourProfile')}{age !== null ? `, ${age}` : ''}</p>
              {profileLine && <p className="mt-0.5 truncate text-[13px] leading-[1.4] text-ink-2">{profileLine}</p>}
            </div>
            {hasVideo && (
              <span className="flex shrink-0 items-center gap-1 text-[14px] font-medium text-brand-text" data-testid="apply-profile-video">
                {t('apply.highlight')}{' '}<Play className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
              </span>
            )}
          </div>

          {blocked ? (
            <div className="flex items-start gap-2.5 rounded-[12px] bg-surface-muted px-3.5 py-3 text-[14px] leading-[19px] text-ink-2" role="status" data-testid="apply-not-eligible">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-2" strokeWidth={1.8} aria-hidden="true" />
              <p>{blockedReason} {blockedFooter}</p>
            </div>
          ) : (
            <label className="flex flex-col gap-1.5">
              <span className="text-[14px] font-medium leading-[1.3] text-ink-1">{noteLabel}</span>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={identity.postedBy ? t('apply.notePlaceholderNamed', { name: identity.postedBy.firstName }) : t('apply.notePlaceholderClub')}
                rows={3}
                maxLength={500}
                className="min-h-[96px] w-full resize-none rounded-[16px] border border-line bg-white px-4 py-3.5 text-[16px] leading-[1.45] text-ink-1 placeholder:text-ink-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-hockia-primary"
              />
              <span className="flex justify-between text-caption text-ink-3"><span>{t('apply.maxCharacters')}</span><span aria-live="polite">{message.length} / 500</span></span>
            </label>
          )}

          {error && <p className="text-secondary text-status-danger" role="alert">{error}</p>}

          <div className="flex items-center justify-end gap-3 pt-1">
            <button type="button" onClick={handleClose} className={buttonClassName({ variant: 'secondary', size: 'large', radius: 'rounded-full' })}>{t('apply.cancel')}</button>
            {blocked ? (
              <button type="button" onClick={messageClub} className={buttonClassName({ variant: 'primary', size: 'large', radius: 'rounded-full' })}>
                {messageLabel(identity)}
              </button>
            ) : sendButton(false)}
          </div>
        </div>
      </BottomSheet>
    )
  }

  return (
    <BottomSheet open={isOpen} onClose={handleClose} ariaLabel={t('apply.dialogAria', { club: displayClub })}>
      <div className="flex flex-col px-5 pb-2 pt-1">
        {/* Rebrand page 20 · Apply: "Apply" + close, the role, what the club will see. */}
        <div className="flex items-center gap-3 pb-4">
          <h2 className="min-w-0 flex-1 text-title text-ink-1" aria-label={t('apply.titleAria', { club: identity.hiringClub?.name ?? identity.displayName })}>{t('apply.title')}</h2>
          <button type="button" onClick={handleClose} className="-mr-2.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-1 active:bg-surface-muted-pressed" aria-label={t('apply.close')} data-testid="apply-close">
            <CloseIcon className="h-6 w-6" />
          </button>
        </div>

        {/* The role (Figma 153:386): crest 40 · role · "Club · posted by Coach". */}
        <div className="flex items-center gap-3 rounded-[16px] bg-surface-subtle p-3" data-testid="apply-role-summary">
          {identity.hiringClub
            ? <CrestTile src={identity.hiringClub.logo} name={identity.hiringClub.name} size={40} radius={12} />
            : <EntityAvatar src={clubLogo} name={displayClub} role={publisherRole ?? 'club'} size={40} />}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[16px] font-semibold leading-[21px] text-ink-1">{roleLine}</p>
            <p className="truncate text-secondary text-ink-2">{subtitle}</p>
          </div>
        </div>

        <p className="pt-5 text-micro font-semibold uppercase tracking-[0.02em] text-ink-3">{t('apply.clubWillSee')}</p>
        {/* Profile card (rebrand page 20): the profile is the application. */}
        <div className="mt-2 flex items-center gap-3 rounded-[16px] bg-surface-subtle p-3" data-testid="apply-profile-card">
          <EntityAvatar src={profile?.avatar_url ?? null} name={profile?.full_name ?? ''} role={profile?.role ?? 'player'} size={48} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[16px] font-semibold leading-[21px] text-ink-1">{profile?.full_name || t('apply.yourProfile')}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {profile?.role && <span className={`rounded-full px-2 py-0.5 text-micro font-semibold uppercase tracking-[0.04em] ${getRoleBadgeClasses(profile.role)}`}>{profile.role}</span>}
              {profile?.position && <span className="rounded-full bg-hockia-soft px-2 py-0.5 text-caption font-semibold text-hockia-primary">{positionLabel(profile.position)}</span>}
            </div>
          </div>
          {profile?.highlight_video_url && (
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[12px] bg-white text-ink-2" title={t('apply.highlightIncludedTitle')} aria-label={t('apply.highlightIncludedAria')} data-testid="apply-profile-video">
              <VideoIcon className="h-6 w-6" />
            </span>
          )}
        </div>
        <div className="mt-2 divide-y-[0.5px] divide-line overflow-hidden rounded-[16px] border border-line">
          <Row label={t('apply.rows.availableFrom')} value={availableText} field="availability" />
          <Row label={t('apply.rows.passport')} value={passportText} field="passports" />
          <Row label={t('apply.rows.contact')} value={contactText} field="contact" />
        </div>

        {blocked ? (
          // Callout (Figma 460:23): neutral surface, info icon. Never amber.
          <div className="mt-5 flex items-start gap-2.5 rounded-[12px] bg-surface-muted px-3.5 py-3 text-[14px] leading-[19px] text-ink-2" role="status" data-testid="apply-not-eligible">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-2" strokeWidth={1.8} aria-hidden="true" />
            <p>{blockedReason}</p>
          </div>
        ) : (
          <>
            <p className="pt-5 text-micro font-semibold uppercase tracking-[0.02em] text-ink-3">{noteLabel}</p>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={identity.postedBy ? t('apply.notePlaceholderNamedOptional', { name: identity.postedBy.firstName }) : t('apply.notePlaceholderClubOptional')}
              aria-label={noteLabel}
              rows={3}
              maxLength={500}
              className="mt-2 min-h-[96px] w-full resize-none rounded-[16px] bg-surface-subtle px-3.5 py-3 text-[16px] leading-[22px] text-ink-1 placeholder:text-ink-3 focus:bg-white focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-hockia-primary"
            />
            <p className="flex justify-between pt-1 text-caption text-ink-3"><span>{t('apply.optionalMaxCharacters')}</span><span aria-live="polite">{message.length} / 500</span></p>
          </>
        )}

        {error && <p className="pt-3 text-secondary text-status-danger" role="alert">{error}</p>}

        <div className="flex flex-col items-center gap-2.5 pt-5">
          {blocked && (
            <button type="button" onClick={messageClub} className={buttonClassName({ variant: 'secondary', size: 'large', radius: 'rounded-full', block: true })}>
              {messageLabel(identity)}
            </button>
          )}
          {sendButton(true)}
          <p className="text-center text-caption text-ink-3">
            {blocked ? blockedFooter : t('apply.footer')}
          </p>
        </div>
      </div>
    </BottomSheet>
  )
}
