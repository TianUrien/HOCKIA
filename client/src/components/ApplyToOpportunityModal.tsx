import { useCallback, useMemo, useState } from 'react'
import { nationalityLine } from '@/lib/nationalityLine'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, ChevronRight, Loader2, X } from 'lucide-react'
import * as Sentry from '@sentry/react'
import { format } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { trackApplicationSubmit } from '@/lib/analytics'
import type { Vacancy } from '@/lib/supabase'
import { reportSupabaseError } from '@/lib/sentryHelpers'
import { extractErrorMessage } from '@/lib/utils'
import { useCountries, isEuCountryCode } from '@/hooks/useCountries'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { ApplicationSent } from '@/components/opportunities/ApplicationSent'
import { genderPill, roleTitle } from '@/lib/opportunityCopy'
import { checkOpportunityEligibility } from '@/lib/opportunityEligibility'

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
 * first time the player hears about it. Not eligible: amber reason, no
 * message box, Message the club, Send disabled. On success the Application
 * sent screen takes over.
 */
export default function ApplyToVacancyModal({
  isOpen, onClose, vacancy, onSuccess, onError, clubName, clubLogo, publisherRole, league,
}: ApplyToVacancyModalProps) {
  const { user, profile } = useAuthStore()
  const { addToast } = useToastStore()
  const { countries } = useCountries()
  const navigate = useNavigate()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const displayClub = clubName?.trim() || vacancy.organization_name?.trim() || 'the club'
  const pill = vacancy.opportunity_type === 'player' ? genderPill(vacancy.gender) : null
  const subtitle = [roleTitle(vacancy), [pill?.label, league].filter(Boolean).join(' ')].filter(Boolean).join(' · ')

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
    ? 'Nothing was sent. Passports are edited from Edit profile — if you get an EU passport later, this role reopens for you.'
    : 'Nothing was sent. Your team category is edited from Edit profile.'
  const messageClub = () => {
    onClose()
    navigate(`/messages?new=${vacancy.club_id}`)
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
    setError(null)
    try {
      Sentry.addBreadcrumb({ category: 'supabase', message: 'vacancies.apply', data: { vacancyId: vacancy.id }, level: 'info' })
      const trimmed = message.trim()
      const { error: insertError } = await supabase
        .from('opportunity_applications')
        .insert({
          opportunity_id: vacancy.id,
          applicant_id: user.id,
          status: 'pending',
          ...(trimmed ? { metadata: { message: trimmed } } : {}),
        } as never)

      if (insertError) {
        if (insertError.code === '23505') {
          onSuccess(vacancy.id)
          onClose()
          addToast('You have already applied to this opportunity.', 'info')
        } else if (insertError.code === '42501' || insertError.message?.includes('row-level security')) {
          logger.error('Role mismatch - RLS policy blocked application:', insertError)
          reportSupabaseError('vacancies.apply_rls_block', insertError, { vacancyId: vacancy.id, viewerRole: profile?.role ?? null }, { feature: 'vacancies', operation: 'apply_vacancy' })
          onError?.(vacancy.id)
          const msg = vacancy.opportunity_type === 'coach'
            ? 'Only coaches can apply to coach opportunities.'
            : vacancy.opportunity_type === 'player'
              ? 'Only players can apply to player opportunities.'
              : 'You cannot apply to this opportunity due to role restrictions.'
          setError(msg)
          addToast(msg, 'error')
        } else if (insertError.code === 'P0001') {
          // check_application_eligibility rejected it — the message is user-facing.
          onError?.(vacancy.id)
          const msg = insertError.message || 'You are not eligible to apply to this opportunity.'
          setError(msg)
          addToast(msg, 'error')
        } else {
          logger.error('Error applying to vacancy:', insertError)
          reportSupabaseError('vacancies.apply_error', insertError, { vacancyId: vacancy.id, viewerRole: profile?.role ?? null }, { feature: 'vacancies', operation: 'apply_vacancy' })
          onError?.(vacancy.id)
          const msg = extractErrorMessage(insertError, 'Failed to submit application. Please try again.')
          setError(msg)
          addToast(msg, 'error')
        }
      } else {
        trackDbEvent('application_submit', 'vacancy', vacancy.id, { position: vacancy.position ?? undefined })
        void trackApplicationSubmit(vacancy.id, vacancy.position ?? undefined)
        onSuccess(vacancy.id)
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
    }
  }

  if (sent) {
    return (
      <ApplicationSent
        clubName={displayClub}
        clubLogo={clubLogo ?? null}
        publisherRole={publisherRole}
        onClose={() => { setSent(false); setMessage(''); onClose() }}
      />
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
    <button type="button" onClick={() => editField(field)} aria-label={`${label}: ${value}. Edit`} className="flex w-full items-center gap-3 py-3 pl-3.5 pr-3 text-left">
      <span className="shrink-0 text-body text-ink-1">{label}</span>
      <span className="min-w-0 flex-1 truncate text-right text-row text-ink-2">{value}</span>
      <ChevronRight className="h-4 w-4 shrink-0 text-ink-4" strokeWidth={1.8} />
    </button>
  )

  return (
    <BottomSheet open={isOpen} onClose={handleClose} ariaLabel={`Apply to ${displayClub}`}>
      <div className="flex flex-col gap-[18px] px-5 pb-2 pt-1">
        <div className="flex items-start gap-3">
          <EntityAvatar src={clubLogo} name={displayClub} role={publisherRole ?? 'club'} size={44} />
          <div className="min-w-0 flex-1">
            <h2 className="text-[20px] font-bold leading-[25px] text-ink-1">Apply to {displayClub}</h2>
            <p className="mt-0.5 text-row text-ink-2">{subtitle}</p>
          </div>
          <button type="button" onClick={handleClose} aria-label="Close" className="-mr-2 -mt-1 flex h-9 w-9 items-center justify-center rounded-full text-ink-4">
            <X className="h-[22px] w-[22px]" strokeWidth={2} />
          </button>
        </div>

        <div className="divide-y divide-line rounded-[12px] bg-surface-grouped">
          <Row label="Available from" value={availableText} field="availability" />
          <Row label="Passport" value={passportText} field="passports" />
          <Row label="Contact" value={contactText} field="contact" />
        </div>

        {blocked ? (
          <div className="flex items-start gap-2 rounded-[12px] bg-[#fdf1e4] px-3 py-2.5 text-[14px] leading-[18px] text-[#b45309]" role="status">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.6} />
            <p>{blockedReason}</p>
          </div>
        ) : (
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Add a message to the club (optional)"
            rows={3}
            maxLength={600}
            className="w-full resize-none rounded-[12px] bg-surface-grouped px-3.5 py-3 text-body text-ink-1 placeholder:text-ink-4 focus:outline-none focus:ring-2 focus:ring-hockia-primary/40"
          />
        )}

        {error && <p className="text-secondary text-red-600" role="alert">{error}</p>}

        {blocked && (
          <button
            type="button"
            onClick={messageClub}
            className="flex h-[50px] w-full items-center justify-center rounded-full bg-surface-grouped text-body font-semibold text-ink-1"
          >
            Message the club
          </button>
        )}
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={isSubmitting || blocked}
          aria-disabled={blocked || undefined}
          className="flex h-[50px] w-full items-center justify-center gap-2 rounded-full bg-hockia-primary text-body font-semibold text-white disabled:opacity-40"
        >
          {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
          Send application
        </button>
        <p className="text-center text-secondary text-ink-4">
          {blocked ? blockedFooter : 'Your profile, career and highlights are sent automatically. Withdraw any time from My applications.'}
        </p>
      </div>
    </BottomSheet>
  )
}
