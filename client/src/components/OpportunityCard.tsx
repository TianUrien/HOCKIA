import { MapPin, Calendar, Clock, Home, Car, Globe as GlobeIcon, Plane, Utensils, Briefcase, Shield, GraduationCap, AlertTriangle, Share2, Award, DollarSign, Dumbbell, Eye, Flag } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { Vacancy } from '../lib/supabase'
import { Avatar } from './index'
import StorageImage from './StorageImage'
import { opportunityGenderToTeamLabel } from '@/lib/hockeyCategories'
import Button from './Button'

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

/** Generate a short abbreviation from a club name for the watermark */
function getClubAbbreviation(name: string): string {
  const words = name.split(/\s+/).filter(Boolean)
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase()
  return words.map(w => w[0]).join('').slice(0, 4).toUpperCase()
}

/** Deterministic brand colors from a club name — background tint + watermark text */
function getClubBrandColors(name: string): { bgTint: string; watermarkColor: string } {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  const hue = Math.abs(hash) % 360
  return {
    bgTint: `hsla(${hue}, 20%, 80%, 0.10)`,         // subtle colored background
    watermarkColor: `hsla(${hue}, 25%, 55%, 0.06)`,  // text visible but subtle
  }
}

/**
 * Determines the card type:
 * - "club"  → club posting directly (publisherRole is 'club' or null/undefined)
 * - "coach_club" → coach posting for a club (has worldClub or organization_name)
 * - "coach_independent" → coach posting independently
 */
function getCardType(publisherRole: string | null | undefined, worldClub: WorldClubInfo | null | undefined, organizationName: string | null | undefined): 'club' | 'coach_club' | 'coach_independent' {
  if (publisherRole !== 'coach') return 'club'
  if (worldClub || organizationName) return 'coach_club'
  return 'coach_independent'
}

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
  const isUrgent = vacancy.priority === 'high'
  const deadlineInfo = getDeadlineInfo(vacancy.application_deadline)
  const isImmediate = !vacancy.start_date

  const handleApplyClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onApply?.()
  }

  const handleShareClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    const url = `${window.location.origin}/opportunities/${vacancy.id}`
    if (navigator.share) {
      navigator.share({ title: vacancy.title, url }).catch(() => {})
    } else {
      navigator.clipboard.writeText(url).catch(() => {})
    }
  }

  const handlePublisherClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    navigate(publisherRole === 'coach' ? `/players/id/${clubId}` : `/clubs/id/${clubId}`)
  }

  const handleWorldClubClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (worldClub) navigate(`/world/clubs/${worldClub.id}`)
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return null
    return new Date(dateString).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
  }

  // Build tag pills. Phase 3d — opportunityGenderToTeamLabel handles all
  // five enum values (Men/Women/Girls/Boys/Mixed) with possessive labels
  // ("Men's Team", "Girls' Team", etc.).
  const tags: string[] = []
  if (vacancy.opportunity_type === 'player') tags.push('Player')
  if (vacancy.opportunity_type === 'coach') tags.push('Coach')
  if (vacancy.gender) {
    const teamLabel = opportunityGenderToTeamLabel(vacancy.gender)
    if (teamLabel) tags.push(teamLabel.replace(' Team', ''))
  }
  if (vacancy.position) {
    tags.push(vacancy.position.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))
  }

  const benefits = vacancy.benefits?.slice(0, 4) || []

  // Watermark data — used on all card types
  const watermarkName = cardType === 'club' ? (worldClub?.clubName || clubName) : clubName
  const clubAbbr = getClubAbbreviation(watermarkName)
  const { bgTint, watermarkColor } = getClubBrandColors(watermarkName)
  const displayClubName = worldClub?.clubName || clubName
  const displayClubLogo = worldClub?.avatarUrl || clubLogo
  const displayLeague = worldClub?.leagueName || leagueDivision

  return (
    <div
      onClick={onViewDetails}
      className="bg-white border border-gray-200 rounded-2xl overflow-hidden cursor-pointer transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5 group"
    >
      {/* ─── CARD TYPE A: CLUB OPPORTUNITY ─── */}
      {cardType === 'club' && (
        <>
          {/* Club Hero Section with watermark */}
          <div className="relative overflow-hidden pt-8 pb-5 px-5 border-b border-gray-100" style={{ backgroundColor: bgTint }}>
            {/* Watermark */}
            <div
              className="absolute inset-0 flex items-center justify-center pointer-events-none select-none overflow-hidden"
              aria-hidden="true"
            >
              <span
                className="text-[180px] font-black leading-none tracking-tighter"
                style={{ color: watermarkColor }}
              >
                {clubAbbr}
              </span>
            </div>

            {/* Club logo + info */}
            <div className="relative flex flex-col items-center text-center">
              <button
                type="button"
                onClick={handlePublisherClick}
                className="flex flex-col items-center hover:opacity-80 transition-opacity"
              >
                {displayClubLogo ? (
                  <StorageImage
                    src={displayClubLogo}
                    alt={displayClubName}
                    className="w-20 h-20 rounded-xl object-cover shadow-sm"
                  />
                ) : (
                  <Avatar
                    initials={displayClubName.split(' ').map(n => n[0]).join('').slice(0, 2)}
                    size="xl"
                    className="rounded-xl"
                    role="club"
                  />
                )}
                <h3 className="mt-3 text-base font-bold text-gray-900 group-hover:text-[#8026FA] transition-colors">
                  {displayClubName}
                </h3>
              </button>
              {displayLeague && (
                <p className="text-sm text-gray-500 mt-0.5">{displayLeague}</p>
              )}
            </div>
          </div>
        </>
      )}

      {/* ─── CARD TYPE B: COACH + CLUB ─── */}
      {cardType === 'coach_club' && (
        <div className="relative overflow-hidden pt-6 pb-4 px-5 border-b border-gray-100" style={{ backgroundColor: bgTint }}>
          {/* Watermark */}
          <div
            className="absolute inset-0 flex items-center justify-center pointer-events-none select-none overflow-hidden"
            aria-hidden="true"
          >
            <span
              className="text-[180px] font-black leading-none tracking-tighter"
              style={{ color: watermarkColor }}
            >
              {clubAbbr}
            </span>
          </div>
          {/* Coach hero */}
          <div className="relative flex flex-col items-center text-center mb-3">
            <button
              type="button"
              onClick={handlePublisherClick}
              className="flex flex-col items-center hover:opacity-80 transition-opacity"
            >
              <Avatar
                src={clubLogo}
                initials={clubName.split(' ').map(n => n[0]).join('').slice(0, 2)}
                size="lg"
                role="club"
              />
              <div className="mt-2 flex items-center gap-1.5">
                <span className="text-base font-bold text-gray-900 group-hover:text-[#8026FA] transition-colors">
                  {clubName}
                </span>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-[#F0FDFA] text-[#0D9488] border border-teal-100">
                  Coach
                </span>
              </div>
            </button>

            {/* Club association — arrow shows "coach → club" relationship */}
            {worldClub ? (
              <div className="mt-1.5 flex flex-col items-center">
                <div className="flex items-center gap-1">
                  <span className="text-gray-400 text-sm">↳</span>
                  <button
                    type="button"
                    onClick={handleWorldClubClick}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/60 border border-gray-200 hover:bg-white transition-colors"
                  >
                    {worldClub.avatarUrl ? (
                      <StorageImage
                        src={worldClub.avatarUrl}
                        alt={worldClub.clubName}
                        className="w-4 h-4 rounded-full object-cover"
                      />
                    ) : (
                      <Award className="w-3.5 h-3.5 text-gray-400" />
                    )}
                    <span className="text-xs font-medium text-gray-700">{worldClub.clubName}</span>
                  </button>
                </div>
                {displayLeague && (
                  <p className="text-sm text-gray-500 mt-0.5">{displayLeague}</p>
                )}
              </div>
            ) : publisherOrganization ? (
              <div className="mt-1.5 flex items-center gap-1">
                <span className="text-gray-400 text-sm">↳</span>
                <span className="text-sm text-gray-600">{publisherOrganization}</span>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* ─── CARD TYPE C: COACH INDEPENDENT ─── */}
      {cardType === 'coach_independent' && (
        <div className="relative overflow-hidden pt-6 pb-4 px-5 border-b border-gray-100" style={{ backgroundColor: bgTint }}>
          {/* Watermark */}
          <div
            className="absolute inset-0 flex items-center justify-center pointer-events-none select-none overflow-hidden"
            aria-hidden="true"
          >
            <span
              className="text-[180px] font-black leading-none tracking-tighter"
              style={{ color: watermarkColor }}
            >
              {clubAbbr}
            </span>
          </div>
          <div className="relative flex flex-col items-center text-center mb-3">
            <button
              type="button"
              onClick={handlePublisherClick}
              className="flex flex-col items-center hover:opacity-80 transition-opacity"
            >
              <Avatar
                src={clubLogo}
                initials={clubName.split(' ').map(n => n[0]).join('').slice(0, 2)}
                size="lg"
                role="club"
              />
              <div className="mt-2 flex items-center gap-1.5">
                <span className="text-base font-bold text-gray-900 group-hover:text-[#8026FA] transition-colors">
                  {clubName}
                </span>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-[#F0FDFA] text-[#0D9488] border border-teal-100">
                  Coach
                </span>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* ─── SHARED BODY (all card types) ─── */}
      <div className="px-6 pt-5 pb-6">
        {/* Top row: badges left + share icon right */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            {isUrgent && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-orange-50 text-orange-600 border border-orange-100">
                <AlertTriangle className="w-3 h-3" />
                URGENT
              </span>
            )}
            {cardType !== 'club' && (
              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-[#F0FDFA] text-[#0D9488] border border-teal-100">
                COACH LISTED
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={handleShareClick}
            className="p-2 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            aria-label="Share opportunity"
          >
            <Share2 className="w-[18px] h-[18px]" />
          </button>
        </div>

        {/* Title */}
        <h2 className="text-xl font-bold text-gray-900 mb-4 leading-tight group-hover:text-[#8026FA] transition-colors">
          {vacancy.title}
        </h2>

        {/* Meta info */}
        <div className="space-y-1.5 text-[15px] text-gray-500 mb-5">
          <div className="flex items-center gap-x-5 flex-wrap">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 flex-shrink-0" />
              <span>{vacancy.location_city}</span>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 flex-shrink-0" />
              <span>{isImmediate ? 'Starts Immediately' : `Starts ${formatDate(vacancy.start_date)}`}</span>
            </div>
          </div>
          {vacancy.duration_text && (
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 flex-shrink-0" />
              <span>{vacancy.duration_text}</span>
            </div>
          )}
        </div>

        {/* Tags */}
        <div className="flex items-center flex-wrap gap-2 mb-6">
          {tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center px-4 py-1.5 rounded-full text-sm font-medium bg-gray-100 text-gray-700 border border-gray-200"
            >
              {tag}
            </span>
          ))}
        </div>

        {/* Benefits section */}
        {benefits.length > 0 && (
          <div className="mb-6">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-3">
              Benefits Included
            </p>
            <div className="flex items-center flex-wrap gap-2.5">
              {benefits.map((benefit) => {
                const config = BENEFIT_CONFIG[benefit.toLowerCase()]
                if (!config) return null
                const Icon = config.icon
                return (
                  <span
                    key={benefit}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium bg-gray-50 text-gray-700 border border-gray-200"
                  >
                    <Icon className={`w-4 h-4 ${config.iconColor}`} />
                    {config.label}
                  </span>
                )
              })}
            </div>
          </div>
        )}

        {/* EU Passport Requirement */}
        {(vacancy as Record<string, unknown>).eu_passport_required === true && (
          <div className="mb-4">
            <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium bg-blue-50 text-blue-700 border border-blue-200">
              <Flag className="w-4 h-4 text-blue-500" />
              EU Passport Required
            </span>
          </div>
        )}

        {/* Deadline */}
        {deadlineInfo && (
          <div className="flex items-center justify-center gap-2 text-sm text-gray-500 mb-4">
            <Clock className="w-4 h-4" />
            <span>{deadlineInfo.text}</span>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-2.5" onClick={(e) => e.stopPropagation()}>
          {hasApplied ? (
            <div className="flex-1 flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl font-semibold text-sm border border-[#8026FA]/15 bg-[#8026FA]/5 text-[#8026FA]">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth="2.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
              Applied
            </div>
          ) : onApply ? (
            <Button
              onClick={handleApplyClick}
              className="flex-1 rounded-xl py-3.5 bg-gradient-to-r from-[#8026FA] to-[#924CEC] hover:opacity-90 text-base font-semibold"
            >
              Apply Now &rsaquo;
            </Button>
          ) : null}
          {/* View details button */}
          <button
            type="button"
            onClick={onViewDetails}
            className="flex items-center justify-center w-12 h-12 rounded-xl border border-gray-200 bg-gray-50 text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors flex-shrink-0"
            aria-label="View full details"
          >
            <Eye className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  )
}
