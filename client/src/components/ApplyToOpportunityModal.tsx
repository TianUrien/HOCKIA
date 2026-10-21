import { useCallback, useMemo, useState } from 'react'
import { nationalityLine } from '@/lib/nationalityLine'
import { useNavigate, useLocation } from 'react-router-dom'
import { ChevronRight, Info } from 'lucide-react'
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
import { applySubline, noteHeading, roleIdentity, type RoleIdentity } from '@/lib/opportunityIdentity'
import { CrestTile } from '@/components/opportunities/RoleCover'
import { hapticSuccess } from '@/lib/haptics'
import { Check } from 'lucide-react'
import { checkOpportunityEligibility } from '@/lib/opportunityEligibility'
import { submitApplication } from '@/lib/submitApplication'

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

const DURATION_LABELS: Record<string, string> = {
  full_season: 'Full season', half_season: 'Half season', short_term: 'Short term', flexible: 'Flexible',
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
  const { user, profile } = useAuthStore()
  const { addToast } = useToastStore()
  const { countries } = useCountries()
  const navigate = useNavigate()
  const location = useLocation()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const displayClub = clubName?.trim() || vacancy.organization_name?.trim() || 'the club'
  const identity = identityProp ?? roleIdentity({ publisherRole, publisherName: displayClub, publisherAvatar: clubLogo ?? null })
  const pill = vacancy.opportunity_type === 'player' ? genderPill(vacancy.gender) : null
  const roleLine = [roleTitle(vacancy), pill?.label].filter(Boolean).join(' · ')
  const subtitle = [applySubline(identity), league].filter(Boolean).join(' · ')
  const [sending, setSending] = useState<'idle' | 'sending' | 'done'>('idle')
  const noteTarget = identity.postedBy ? identity.postedBy.firstName : 'the club'

  // ── The three facts ──
  const passports = useMemo(() => {
    const ids = [profile?.nationality_country_id, profile?.nationality2_country_id].filter((id): id is number => typeof id === 'number')
    return ids.map((id) => countries.find((c) => c.id === id)).filter((c): c is NonNullable<typeof c> => Boolean(c))
  }, [countries, profile?.nationality_country_id, profile?.nationality2_country_id])
  const passportText =
    nationalityLine(passports, { suffix: (c) => (isEuCountryCode((c as { code?: string }).code) ? '(EU)' : null) }) ??
    (profile?.nationality?.trim() || 'Add your nationality')
  const nationalityWord = passports[0]?.nationality_name ?? profile?.nationality ?? 'not EU'

  // Same rules, same order, same missing-data leniency as the DB trigger.
  const eligibility = useMemo(() => checkOpportunityEligibility(vacancy, profile, countries), [vacancy, profile, countries])
  const blocked = !eligibility.eligible
  const blockedByPassport = blocked && /EU passport/i.test(eligibility.reason ?? '')
  const blockedReason = blockedByPassport
    ? `${displayClub} asks for an EU passport and yours is ${nationalityWord}, so this role can’t take your application. You can still message the club.`
    : `${(eligibility.reason ?? 'This role is for another team category.').replace(/\.$/, '')}, so this role can’t take your application. You can still message the club.`
  const blockedFooter = blockedByPassport
    ? 'Nothing was sent. Passports are edited from Edit profile. If you get an EU passport later, this role reopens for you.'
    : 'Nothing was sent. Your team category is edited from Edit profile.'
  const messageClub = () => {
    onClose()
    navigate(`/messages?new=${vacancy.club_id}`, { state: { from: location.pathname } })
  }

  const availableText = (() => {
    const from = profile?.available_from ? new Date(profile.available_from) : null
    const when = from && !Number.isNaN(from.getTime()) ? format(from, 'MMM yyyy') : null
    const duration = profile?.availability_duration ? DURATION_LABELS[profile.availability_duration] ?? profile.availability_duration : null
    return [when ?? 'Now', duration].filter(Boolean).join(' · ')
  })()
  const contactText = profile?.contact_email_masked || (profile?.contact_email ? `${profile.contact_email.slice(0, 3)}…` : 'Shown once the club replies')

  const handleClose = useCallback(() => {
    if (isSubmitting) return
    setError(null)
    onClose()
  }, [isSubmitting, onClose])

  const handleSubmit = async () => {
    if (isSubmitting || blocked) return
    if (!user) { setError('You must be signed in to apply.'); return }
    if (vacancy.club_id === user.id) { setError("You can't apply to your own opportunity."); return }

    setIsSubmitting(true)
    setSending('sending')
    setError(null)
    try {
      const res = await submitApplication(vacancy, user.id, message, { viewerRole: profile?.role ?? null, source: source ?? 'direct', via: 'apply_sheet' })
      if (res.ok && res.already) {
        onSuccess(vacancy.id)
        onClose()
        addToast('You have already applied to this opportunity.', 'info')
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
      const msg = extractErrorMessage(err, 'Network error. Please check your connection and try again.')
      setError(msg)
      addToast(msg, 'error')
    } finally {
      setIsSubmitting(false)
      setSending((v) => (v === 'done' ? v : 'idle'))
    }
  }

  if (sent) {
    return (
      <BottomSheet open={isOpen} onClose={() => { setSent(false); setSending('idle'); setMessage(''); onClose() }} ariaLabel="Application sent" initialFocus="panel">
        <ApplicationSent
          clubName={displayClub}
          clubLogo={clubLogo ?? null}
          publisherRole={publisherRole}
          identity={identity}
          roleLine={roleLine}
          onClose={() => { setSent(false); setSending('idle'); setMessage(''); onClose() }}
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
    <button type="button" onClick={() => editField(field)} aria-label={`${label}: ${value}. Edit`} className="flex min-h-[48px] w-full items-center gap-3 py-3 pl-4 pr-3 text-left active:bg-surface-muted-pressed" data-testid="apply-detail-row">
      <span className="shrink-0 text-row text-ink-2">{label}</span>
      <span className="min-w-0 flex-1 truncate text-right text-row font-semibold text-ink-1">{value}</span>
      <ChevronRight className="h-4 w-4 shrink-0 text-ink-4" strokeWidth={1.8} aria-hidden="true" />
    </button>
  )

  return (
    <BottomSheet open={isOpen} onClose={handleClose} ariaLabel={`Apply to ${displayClub}`}>
      <div className="flex flex-col px-5 pb-2 pt-1">
        <div className="flex items-center gap-3 pb-4">
          <h2 className="min-w-0 flex-1 text-title text-ink-1">Apply to {identity.hiringClub?.name ?? identity.displayName}</h2>
          <button type="button" onClick={handleClose} className="shrink-0 text-[16px] leading-[22px] text-brand-primary" aria-label="Cancel">Cancel</button>
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

        <p className="pt-5 text-micro font-semibold uppercase tracking-[0.02em] text-ink-3">Sent with your application · tap to edit</p>
        <div className="mt-2 divide-y-[0.5px] divide-line overflow-hidden rounded-[16px] border border-line">
          <Row label="Available from" value={availableText} field="availability" />
          <Row label="Passport" value={passportText} field="passports" />
          <Row label="Contact" value={contactText} field="contact" />
        </div>

        {blocked ? (
          // Callout (Figma 460:23): neutral surface, info icon. Never amber.
          <div className="mt-5 flex items-start gap-2.5 rounded-[12px] bg-surface-muted px-3.5 py-3 text-[14px] leading-[19px] text-ink-2" role="status" data-testid="apply-not-eligible">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-ink-2" strokeWidth={1.8} aria-hidden="true" />
            <p>{blockedReason}</p>
          </div>
        ) : (
          <>
            <p className="pt-5 text-micro font-semibold uppercase tracking-[0.02em] text-ink-3">{noteHeading(identity)} (optional)</p>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={`Add a note to ${noteTarget} (optional)`}
              aria-label={`${noteHeading(identity)} (optional)`}
              rows={3}
              maxLength={600}
              className="mt-2 min-h-[96px] w-full resize-none rounded-[16px] bg-surface-subtle px-3.5 py-3 text-[16px] leading-[22px] text-ink-1 placeholder:text-ink-3 focus:bg-white focus:outline-none focus:ring-1 focus:ring-inset focus:ring-hockia-primary"
            />
            <p className="pt-1 text-right text-caption text-ink-3" aria-live="polite">{message.length} / 600</p>
          </>
        )}

        {error && <p className="pt-3 text-secondary text-status-danger" role="alert">{error}</p>}

        <div className="flex flex-col items-center gap-2.5 pt-5">
          {blocked && (
            <button type="button" onClick={messageClub} className={buttonClassName({ variant: 'secondary', size: 'large', radius: 'rounded-full', block: true })}>
              {identity.postedBy ? `Message ${identity.postedBy.firstName}` : 'Message the club'}
            </button>
          )}
          {/* Send morph: the pill narrows to a 52 pt circle with a spinner, then a green check. */}
          <button
            type="button"
            disabled={blocked || isSubmitting || sending === 'done'}
            aria-disabled={blocked || undefined}
            aria-busy={sending === 'sending' || undefined}
            onClick={() => void handleSubmit()}
            className={`flex h-[52px] items-center justify-center rounded-full text-[16px] font-semibold leading-[21px] text-white transition-[width,background-color] duration-[var(--spring-ms,420ms)] [transition-timing-function:var(--spring,cubic-bezier(0.2,0.8,0.2,1))] ${sending === 'done' ? 'w-[52px] bg-positive' : sending === 'sending' ? 'w-[52px] bg-brand-primary' : 'w-full bg-brand-primary active:opacity-90 disabled:opacity-50'}`}
            data-testid="send-application"
            data-state={sending}
          >
            {sending === 'done' ? <Check className="h-6 w-6" strokeWidth={2.5} aria-label="Sent" /> : sending === 'sending' ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-label="Sending" /> : 'Send application'}
          </button>
          <p className="text-center text-caption text-ink-3">
            {blocked ? blockedFooter : 'Your profile, career and highlights are sent automatically. Withdraw any time from Applied.'}
          </p>
        </div>
      </div>
    </BottomSheet>
  )
}
