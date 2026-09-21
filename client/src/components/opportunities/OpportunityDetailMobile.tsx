import { useNavigate } from 'react-router-dom'
import { Calendar, Check, ChevronRight, Clock, MessageCircle, Share } from 'lucide-react'
import type { Vacancy } from '@/lib/supabase'
import { DetailNavBar } from '@/components/ui/DetailNavBar'
import { IconButton } from '@/components/ui/IconButton'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { useToastStore } from '@/lib/toast'
import { useAuthStore } from '@/lib/auth'
import { useCountries } from '@/hooks/useCountries'
import { checkOpportunityEligibility } from '@/lib/opportunityEligibility'
import { getShareOrigin } from '@/lib/profileShare'
import { humanizeToken, identityLine } from '@/lib/identity'
import {
  APPLICATION_TONE_CLASS, SPECIALIST_TILE, applicationStatusPill, compensationText, deadlineLine, genderPill,
  postedLine, roleBenefits, roleTitle, startsLine,
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
  onApply: () => void
  onMessage: () => void
}

/**
 * Opportunity detail (Figma 43:195 / 218:556): every field the club filled,
 * in the order a player decides — who → what → what you get → what they ask
 * → their own words → how applying works — above a fixed Message / Apply bar.
 * After applying: tinted Applied with a check, a status line, and a link to
 * My applications. Re-applying is impossible.
 */
export function OpportunityDetailMobile({
  vacancy, clubName, clubLogo, clubId, publisherRole, countryFlag, league, hasApplied, applicationStatus, canApply, isPublisher, onApply, onMessage,
}: OpportunityDetailMobileProps) {
  const navigate = useNavigate()
  const addToast = useToastStore((s) => s.addToast)
  const profile = useAuthStore((s) => s.profile)
  const { countries } = useCountries()
  // Same two rules as the apply sheet and the DB trigger, so the block is
  // never a surprise two taps later.
  const eligibility = checkOpportunityEligibility(vacancy, profile, countries)
  const lacksEuPassport = vacancy.eu_passport_required === true && !eligibility.eligible && /EU passport/i.test(eligibility.reason ?? '')
  const pill = vacancy.opportunity_type === 'player' ? genderPill(vacancy.gender) : null
  const place = [vacancy.location_city, vacancy.location_country].map((s) => s?.trim()).filter(Boolean).join(', ')
  const clubLine = [identityLine(publisherRole ?? 'club'), countryFlag && place ? `${countryFlag} ${place}` : place, league].filter(Boolean).join(' · ')
  const benefits = roleBenefits(vacancy)
  const customBenefits = vacancy.custom_benefits ?? []
  const specialists = vacancy.specialist_skills_wanted ?? []
  const status = hasApplied ? applicationStatusPill(applicationStatus ?? 'pending', null, vacancy.status === 'open') : null

  const share = async () => {
    const url = `${getShareOrigin()}/opportunities/${vacancy.id}`
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title: `${roleTitle(vacancy)} · ${clubName}`, url })
        return
      }
      await navigator.clipboard.writeText(url)
      addToast('Link copied', 'success')
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) addToast('Could not share this role', 'error')
    }
  }

  const openClub = () => navigate(publisherRole === 'coach' ? `/coaches/id/${clubId}` : `/clubs/id/${clubId}`)

  const askRow = (label: string, value: React.ReactNode) => (
    <div className="flex items-start gap-3 border-b border-line py-2.5 last:border-b-0">
      <span className="w-[104px] shrink-0 text-row text-ink-2">{label}</span>
      <span className="min-w-0 flex-1 text-row text-ink-1">{value}</span>
    </div>
  )

  return (
    <div className="bg-white pb-[calc(72px+env(safe-area-inset-bottom))]">
      <DetailNavBar
        parent="Opportunities"
        fallbackPath="/opportunities"
        trailing={<IconButton label="Share" onClick={() => void share()}><Share className="h-6 w-6" strokeWidth={1.8} /></IconButton>}
      />

      <button type="button" onClick={openClub} className="flex w-full items-center gap-3 px-5 py-2 text-left active:bg-surface-muted">
        <EntityAvatar src={clubLogo} name={clubName} role={publisherRole ?? 'club'} size={56} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-row font-semibold text-ink-1">{clubName}</span>
          <span className="block truncate text-secondary text-ink-2">{clubLine}</span>
        </span>
        <ChevronRight className="h-[18px] w-[18px] shrink-0 text-ink-4" strokeWidth={1.6} />
      </button>

      <div className="px-5 pb-1.5 pt-2.5">
        <div className="flex items-center gap-2.5">
          <h1 className="text-[28px] font-bold leading-[34px] text-ink-1">{roleTitle(vacancy)}</h1>
          {pill && <span className={`rounded-full px-2 py-0.5 text-secondary font-semibold ${pill.className}`}>{pill.label}</span>}
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-row text-ink-2">
          <Calendar className="h-4 w-4" strokeWidth={1.6} /> {startsLine(vacancy)}
        </p>
        <p className="mt-1 flex items-start gap-1.5 text-secondary text-ink-3">
          <Clock className="mt-0.5 h-[13px] w-[13px] shrink-0" strokeWidth={1.6} /> {postedLine(vacancy)}
        </p>
      </div>

      <section className="px-5 pt-3.5">
        <h2 className="text-body font-semibold text-ink-1">What the club offers</h2>
        <ul className="mt-0.5">
          {benefits.map((b) => (
            <li key={b.key} className="flex items-center gap-3 py-2">
              <span className={`flex h-8 w-8 items-center justify-center rounded-[10px] ${b.tileClass}`}><b.icon className="h-4 w-4" strokeWidth={1.8} /></span>
              <span><span className="block text-row font-semibold text-ink-1">{b.label}</span><span className="block text-secondary text-ink-2">{b.detail}</span></span>
            </li>
          ))}
          {customBenefits.map((b) => (
            <li key={b} className="flex items-center gap-3 py-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-surface-grouped text-ink-1"><Check className="h-4 w-4" strokeWidth={2} /></span>
              <span className="text-row font-semibold text-ink-1">{b}</span>
            </li>
          ))}
          <li className="flex items-center gap-3 py-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-surface-grouped text-ink-1"><Check className="h-4 w-4" strokeWidth={2} /></span>
            <span><span className="block text-row font-semibold text-ink-1">{compensationText(vacancy)}</span>{!vacancy.compensation && <span className="block text-secondary text-ink-2">Ask the club when you apply</span>}</span>
          </li>
        </ul>
      </section>

      <section className="px-5 pt-4">
        <h2 className="text-body font-semibold text-ink-1">What the club asks</h2>
        <div className="mt-1">
          {vacancy.opportunity_type === 'player' && vacancy.position && askRow('Position', `${humanizeToken(vacancy.position)}${vacancy.position_required ? ' · required' : ''}`)}
          {vacancy.opportunity_type === 'player' && pill && askRow('Category', pill.label)}
          {askRow('Passport', vacancy.eu_passport_required ? <span className="font-semibold text-[#b45309]">EU passport required{lacksEuPassport ? ' · you don’t hold one' : ''}</span> : 'Any')}
          {specialists.length > 0 && askRow('Specialist', (
            <span className="flex flex-wrap gap-1.5">
              {specialists.map((s) => (
                <span key={s} className="flex items-center gap-1 text-row text-ink-1">
                  <span className={`flex h-5 w-5 items-center justify-center rounded-[6px] ${SPECIALIST_TILE.tileClass}`}><SPECIALIST_TILE.icon className="h-3 w-3" strokeWidth={1.8} /></span>
                  {humanizeToken(s)}
                </span>
              ))}
            </span>
          ))}
          {askRow('Available', startsLine(vacancy).replace(/^Starts /, ''))}
          {askRow('Apply by', deadlineLine(vacancy).replace(/^Apply by /, ''))}
        </div>
      </section>

      {(vacancy.description?.trim() || (vacancy.requirements ?? []).length > 0) && (
        <section className="px-5 pt-[18px]">
          <h2 className="text-body font-semibold text-ink-1">In the club’s words</h2>
          {vacancy.title && vacancy.title !== roleTitle(vacancy) && <p className="mt-2 text-row font-semibold text-ink-1">{vacancy.title}</p>}
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

      {!isPublisher && (canApply || hasApplied) && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white px-5 pb-[max(env(safe-area-inset-bottom),0.625rem)] pt-2.5 lg:hidden">
          {hasApplied && status && (
            <div className="mb-2 flex items-center justify-between">
              <span className={`rounded-full px-2 py-0.5 text-caption font-semibold ${APPLICATION_TONE_CLASS[status.tone]}`}>{status.label}</span>
              <button type="button" onClick={() => navigate('/opportunities/applications')} className="text-secondary font-semibold text-hockia-primary">
                View my applications
              </button>
            </div>
          )}
          <div className="flex items-center gap-2.5">
            <button type="button" onClick={onMessage} aria-label="Message club" className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-surface-grouped text-ink-1">
              <MessageCircle className="h-5 w-5" strokeWidth={1.6} />
            </button>
            {hasApplied ? (
              <span className="flex h-[52px] flex-1 items-center justify-center gap-2 rounded-full bg-hockia-soft text-body font-semibold text-hockia-primary">
                <Check className="h-[18px] w-[18px]" strokeWidth={2.5} /> Applied
              </span>
            ) : (
              <button type="button" onClick={onApply} className="flex h-[52px] flex-1 items-center justify-center rounded-full bg-hockia-primary text-body font-semibold text-white active:opacity-90">
                Apply
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
