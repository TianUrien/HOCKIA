import { useEffect, useState } from 'react'
import { X, MapPin, Calendar, Clock, Home, Car, Globe as GlobeIcon, Plane, Utensils, Briefcase, Shield, GraduationCap, Mail, Phone, CheckCircle, AlertTriangle, DollarSign, Dumbbell, Award, Share2, Flag, Users, Info } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { Vacancy } from '../lib/supabase'
import { Avatar, StorageImage } from './index'
import Button from './Button'
import type { WorldClubInfo } from './OpportunityCard'
import { opportunityGenderToTeamLabel } from '@/lib/hockeyCategories'
import { levelSoughtLabel, compensationLabel, recruitmentProblemLabel } from '@/lib/opportunityIntent'
import { specialistSkillLabels } from '@/lib/specialistSkills'
import { getShareOrigin } from '@/lib/profileShare'
import { useAuthStore } from '@/lib/auth'
import { useCountries } from '@/hooks/useCountries'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'
import { checkOpportunityEligibility, opportunityMustHaveWarnings } from '@/lib/opportunityEligibility'

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
  const { user, profile } = useAuthStore()
  const { countries } = useCountries()
  const [isVisible, setIsVisible] = useState(false)

  // Application eligibility — EU passport + gender/team category. Checked
  // here so an ineligible user still reads the full opportunity but can't
  // submit; the server trigger is the hard backstop. Missing profile data
  // never blocks — it surfaces a "complete your profile" nudge instead.
  const eligibility = checkOpportunityEligibility(vacancy, profile, countries)
  // Phase 3f — must-have advisory. The candidate can still apply (warn-only),
  // but we flag the must-have criteria they explicitly miss so they know the
  // recruiter would read them "Out of scope". Blank fields never warn.
  const mustHaveWarnings = opportunityMustHaveWarnings(
    vacancy,
    profile,
    (id: number) => countries.find((c) => c.id === id)?.name,
  )
  // Publisher viewing their own listing — used to swap the dead-end
  // "Close" CTA for a "View applicants" deep link. QA-flagged the
  // detail sheet's only action being a literal Close button when the
  // publisher opened their own opportunity.
  const isPublisher = Boolean(user && user.id === vacancy.club_id)

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
    if (publisherRole === 'coach') navigate(`/coaches/id/${clubId}`)
    else navigate(`/clubs/id/${clubId}`)
  }

  const handleWorldClubClick = () => {
    if (worldClub) { onClose(); navigate(`/world/clubs/${worldClub.id}`) }
  }

  const handleShareClick = () => {
    // getShareOrigin pins https://inhockia.com on native so the shared
    // opportunity link is not capacitor://localhost/opportunities/<id>.
    const url = `${getShareOrigin()}/opportunities/${vacancy.id}`
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
  // Gender + position are player-only concepts; suppress them on coach
  // opportunities even if legacy rows happen to carry stale values.
  const tags: string[] = []
  const isPlayerOpportunity = vacancy.opportunity_type === 'player'
  if (isPlayerOpportunity) tags.push('Player')
  if (vacancy.opportunity_type === 'coach') tags.push('Coach')
  if (isPlayerOpportunity && vacancy.gender) {
    const teamLabel = opportunityGenderToTeamLabel(vacancy.gender)
    if (teamLabel) tags.push(teamLabel.replace(' Team', ''))
  }
  if (isPlayerOpportunity && vacancy.position) {
    tags.push(vacancy.position.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))
  }
  // Matching Increment #3/#4 — surface recruiter intent on the opportunity.
  if (isPlayerOpportunity) {
    const level = levelSoughtLabel(vacancy.level_sought)
    if (level) tags.push(level)
    const comp = compensationLabel(vacancy.compensation)
    if (comp) tags.push(comp)
    for (const skill of specialistSkillLabels(vacancy.specialist_skills_wanted)) tags.push(skill)
  }
  const recruitmentProblem = isPlayerOpportunity ? recruitmentProblemLabel(vacancy.recruitment_problem) : null

  // Deadline
  let deadlineText: string | null = null
  if (vacancy.application_deadline) {
    const daysLeft = Math.ceil((new Date(vacancy.application_deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    if (daysLeft >= 0) {
      if (daysLeft === 0) deadlineText = 'Closes today'
      else if (daysLeft === 1) deadlineText = 'Closes tomorrow'
      else deadlineText = `${daysLeft} days left`
    } else {
      // A lapsed deadline is informational only — the opportunity stays open
      // (and applyable) until the creator closes it by status.
      deadlineText = 'Deadline passed'
    }
  }

  useBodyScrollLock(true)

  useEffect(() => {
    requestAnimationFrame(() => setIsVisible(true))
  }, [])

  // Escape closes the view — standard dialog affordance, and the only
  // keyboard exit. Kept in its own effect so it always sees the current
  // onClose without re-running the body-overflow lock.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={vacancy.title ? `${vacancy.title} — opportunity details` : 'Opportunity details'}
      className={`fixed inset-0 z-50 overflow-y-auto transition-opacity duration-200 ease-out ${isVisible ? 'bg-black/50' : 'bg-black/0'}`}
    >
      {/* The padded wrapper is what visually fills the dimmed area, so the
          click-to-close test lives here — a click on the outer element
          never lands because this layer covers it. */}
      <div
        className="min-h-screen px-4 py-8 flex items-start sm:items-center justify-center"
        onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      >
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
                    <StorageImage src={displayClubLogo} alt={displayClubName} imageSize="avatar-md" className="w-20 h-20 rounded-xl object-cover shadow-sm" />
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
                          <StorageImage src={worldClub.avatarUrl} alt={worldClub.clubName} imageSize="card-thumb" className="w-4 h-4 rounded-full object-cover" />
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
                {cardType !== 'club' ? (
                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-[#F0FDFA] text-[#0D9488] border border-teal-100">
                    COACH LISTED
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-600 border border-gray-200">
                    CLUB LISTED
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

            {/* Recruitment problem (Matching Increment #4) — what they're solving. */}
            {recruitmentProblem && (
              <p className="-mt-2 mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-[#5b16b8]">
                <Flag className="w-4 h-4" /> Solving: {recruitmentProblem}
              </p>
            )}

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
            {vacancy.eu_passport_required === true && (
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

            {/* Action Buttons.
                isPublisher is checked FIRST and unconditionally — a
                publisher must never see Apply on their own listing,
                regardless of whether the calling surface passed an
                onApply handler. OpportunitiesTab (Manage Opportunities)
                passes onApply unconditionally, so without this ordering
                the publisher saw "Apply Now" on their own opportunity
                and the View-applicants branch was dead code. */}
            <div className="flex items-center gap-3">
              {isPublisher ? (
                // QA-flagged: when a publisher opens their own
                // opportunity from the detail sheet, the only CTA was
                // a literal "Close" button — there was no path to
                // applicants without backing out to the list and
                // hunting for the small applicants pill. Now we route
                // straight to the applicants page.
                <Button
                  onClick={() => {
                    onClose()
                    navigate(`/dashboard/opportunities/${vacancy.id}/applicants`)
                  }}
                  className="flex-1 rounded-xl py-3.5 bg-gradient-to-r from-[#8026FA] to-[#924CEC] hover:opacity-90 text-base font-semibold inline-flex items-center justify-center gap-2"
                >
                  <Users className="w-4 h-4" />
                  View applicants
                </Button>
              ) : hasApplied ? (
                <div className="flex-1 flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl font-semibold text-sm border border-[#8026FA]/15 bg-[#8026FA]/5 text-[#8026FA]">
                  <CheckCircle className="w-4 h-4" />
                  Application Submitted
                </div>
              ) : onApply && !eligibility.eligible ? (
                // Ineligible — the opportunity stays fully readable, but
                // Apply is replaced by a short, non-judgmental reason.
                <div className="flex-1 flex items-start gap-2.5 px-4 py-3 rounded-xl border border-amber-200 bg-amber-50">
                  <Info className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-semibold text-amber-900">You can&rsquo;t apply to this opportunity</p>
                    <p className="text-amber-800 mt-0.5">{eligibility.reason}</p>
                  </div>
                </div>
              ) : onApply ? (
                <Button onClick={onApply} className="flex-1 rounded-xl py-3.5 bg-gradient-to-r from-[#8026FA] to-[#924CEC] hover:opacity-90 text-base font-semibold">
                  Apply Now &rsaquo;
                </Button>
              ) : (
                // No Apply path for this viewer (role doesn't match, or an
                // umpire/club browsing). Say so plainly instead of showing
                // a dead-end "Close" button — the opportunity stays fully
                // readable; this just explains the missing CTA.
                <div className="flex-1 flex items-start gap-2.5 px-4 py-3 rounded-xl border border-gray-200 bg-gray-50">
                  <Info className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-gray-600">
                    {vacancy.opportunity_type === 'coach'
                      ? 'Only coaches can apply to this opportunity.'
                      : 'Only players can apply to this opportunity.'}
                  </p>
                </div>
              )}
              {!hideClubProfileButton && !isPublisher && (
                <Button onClick={handleClubClick} variant="outline" className="rounded-xl py-3.5 px-5 flex-shrink-0">
                  {publisherRole === 'coach' ? 'View Profile' : 'View Club'}
                </Button>
              )}
              {isPublisher && (
                // "Done" — dismisses the detail view. NOT "Close": on a
                // publisher's own opportunity that reads as closing the
                // listing, which is a separate action (dashboard → Manage
                // Opportunities → Close).
                <Button onClick={onClose} variant="outline" className="rounded-xl py-3.5 px-5 flex-shrink-0">
                  Done
                </Button>
              )}
            </div>

            {/* Eligibility nudge — shown when the user CAN apply but their
                profile is missing data we'd use to confirm a fit. Never
                blocks; just points them at the gap. */}
            {onApply && !hasApplied && !isPublisher && eligibility.eligible && eligibility.incompleteProfile && (
              <div className="mt-3 flex items-start gap-2.5 px-4 py-3 rounded-xl border border-blue-100 bg-blue-50">
                <Info className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-blue-900">
                  <span>{eligibility.incompleteProfile} </span>
                  <button
                    type="button"
                    onClick={() => { onClose(); navigate('/dashboard/profile') }}
                    className="font-semibold underline underline-offset-2 hover:text-blue-700"
                  >
                    Complete profile
                  </button>
                </div>
              </div>
            )}

            {/* Must-have advisory (Phase 3f) — the candidate explicitly misses
                one or more of this opening's must-have criteria. Warn-only:
                Apply stays enabled, but they know the recruiter would read
                them "Out of scope". */}
            {onApply && !hasApplied && !isPublisher && eligibility.eligible && mustHaveWarnings.length > 0 && (
              <div className="mt-3 flex items-start gap-2.5 px-4 py-3 rounded-xl border border-amber-200 bg-amber-50">
                <Info className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-amber-900">
                  <p className="font-semibold">You can still apply, but heads up:</p>
                  <ul className="mt-1 list-disc pl-4 space-y-0.5 text-amber-800">
                    {mustHaveWarnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

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
