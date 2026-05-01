import { useEffect, useState } from 'react'
import { X, MapPin, Calendar, Clock, Home, Car, Globe as GlobeIcon, Plane, Utensils, Briefcase, Shield, GraduationCap, Mail, Phone, CheckCircle, AlertTriangle, DollarSign, Dumbbell, Award, Share2, Flag } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { Vacancy } from '../lib/supabase'
import { Avatar, StorageImage } from './index'
import Button from './Button'
import type { WorldClubInfo } from './OpportunityCard'
import { opportunityGenderToTeamLabel } from '@/lib/hockeyCategories'

interface VacancyDetailViewProps {
  vacancy: Vacancy
  clubName: string
  clubLogo?: string | null
  clubId: string
  publisherRole?: string | null
  publisherOrganization?: string | null
  leagueDivision?: string | null
  worldClub?: WorldClubInfo | null
  onClose: () => void
  onApply?: () => void
  hasApplied?: boolean
  hideClubProfileButton?: boolean
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

function getClubAbbreviation(name: string): string {
  const words = name.split(/\s+/).filter(Boolean)
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase()
  return words.map(w => w[0]).join('').slice(0, 4).toUpperCase()
}

function getClubBrandColors(name: string): { bgTint: string; watermarkColor: string } {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  const hue = Math.abs(hash) % 360
  return {
    bgTint: `hsla(${hue}, 20%, 80%, 0.10)`,
    watermarkColor: `hsla(${hue}, 25%, 55%, 0.06)`,
  }
}

function getCardType(publisherRole: string | null | undefined, worldClub: WorldClubInfo | null | undefined, organizationName: string | null | undefined): 'club' | 'coach_club' | 'coach_independent' {
  if (publisherRole !== 'coach') return 'club'
  if (worldClub || organizationName) return 'coach_club'
  return 'coach_independent'
}

export default function VacancyDetailView({
  vacancy,
  clubName,
  clubLogo,
  clubId,
  publisherRole,
  publisherOrganization,
  leagueDivision,
  worldClub,
  onClose,
  onApply,
  hasApplied = false,
  hideClubProfileButton = false,
}: VacancyDetailViewProps) {
  const navigate = useNavigate()
  const [isVisible, setIsVisible] = useState(false)

  const cardType = getCardType(publisherRole, worldClub, publisherOrganization)
  const watermarkName = cardType === 'club' ? (worldClub?.clubName || clubName) : clubName
  const clubAbbr = getClubAbbreviation(watermarkName)
  const { bgTint, watermarkColor } = getClubBrandColors(watermarkName)
  const displayClubName = worldClub?.clubName || clubName
  const displayClubLogo = worldClub?.avatarUrl || clubLogo
  const displayLeague = worldClub?.leagueName || leagueDivision
  const isUrgent = vacancy.priority === 'high'

  const handleClubClick = () => {
    onClose()
    navigate(publisherRole === 'coach' ? `/players/id/${clubId}` : `/clubs/id/${clubId}`)
  }

  const handleWorldClubClick = () => {
    if (worldClub) { onClose(); navigate(`/world/clubs/${worldClub.id}`) }
  }

  const handleShareClick = () => {
    const url = `${window.location.origin}/opportunities/${vacancy.id}`
    if (navigator.share) {
      navigator.share({ title: vacancy.title, url }).catch(() => {})
    } else {
      navigator.clipboard.writeText(url).catch(() => {})
    }
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Not specified'
    return new Date(dateString).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  }

  const formatShortDate = (dateString: string | null) => {
    if (!dateString) return null
    return new Date(dateString).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
  }

  const isImmediate = !vacancy.start_date

  // Build tag pills. Phase 3d — opportunityGenderToTeamLabel covers all
  // five enum values (Men/Women/Girls/Boys/Mixed) with possessive labels.
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

  // Deadline
  let deadlineText: string | null = null
  if (vacancy.application_deadline) {
    const daysLeft = Math.ceil((new Date(vacancy.application_deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    if (daysLeft >= 0) {
      if (daysLeft === 0) deadlineText = 'Closes today'
      else if (daysLeft === 1) deadlineText = 'Closes tomorrow'
      else deadlineText = `${daysLeft} days left`
    }
  }

  useEffect(() => {
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    requestAnimationFrame(() => setIsVisible(true))
    return () => { document.body.style.overflow = originalOverflow }
  }, [])

  return (
    <div
      className={`fixed inset-0 z-50 overflow-y-auto transition-opacity duration-200 ease-out ${isVisible ? 'bg-black/50' : 'bg-black/0'}`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="min-h-screen px-4 py-8 flex items-start sm:items-center justify-center">
        <div
          className={`bg-white rounded-2xl shadow-2xl max-w-[600px] w-full relative overflow-hidden transition-all duration-200 ease-out ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}
        >
          {/* Close button — always visible top-right */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 z-10 p-2 bg-white/80 backdrop-blur-sm hover:bg-white rounded-full transition-colors shadow-sm"
            aria-label="Close"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>

          {/* ─── HERO SECTION (tinted + watermark) ─── */}
          {cardType === 'club' ? (
            <div className="relative overflow-hidden pt-8 pb-6 px-6 border-b border-gray-100" style={{ backgroundColor: bgTint }}>
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none overflow-hidden" aria-hidden="true">
                <span className="text-[180px] font-black leading-none tracking-tighter" style={{ color: watermarkColor }}>{clubAbbr}</span>
              </div>
              <div className="relative flex flex-col items-center text-center">
                <button type="button" onClick={handleClubClick} className="flex flex-col items-center hover:opacity-80 transition-opacity">
                  {displayClubLogo ? (
                    <StorageImage src={displayClubLogo} alt={displayClubName} className="w-20 h-20 rounded-xl object-cover shadow-sm" />
                  ) : (
                    <Avatar initials={displayClubName.split(' ').map(n => n[0]).join('').slice(0, 2)} size="xl" className="rounded-xl" role="club" />
                  )}
                  <h3 className="mt-3 text-lg font-bold text-gray-900">{displayClubName}</h3>
                </button>
                {displayLeague && <p className="text-sm text-gray-500 mt-0.5">{displayLeague}</p>}
              </div>
            </div>
          ) : (
            <div className="relative overflow-hidden pt-6 pb-5 px-6 border-b border-gray-100" style={{ backgroundColor: bgTint }}>
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none overflow-hidden" aria-hidden="true">
                <span className="text-[180px] font-black leading-none tracking-tighter" style={{ color: watermarkColor }}>{clubAbbr}</span>
              </div>
              <div className="relative flex flex-col items-center text-center">
                <button type="button" onClick={handleClubClick} className="flex flex-col items-center hover:opacity-80 transition-opacity">
                  <Avatar src={clubLogo} initials={clubName.split(' ').map(n => n[0]).join('').slice(0, 2)} size="lg" role="club" />
                  <div className="mt-2 flex items-center gap-1.5">
                    <span className="text-lg font-bold text-gray-900">{clubName}</span>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-[#F0FDFA] text-[#0D9488] border border-teal-100">Coach</span>
                  </div>
                </button>
                {worldClub ? (
                  <div className="mt-1.5 flex flex-col items-center">
                    <div className="flex items-center gap-1">
                      <span className="text-gray-400 text-sm">↳</span>
                      <button type="button" onClick={handleWorldClubClick} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/60 border border-gray-200 hover:bg-white transition-colors">
                        {worldClub.avatarUrl ? (
                          <StorageImage src={worldClub.avatarUrl} alt={worldClub.clubName} className="w-4 h-4 rounded-full object-cover" />
                        ) : (
                          <Award className="w-3.5 h-3.5 text-gray-400" />
                        )}
                        <span className="text-xs font-medium text-gray-700">{worldClub.clubName}</span>
                      </button>
                    </div>
                    {displayLeague && <p className="text-sm text-gray-500 mt-0.5">{displayLeague}</p>}
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

          {/* ─── BODY ─── */}
          <div className="px-6 pt-5 pb-6">
            {/* Top row: badges + share */}
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
              <button type="button" onClick={handleShareClick} className="p-2 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors" aria-label="Share opportunity">
                <Share2 className="w-[18px] h-[18px]" />
              </button>
            </div>

            {/* Title */}
            <h1 className="text-2xl font-bold text-gray-900 mb-4 leading-tight">
              {vacancy.title}
            </h1>

            {/* Meta info */}
            <div className="space-y-1.5 text-[15px] text-gray-500 mb-5">
              <div className="flex items-center gap-x-5 flex-wrap">
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 flex-shrink-0" />
                  <span>{vacancy.location_city}{vacancy.location_country ? `, ${vacancy.location_country}` : ''}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 flex-shrink-0" />
                  <span>{isImmediate ? 'Starts Immediately' : `Starts ${formatShortDate(vacancy.start_date)}`}</span>
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
                <span key={tag} className="inline-flex items-center px-4 py-1.5 rounded-full text-sm font-medium bg-gray-100 text-gray-700 border border-gray-200">
                  {tag}
                </span>
              ))}
            </div>

            {/* Description */}
            {vacancy.description && (
              <>
                <div className="border-t border-gray-100 my-5" />
                <div className="mb-5">
                  <h2 className="text-base font-semibold text-gray-900 mb-2">About This Opportunity</h2>
                  <p className="text-[15px] text-gray-600 leading-relaxed whitespace-pre-wrap">{vacancy.description}</p>
                </div>
              </>
            )}

            {/* Benefits */}
            {vacancy.benefits && vacancy.benefits.length > 0 && (
              <div className="mb-5">
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-3">Benefits Included</p>
                <div className="flex items-center flex-wrap gap-2.5">
                  {vacancy.benefits.map((benefit) => {
                    const config = BENEFIT_CONFIG[benefit.toLowerCase()]
                    if (!config) return null
                    const Icon = config.icon
                    return (
                      <span key={benefit} className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium bg-gray-50 text-gray-700 border border-gray-200">
                        <Icon className={`w-4 h-4 ${config.iconColor}`} />
                        {config.label}
                      </span>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Custom Benefits */}
            {vacancy.custom_benefits && vacancy.custom_benefits.length > 0 && (
              <div className="mb-5">
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-3">Additional Benefits</p>
                <ul className="space-y-1.5">
                  {vacancy.custom_benefits.map((benefit, i) => (
                    <li key={i} className="flex items-start gap-2 text-[15px] text-gray-600">
                      <span className="text-[#8026FA] mt-0.5">✓</span>
                      <span>{benefit}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* EU Passport Requirement */}
            {(vacancy as Record<string, unknown>).eu_passport_required === true && (
              <div className="mb-5">
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-3">Requirements</p>
                <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium bg-blue-50 text-blue-700 border border-blue-200">
                  <Flag className="w-4 h-4 text-blue-500" />
                  EU Passport Required
                </span>
              </div>
            )}

            {/* Requirements */}
            {vacancy.requirements && vacancy.requirements.length > 0 && (
              <div className="mb-5">
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-3">Requirements</p>
                <ul className="space-y-1.5">
                  {vacancy.requirements.map((req, i) => (
                    <li key={i} className="flex items-start gap-2 text-[15px] text-gray-600">
                      <span className="text-gray-400 mt-0.5">•</span>
                      <span>{req}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Deadline */}
            {vacancy.application_deadline && (
              <div className="mb-5">
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-2">Application Deadline</p>
                <div className="flex items-center gap-2 text-[15px] text-gray-600">
                  <Calendar className="w-4 h-4 text-red-500" />
                  <span className="font-medium">{formatDate(vacancy.application_deadline)}</span>
                  {deadlineText && <span className="text-gray-400">({deadlineText})</span>}
                </div>
              </div>
            )}

            {/* Contact */}
            {(vacancy.contact_email || vacancy.contact_phone) && (
              <div className="mb-5">
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-2">Contact</p>
                <div className="space-y-1.5">
                  {vacancy.contact_email && (
                    <div className="flex items-center gap-2 text-[15px]">
                      <Mail className="w-4 h-4 text-gray-400" />
                      <a href={`mailto:${vacancy.contact_email}`} className="text-gray-600 hover:text-[#8026FA] transition-colors">{vacancy.contact_email}</a>
                    </div>
                  )}
                  {vacancy.contact_phone && (
                    <div className="flex items-center gap-2 text-[15px]">
                      <Phone className="w-4 h-4 text-gray-400" />
                      <a href={`tel:${vacancy.contact_phone}`} className="text-gray-600 hover:text-[#8026FA] transition-colors">{vacancy.contact_phone}</a>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Divider before actions */}
            <div className="border-t border-gray-100 my-5" />

            {/* Action Buttons */}
            <div className="flex items-center gap-3">
              {hasApplied ? (
                <div className="flex-1 flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl font-semibold text-sm border border-[#8026FA]/15 bg-[#8026FA]/5 text-[#8026FA]">
                  <CheckCircle className="w-4 h-4" />
                  Application Submitted
                </div>
              ) : onApply ? (
                <Button onClick={onApply} className="flex-1 rounded-xl py-3.5 bg-gradient-to-r from-[#8026FA] to-[#924CEC] hover:opacity-90 text-base font-semibold">
                  Apply Now &rsaquo;
                </Button>
              ) : (
                <Button onClick={onClose} className="flex-1 rounded-xl py-3.5 bg-gradient-to-r from-[#8026FA] to-[#924CEC] hover:opacity-90 text-base font-semibold">
                  Close
                </Button>
              )}
              {!hideClubProfileButton && (
                <Button onClick={handleClubClick} variant="outline" className="rounded-xl py-3.5 px-5 flex-shrink-0">
                  {publisherRole === 'coach' ? 'View Profile' : 'View Club'}
                </Button>
              )}
            </div>

            {/* Timestamp */}
            <p className="mt-5 text-xs text-gray-400 text-center">
              Posted on {formatDate(vacancy.created_at)}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
