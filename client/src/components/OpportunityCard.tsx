import { MapPin, Calendar, Home, Car, Globe as GlobeIcon, Plane, Utensils, Briefcase, Shield, GraduationCap, Award, DollarSign, Dumbbell, ChevronRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { Vacancy } from '../lib/supabase'
import Avatar from './Avatar'
import { opportunityGenderToTeamLabel } from '@/lib/hockeyCategories'

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

const MAX_VISIBLE_PERKS = 3

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
 * OpportunityCard — an App Store-style editorial bento tile. The whole
 * tile is one tap target → the opportunity detail view (where Apply
 * lives); no Apply/View buttons in the feed.
 *
 * Tiles are intentionally NOT uniform height: a richly-completed
 * opportunity (description, recruiting-for, benefits) renders a taller
 * tile than a sparse one. The page lays them out in a masonry grid so
 * the feed reads as a dynamic bento, not a repetitive list.
 *
 * Opening type is coded — emerald = player opening, blue = coach
 * opening — and stated in words in the eyebrow label.
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

  // Coded opening type — matches HOCKIA's app-wide role colours
  // (RoleBadge): player = blue (#2563EB), coach = teal-green (#0D9488).
  const accent = isPlayerOpening
    ? { dot: 'bg-blue-600', text: 'text-blue-600', ring: 'bg-blue-600' }
    : { dot: 'bg-teal-600', text: 'text-teal-600', ring: 'bg-teal-600' }
  const openingLabel = isPlayerOpening ? 'Player opening' : 'Coach opening'

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

  // Key pills — team category + position. Both are player-only concepts,
  // so they are suppressed on coach openings even if a legacy row carries
  // stale values (mirrors OpportunityDetailView).
  const pills: string[] = []
  if (isPlayerOpening && vacancy.gender) {
    const teamLabel = opportunityGenderToTeamLabel(vacancy.gender)
    if (teamLabel) pills.push(teamLabel.replace(' Team', ''))
  }
  if (isPlayerOpening && vacancy.position) {
    pills.push(vacancy.position.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))
  }

  const benefits = vacancy.benefits || []
  const visibleBenefits = benefits.slice(0, MAX_VISIBLE_PERKS)
  const extraBenefits = benefits.length - visibleBenefits.length

  // Identity — club cards lead with the club; coach cards lead with the coach.
  const publisherName = cardType === 'club' ? (worldClub?.clubName || clubName) : clubName
  const publisherLogo = cardType === 'club' ? (worldClub?.avatarUrl || clubLogo) : clubLogo
  const locationText = [vacancy.location_city, vacancy.location_country].filter(Boolean).join(', ')
  const descriptionExcerpt = vacancy.description?.trim() || ''

  return (
    <div className="animate-fadeSlideIn break-inside-avoid mb-4">
      <div
        onClick={onViewDetails}
        className="group relative flex flex-col cursor-pointer rounded-2xl border border-gray-100 bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_10px_28px_-14px_rgba(0,0,0,0.12)] transition-all duration-200 ease-out hover:-translate-y-1 hover:border-gray-200 hover:shadow-[0_4px_10px_rgba(0,0,0,0.05),0_22px_44px_-16px_rgba(0,0,0,0.22)] active:translate-y-0 active:scale-[0.985]"
      >
        {/* ── Header: opening type · country ── */}
        <div className="flex items-center justify-between gap-2">
          <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider ${accent.text}`}>
            <span className={`h-2 w-2 rounded-full ${accent.dot}`} aria-hidden="true" />
            {openingLabel}
          </span>
          {vacancy.location_country && (
            <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full border border-gray-100 bg-gray-50 py-1 pl-2 pr-1 text-[12px] font-medium text-gray-600">
              {countryFlag && <span aria-hidden="true">{countryFlag}</span>}
              <span className="max-w-[110px] truncate">{vacancy.location_country}</span>
              <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
            </span>
          )}
        </div>

        {/* ── Identity: logo · title · creator ── */}
        <div className="mt-4 flex items-start gap-3.5">
          <div className="relative flex-shrink-0">
            <Avatar
              src={publisherLogo}
              initials={getInitials(publisherName)}
              alt={publisherName}
              size="lg"
              role={publisherRole}
              className="ring-1 ring-black/5"
            />
            <span
              className={`absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full ring-2 ring-white ${accent.ring}`}
              aria-hidden="true"
            />
          </div>

          <div className="min-w-0 flex-1">
            <h2 className="line-clamp-2 text-[17px] font-bold leading-snug text-gray-900 transition-colors group-hover:text-[#8026FA]">
              {vacancy.title}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
              <button
                type="button"
                onClick={handlePublisherClick}
                className="max-w-full truncate text-[13px] font-semibold text-gray-700 hover:text-[#8026FA]"
              >
                {publisherName}
              </button>
              <span className="flex-shrink-0 rounded border border-gray-200 bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-500">
                {isCoachPublisher ? 'Coach' : 'Club'}
              </span>
            </div>
          </div>
        </div>

        {/* ── Recruiting-for — its own full-width row so the club name is
             always readable (no aggressive truncation). Coach-posted
             listings only; a club posts for itself. ── */}
        {cardType === 'coach_club' && worldClub && (
          <button
            type="button"
            onClick={handleWorldClubClick}
            className="mt-3 flex w-full items-center gap-2.5 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-left transition-colors hover:border-[#8026FA]/30 hover:bg-[#8026FA]/[0.04]"
          >
            <Avatar
              src={worldClub.avatarUrl}
              initials={getInitials(worldClub.clubName)}
              alt={worldClub.clubName}
              size="sm"
              role="club"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                Recruiting for
              </span>
              <span className="block text-[13.5px] font-semibold leading-snug text-gray-800 group-hover:text-gray-900">
                {worldClub.clubName}
              </span>
            </span>
            <ChevronRight className="h-4 w-4 flex-shrink-0 text-gray-400" />
          </button>
        )}
        {cardType === 'coach_club' && !worldClub && publisherOrganization && (
          <div className="mt-3 flex w-full items-center gap-2.5 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
            <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gray-200 text-gray-500">
              <Award className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                Recruiting for
              </span>
              <span className="block text-[13.5px] font-semibold leading-snug text-gray-800">
                {publisherOrganization}
              </span>
            </span>
          </div>
        )}

        {/* ── Key pills ── */}
        {pills.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {pills.map((pill) => (
              <span
                key={pill}
                className="inline-flex items-center rounded-full border border-[#8026FA]/10 bg-[#8026FA]/[0.06] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#8026FA]"
              >
                {pill}
              </span>
            ))}
          </div>
        )}

        {/* ── Description excerpt — only on opportunities that have one,
             so richer listings naturally produce taller tiles. ── */}
        {descriptionExcerpt && (
          <p className="mt-3 line-clamp-2 text-[13px] leading-relaxed text-gray-500">
            {descriptionExcerpt}
          </p>
        )}

        {/* ── Meta: location · start (always present) ── */}
        <div className="my-3.5 border-t border-gray-100" />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-gray-500">
          {locationText && (
            <span className="flex min-w-0 items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="truncate">{locationText}</span>
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5 flex-shrink-0" />
            {isImmediate ? 'Starts immediately' : `Starts ${formatDate(vacancy.start_date)}`}
          </span>
        </div>

        {/* ── Benefits ── */}
        {benefits.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {visibleBenefits.map((benefit) => {
              const config = BENEFIT_CONFIG[benefit.toLowerCase()]
              if (!config) return null
              const Icon = config.icon
              return (
                <span
                  key={benefit}
                  className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-medium text-gray-600"
                >
                  <Icon className={`h-3.5 w-3.5 ${config.iconColor}`} />
                  {config.label}
                </span>
              )
            })}
            {extraBenefits > 0 && (
              <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-[11px] font-medium text-gray-500">
                +{extraBenefits} more
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
