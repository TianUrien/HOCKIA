import { MapPin, Calendar, Clock, Home, Car, Globe as GlobeIcon, Plane, Utensils, Briefcase, Shield, GraduationCap, AlertTriangle, Share2, Award, DollarSign, Dumbbell } from 'lucide-react'
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
  leagueDivision?: string | null
  worldClub?: WorldClubInfo | null
  onViewDetails: () => void
  onApply?: () => void
  hasApplied?: boolean
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

function getDeadlineInfo(deadline: string | null | undefined): { text: string; urgent: boolean } | null {
  if (!deadline) return null
  const now = new Date()
  const dl = new Date(deadline)
  const daysLeft = Math.ceil((dl.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  if (daysLeft < 0) return null
  if (daysLeft === 0) return { text: 'Closes today', urgent: true }
  if (daysLeft === 1) return { text: 'Closes tomorrow', urgent: true }
  return { text: `${daysLeft} days left`, urgent: daysLeft <= 7 }
}

// Curated accent palette — a deterministic pick per club gives each card a
// subtle brand identity (thin top bar + logo-fallback tint) without the old
// full-height watermark hero. Static class strings so Tailwind JIT keeps them.
const ACCENTS = [
  { bar: 'bg-rose-500', chipBg: 'bg-rose-100', chipText: 'text-rose-700' },
  { bar: 'bg-orange-500', chipBg: 'bg-orange-100', chipText: 'text-orange-700' },
  { bar: 'bg-emerald-500', chipBg: 'bg-emerald-100', chipText: 'text-emerald-700' },
  { bar: 'bg-teal-500', chipBg: 'bg-teal-100', chipText: 'text-teal-700' },
  { bar: 'bg-sky-500', chipBg: 'bg-sky-100', chipText: 'text-sky-700' },
  { bar: 'bg-blue-500', chipBg: 'bg-blue-100', chipText: 'text-blue-700' },
  { bar: 'bg-indigo-500', chipBg: 'bg-indigo-100', chipText: 'text-indigo-700' },
  { bar: 'bg-fuchsia-500', chipBg: 'bg-fuchsia-100', chipText: 'text-fuchsia-700' },
]

/** Deterministic brand accent (from the curated palette) for a name. */
function getClubAccent(name: string): typeof ACCENTS[number] {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return ACCENTS[Math.abs(hash) % ACCENTS.length]
}

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
 * OpportunityCard — compact, scannable card. One horizontal header row
 * (logo + publisher + location + country), a pill row, the title, a
 * one-line meta row, compact benefit pills, and a footer row (deadline +
 * View / Apply). Stretches to fill its grid cell so footers align across
 * a row; the full description / benefits live on the detail view.
 */
export default function OpportunityCard({
  vacancy,
  clubName,
  clubLogo,
  clubId,
  publisherRole,
  publisherOrganization,
  leagueDivision,
  worldClub,
  onViewDetails,
  onApply,
  hasApplied = false,
}: OpportunityCardProps) {
  const navigate = useNavigate()

  const cardType = getCardType(publisherRole, worldClub, publisherOrganization)
  const isCoach = cardType !== 'club'
  const isUrgent = vacancy.priority === 'high'
  const deadlineInfo = getDeadlineInfo(vacancy.application_deadline)
  const isImmediate = !vacancy.start_date

  const handleApplyClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onApply?.()
  }

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

  // Pills — "Looking for X" + (player only) team category + position.
  const tags: string[] = []
  const isPlayerOpportunity = vacancy.opportunity_type === 'player'
  if (isPlayerOpportunity) tags.push('Looking for Player')
  else if (vacancy.opportunity_type === 'coach') tags.push('Looking for Coach')
  if (isPlayerOpportunity && vacancy.gender) {
    const teamLabel = opportunityGenderToTeamLabel(vacancy.gender)
    if (teamLabel) tags.push(teamLabel.replace(' Team', ''))
  }
  if (isPlayerOpportunity && vacancy.position) {
    tags.push(vacancy.position.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))
  }

  const benefits = vacancy.benefits || []
  const visibleBenefits = benefits.slice(0, 3)
  const extraBenefits = benefits.length - visibleBenefits.length

  // Identity — club cards lead with the club; coach cards lead with the coach.
  const headerName = cardType === 'club' ? (worldClub?.clubName || clubName) : clubName
  const headerLogo = cardType === 'club' ? (worldClub?.avatarUrl || clubLogo) : clubLogo
  const displayLeague = worldClub?.leagueName || leagueDivision
  const accent = getClubAccent(headerName)
  const locationLine = [vacancy.location_city, displayLeague].filter(Boolean).join(' · ')

  return (
    <div
      onClick={onViewDetails}
      className="group flex flex-col bg-white border border-gray-200 rounded-2xl overflow-hidden cursor-pointer transition-all duration-200 hover:shadow-md hover:border-gray-300"
    >
      {/* Subtle brand accent — replaces the old full-height watermark hero. */}
      <div className={`h-[3px] flex-shrink-0 ${accent.bar}`} aria-hidden="true" />

      <div className="flex flex-1 flex-col p-4">
        {/* ── Header row ── */}
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={handlePublisherClick}
            className="flex-shrink-0 rounded-lg transition-opacity hover:opacity-80"
            aria-label={`View ${headerName}`}
          >
            {headerLogo ? (
              <StorageImage
                src={headerLogo}
                alt={headerName}
                className="w-11 h-11 rounded-lg object-cover ring-1 ring-gray-200"
              />
            ) : (
              <div
                className={`w-11 h-11 rounded-lg flex items-center justify-center text-sm font-bold ${accent.chipBg} ${accent.chipText}`}
              >
                {getInitials(headerName)}
              </div>
            )}
          </button>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handlePublisherClick}
                className="truncate text-[15px] font-bold text-gray-900 transition-colors group-hover:text-[#8026FA]"
              >
                {headerName}
              </button>
              <span
                className={`flex-shrink-0 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                  isCoach
                    ? 'bg-[#F0FDFA] text-[#0D9488] border border-teal-100'
                    : 'bg-[#8026FA]/10 text-[#8026FA]'
                }`}
              >
                {isCoach ? 'Coach' : 'Club'}
              </span>
            </div>

            {/* Coach → club relationship, inline. */}
            {cardType === 'coach_club' && worldClub && (
              <button
                type="button"
                onClick={handleWorldClubClick}
                className="mt-0.5 flex items-center gap-1 min-w-0 text-xs text-gray-500 hover:text-gray-700"
              >
                <span className="flex-shrink-0">Recruiting for</span>
                {worldClub.avatarUrl ? (
                  <StorageImage
                    src={worldClub.avatarUrl}
                    alt={worldClub.clubName}
                    className="w-4 h-4 rounded-full object-cover flex-shrink-0"
                  />
                ) : (
                  <Award className="w-3.5 h-3.5 flex-shrink-0 text-gray-400" />
                )}
                <span className="truncate font-medium">{worldClub.clubName}</span>
              </button>
            )}
            {cardType === 'coach_club' && !worldClub && publisherOrganization && (
              <p className="mt-0.5 truncate text-xs text-gray-500">
                Recruiting for <span className="font-medium">{publisherOrganization}</span>
              </p>
            )}

            {locationLine && (
              <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-gray-500">
                <MapPin className="w-3 h-3 flex-shrink-0" />
                <span className="truncate">{locationLine}</span>
              </p>
            )}
          </div>

          <div className="flex flex-shrink-0 flex-col items-end gap-1.5">
            <button
              type="button"
              onClick={handleShareClick}
              className="-mr-1 -mt-1 rounded-full p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
              aria-label="Share opportunity"
            >
              <Share2 className="w-4 h-4" />
            </button>
            {vacancy.location_country && (
              <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] text-gray-600">
                {worldClub?.flagEmoji && <span aria-hidden="true">{worldClub.flagEmoji}</span>}
                <span className="max-w-[90px] truncate">{vacancy.location_country}</span>
              </span>
            )}
          </div>
        </div>

        {/* ── Pills ── */}
        {(tags.length > 0 || isUrgent) && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {isUrgent && (
              <span className="inline-flex items-center gap-1 rounded-full border border-orange-100 bg-orange-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-orange-600">
                <AlertTriangle className="w-3 h-3" />
                Urgent
              </span>
            )}
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center rounded-full border border-[#8026FA]/10 bg-[#8026FA]/[0.06] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#8026FA]"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* ── Title ── */}
        <h2 className="mt-2.5 line-clamp-2 text-base font-bold leading-snug text-gray-900 transition-colors group-hover:text-[#8026FA]">
          {vacancy.title}
        </h2>

        {/* ── Meta line ── */}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-gray-500">
          <span className="flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5 flex-shrink-0" />
            {isImmediate ? 'Starts immediately' : `Starts ${formatDate(vacancy.start_date)}`}
          </span>
          {vacancy.duration_text && (
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 flex-shrink-0" />
              {vacancy.duration_text}
            </span>
          )}
        </div>

        {/* ── Benefits (compact) ── */}
        {visibleBenefits.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
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
              <span className="text-[11px] font-medium text-gray-400">+{extraBenefits} more</span>
            )}
          </div>
        )}

        {/* ── Footer — pinned to the bottom so rows align ── */}
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-gray-100 pt-3">
          {deadlineInfo ? (
            <span
              className={`flex items-center gap-1 text-xs ${
                deadlineInfo.urgent ? 'font-semibold text-orange-600' : 'text-gray-500'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              {deadlineInfo.text}
            </span>
          ) : (
            <span aria-hidden="true" />
          )}

          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={onViewDetails}
              className="rounded-lg border border-gray-200 px-3.5 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              View
            </button>
            {hasApplied ? (
              <span className="inline-flex items-center gap-1 rounded-lg border border-[#8026FA]/15 bg-[#8026FA]/5 px-3.5 py-2 text-sm font-semibold text-[#8026FA]">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
                Applied
              </span>
            ) : onApply ? (
              <button
                type="button"
                onClick={handleApplyClick}
                className="rounded-lg bg-gradient-to-r from-[#8026FA] to-[#924CEC] px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
              >
                Apply
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
