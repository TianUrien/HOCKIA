import { MapPin, Calendar, Home, Car, Globe as GlobeIcon, Plane, Utensils, Briefcase, Shield, GraduationCap, Share2, Award, DollarSign, Dumbbell } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { Vacancy } from '../lib/supabase'
import StorageImage from './StorageImage'
import { opportunityGenderToTeamLabel } from '@/lib/hockeyCategories'
import { getShareOrigin } from '@/lib/profileShare'

export interface WorldClubInfo {
  id: string
  clubName: string
  avatarUrl: string | null
  countryName: string | null
  flagEmoji: string | null
  leagueName: string | null
}

interface OpportunityCardProps {
  vacancy: Vacancy
  clubName: string
  clubLogo?: string | null
  clubId: string
  publisherRole?: string | null
  publisherOrganization?: string | null
  worldClub?: WorldClubInfo | null
  /** Flag emoji for vacancy.location_country (resolved from the countries
   *  table by the page — the canonical flag, not a denormalised one). */
  countryFlag?: string | null
  onViewDetails: () => void
}

const BENEFIT_CONFIG: Record<string, { icon: React.ComponentType<{ className?: string }>; label: string; iconColor: string }> = {
  housing: { icon: Home, label: 'Housing', iconColor: 'text-blue-500' },
  car: { icon: Car, label: 'Car', iconColor: 'text-amber-500' },
  visa: { icon: GlobeIcon, label: 'Visa', iconColor: 'text-emerald-500' },
  flights: { icon: Plane, label: 'Flights', iconColor: 'text-purple-500' },
  meals: { icon: Utensils, label: 'Meals', iconColor: 'text-orange-500' },
  job: { icon: Briefcase, label: 'Job', iconColor: 'text-cyan-500' },
  insurance: { icon: Shield, label: 'Insurance', iconColor: 'text-rose-500' },
  education: { icon: GraduationCap, label: 'Education', iconColor: 'text-indigo-500' },
  bonuses: { icon: DollarSign, label: 'Bonuses', iconColor: 'text-green-500' },
  equipment: { icon: Dumbbell, label: 'Equipment', iconColor: 'text-teal-500' },
}

const MAX_VISIBLE_PERKS = 4

function getInitials(name: string): string {
  return name.split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

/**
 * Card type:
 * - "club"             → club posting directly
 * - "coach_club"       → coach posting, recruiting for a (world) club
 * - "coach_independent"→ coach posting independently
 */
function getCardType(publisherRole: string | null | undefined, worldClub: WorldClubInfo | null | undefined, organizationName: string | null | undefined): 'club' | 'coach_club' | 'coach_independent' {
  if (publisherRole !== 'coach') return 'club'
  if (worldClub || organizationName) return 'coach_club'
  return 'coach_independent'
}

/**
 * OpportunityCard — compact, scannable list card. The whole card is one
 * tap target → the opportunity detail page (where Apply lives). No Apply
 * or View buttons here: the list is for browsing and comparing.
 *
 * The 3px top accent is a coded signal — emerald = player opening, blue =
 * coach opening (legend on the page); mirrored by a visually-hidden label.
 */
export default function OpportunityCard({
  vacancy,
  clubName,
  clubLogo,
  clubId,
  publisherRole,
  publisherOrganization,
  worldClub,
  countryFlag,
  onViewDetails,
}: OpportunityCardProps) {
  const navigate = useNavigate()

  const cardType = getCardType(publisherRole, worldClub, publisherOrganization)
  const isCoachPublisher = cardType !== 'club'
  const isPlayerOpening = vacancy.opportunity_type === 'player'
  const isImmediate = !vacancy.start_date

  const accentBar = isPlayerOpening ? 'bg-emerald-500' : 'bg-blue-500'
  const openingLabel = isPlayerOpening ? 'Player opening' : 'Coach opening'

  const handleShareClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    const url = `${getShareOrigin()}/opportunities/${vacancy.id}`
    if (navigator.share) {
      navigator.share({ title: vacancy.title, url }).catch(() => {})
    } else {
      navigator.clipboard.writeText(url).catch(() => {})
    }
  }

  const handlePublisherClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (publisherRole === 'coach') navigate(`/coaches/id/${clubId}`)
    else navigate(`/clubs/id/${clubId}`)
  }

  const handleWorldClubClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (worldClub) navigate(`/world/clubs/${worldClub.id}`)
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return null
    return new Date(dateString).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
  }

  // Key pills — team category + position.
  const pills: string[] = []
  if (isPlayerOpening && vacancy.gender) {
    const teamLabel = opportunityGenderToTeamLabel(vacancy.gender)
    if (teamLabel) pills.push(teamLabel.replace(' Team', ''))
  }
  if (vacancy.position) {
    pills.push(vacancy.position.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))
  }
  if (pills.length === 0) pills.push(isPlayerOpening ? 'Player' : 'Coach')

  const benefits = vacancy.benefits || []
  const visibleBenefits = benefits.slice(0, MAX_VISIBLE_PERKS)
  const extraBenefits = benefits.length - visibleBenefits.length

  // Identity — club cards lead with the club; coach cards lead with the coach.
  const publisherName = cardType === 'club' ? (worldClub?.clubName || clubName) : clubName
  const publisherLogo = cardType === 'club' ? (worldClub?.avatarUrl || clubLogo) : clubLogo
  const locationText = [vacancy.location_city, vacancy.location_country].filter(Boolean).join(', ')

  return (
    <div
      onClick={onViewDetails}
      className="group flex flex-col bg-white border border-gray-200 rounded-2xl overflow-hidden cursor-pointer transition-all duration-200 hover:shadow-md hover:border-gray-300"
    >
      {/* Coded accent — emerald = player opening, blue = coach opening. */}
      <div className={`h-[3px] flex-shrink-0 ${accentBar}`} aria-hidden="true" />
      <span className="sr-only">{openingLabel}</span>

      <div className="p-4">
        {/* ── Identity strip: poster · country · share ── */}
        <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={handlePublisherClick}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            {publisherLogo ? (
              <StorageImage
                src={publisherLogo}
                alt={publisherName}
                className="w-10 h-10 flex-shrink-0 rounded-lg object-cover ring-1 ring-gray-200"
              />
            ) : (
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 text-xs font-bold text-gray-500">
                {getInitials(publisherName)}
              </div>
            )}
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-[13px] font-semibold text-gray-900 transition-colors group-hover:text-[#8026FA]">
                {publisherName}
              </span>
              <span className="flex-shrink-0 rounded border border-gray-200 bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-500">
                {isCoachPublisher ? 'Coach' : 'Club'}
              </span>
            </span>
          </button>

          <div className="flex flex-shrink-0 items-center gap-1">
            {vacancy.location_country && (
              <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] text-gray-600">
                {countryFlag && <span aria-hidden="true">{countryFlag}</span>}
                <span className="max-w-[88px] truncate">{vacancy.location_country}</span>
              </span>
            )}
            <button
              type="button"
              onClick={handleShareClick}
              className="-mr-1 flex h-9 w-9 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
              aria-label="Share opportunity"
            >
              <Share2 className="w-[18px] h-[18px]" />
            </button>
          </div>
        </div>

        {/* ── Title ── */}
        <h2 className="mt-3 line-clamp-2 text-base font-bold leading-snug text-gray-900 transition-colors group-hover:text-[#8026FA]">
          {vacancy.title}
        </h2>

        {/* ── Key pills ── */}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {pills.map((pill) => (
            <span
              key={pill}
              className="inline-flex items-center rounded-full border border-[#8026FA]/10 bg-[#8026FA]/[0.06] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#8026FA]"
            >
              {pill}
            </span>
          ))}
        </div>

        <div className="my-3 border-t border-gray-100" />

        {/* ── Recruiting-for + location + start ── */}
        <div className="space-y-1.5 text-[13px] text-gray-500">
          {cardType === 'coach_club' && worldClub && (
            <p className="flex items-center gap-1">
              <span className="flex-shrink-0 text-gray-400">↳</span>
              <span className="flex-shrink-0">Recruiting for:</span>
              <button
                type="button"
                onClick={handleWorldClubClick}
                className="flex min-w-0 items-center gap-1 font-medium text-gray-700 hover:text-[#8026FA]"
              >
                {worldClub.avatarUrl ? (
                  <StorageImage
                    src={worldClub.avatarUrl}
                    alt={worldClub.clubName}
                    className="w-4 h-4 flex-shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <Award className="w-3.5 h-3.5 flex-shrink-0 text-gray-400" />
                )}
                <span className="truncate">{worldClub.clubName}</span>
              </button>
            </p>
          )}
          {cardType === 'coach_club' && !worldClub && publisherOrganization && (
            <p className="truncate">
              <span className="text-gray-400">↳</span> Recruiting for:{' '}
              <span className="font-medium text-gray-700">{publisherOrganization}</span>
            </p>
          )}
          {locationText && (
            <p className="flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate">{locationText}</span>
            </p>
          )}
          <p className="flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 flex-shrink-0" />
            {isImmediate ? 'Starts immediately' : `Starts ${formatDate(vacancy.start_date)}`}
          </p>
        </div>

        {/* ── Benefits ── */}
        {benefits.length > 0 && (
          <>
            <div className="my-3 border-t border-gray-100" />
            <div className="flex flex-wrap items-center gap-1.5">
              {visibleBenefits.map((benefit) => {
                const config = BENEFIT_CONFIG[benefit.toLowerCase()]
                if (!config) return null
                const Icon = config.icon
                return (
                  <span
                    key={benefit}
                    className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] font-medium text-gray-600"
                  >
                    <Icon className={`w-3.5 h-3.5 ${config.iconColor}`} />
                    {config.label}
                  </span>
                )
              })}
              {extraBenefits > 0 && (
                <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] font-medium text-gray-500">
                  +{extraBenefits} more
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
