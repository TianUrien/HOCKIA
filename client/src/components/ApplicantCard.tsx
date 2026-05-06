import { useState, useRef, useEffect } from 'react'
import { MapPin, Star, HelpCircle, XCircle, ChevronDown, Minus, ShieldCheck } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import Avatar from './Avatar'
import type { OpportunityApplicationWithApplicant } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'
import { getInitials } from '@/lib/utils'

type ApplicationStatus = Database['public']['Enums']['application_status']

type ShortlistTier = 'shortlisted' | 'maybe' | 'rejected'

const TIER_OPTIONS: { tier: ShortlistTier; label: string; icon: typeof Star; pillClass: string; menuActiveClass: string }[] = [
  {
    tier: 'shortlisted',
    label: 'Good fit',
    icon: Star,
    pillClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    menuActiveClass: 'bg-emerald-50',
  },
  {
    tier: 'maybe',
    label: 'Maybe',
    icon: HelpCircle,
    pillClass: 'bg-amber-50 text-amber-700 border-amber-200',
    menuActiveClass: 'bg-amber-50',
  },
  {
    tier: 'rejected',
    label: 'Not a fit',
    icon: XCircle,
    pillClass: 'bg-red-50 text-red-600 border-red-200',
    menuActiveClass: 'bg-red-50',
  },
]

function getCurrentTier(status: ApplicationStatus) {
  return TIER_OPTIONS.find((opt) => opt.tier === status) ?? null
}

export interface ApplicantReferenceInfo {
  count: number
  topEndorsement: {
    text: string
    endorserName: string
    endorserRole: string | null
    relationshipType: string
  } | null
}

interface ApplicantCardProps {
  application: OpportunityApplicationWithApplicant
  onStatusChange?: (applicationId: string, status: ApplicationStatus) => void
  isUpdating?: boolean
  referenceInfo?: ApplicantReferenceInfo | null
}

export default function ApplicantCard({ application, onStatusChange, isUpdating, referenceInfo }: ApplicantCardProps) {
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const { applicant } = application
  const displayName = applicant.full_name?.trim() || applicant.username?.trim() || 'Applicant'
  const positions = [applicant.position, applicant.secondary_position].filter((value, index, self): value is string => {
    if (!value) return false
    return self.findIndex((item) => item === value) === index
  })

  const currentTier = getCurrentTier(application.status)

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }


  const handleViewProfile = () => {
    if (applicant.username) {
      navigate(`/players/${applicant.username}?ref=applicants`)
    } else {
      navigate(`/players/id/${applicant.id}?ref=applicants`)
    }
  }

  const handleSelect = (tier: ShortlistTier | 'pending') => {
    if (!onStatusChange || isUpdating) return
    onStatusChange(application.id, tier)
    setMenuOpen(false)
  }

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [menuOpen])

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
        {/* Applicant Photo */}
        <button
          onClick={handleViewProfile}
          className="group flex-shrink-0 cursor-pointer"
        >
          {/* Replaces the inline purple-gradient + initials block. The
              Avatar component handles src + role-tinted placeholder
              fallback (player blue / coach green / umpire gold) when no
              avatar uploaded. Ring + group-hover treatment preserved via
              className so the visual affordance is unchanged. */}
          <Avatar
            src={applicant.avatar_url}
            alt={displayName}
            initials={getInitials(displayName)}
            role={applicant.role}
            className="h-14 w-14 ring-2 ring-gray-200 transition-all group-hover:ring-[#8026FA] sm:h-16 sm:w-16"
          />
        </button>

        {/* Applicant Info */}
        <div className="min-w-0 flex-1">
          <button
            onClick={handleViewProfile}
            className="text-left group"
          >
            <h3 className="text-base font-semibold text-gray-900 transition-colors group-hover:text-[#8026FA] sm:text-lg">
              {displayName}
            </h3>
          </button>

          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-600 sm:text-sm">
            {positions.length > 0 ? <span className="font-medium">{positions.join(' • ')}</span> : null}
            {positions.length > 0 && applicant.base_location ? <span>•</span> : null}
            {applicant.base_location ? (
              <div className="flex items-center gap-1">
                <MapPin className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                <span>{applicant.base_location}</span>
              </div>
            ) : null}
          </div>

          <div className="mt-2 text-xs text-gray-500 sm:text-sm">
            Applied {formatDate(application.applied_at)}
          </div>

          {referenceInfo && referenceInfo.count > 0 && (
            <div className="mt-2 space-y-0.5">
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 flex-shrink-0 text-emerald-500" />
                <span className="text-xs font-medium text-emerald-700">
                  {referenceInfo.count} {referenceInfo.count === 1 ? 'reference' : 'references'}
                </span>
              </div>
              {referenceInfo.topEndorsement && (
                <p className="text-xs italic text-gray-500 line-clamp-1 pl-5">
                  &ldquo;{referenceInfo.topEndorsement.text}&rdquo;
                  <span className="not-italic text-gray-400">
                    {' '}&mdash; {referenceInfo.topEndorsement.endorserName}
                  </span>
                </p>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 sm:flex-col sm:items-end sm:gap-2">
          {/* Status Pill Dropdown */}
          {onStatusChange && (
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((prev) => !prev)}
                disabled={isUpdating}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all disabled:opacity-50 sm:text-sm ${
                  currentTier
                    ? currentTier.pillClass
                    : 'border-gray-200 bg-gray-50 text-gray-500 hover:bg-gray-100'
                }`}
              >
                {currentTier ? (
                  <>
                    <currentTier.icon className="h-3.5 w-3.5" />
                    {currentTier.label}
                  </>
                ) : (
                  <>
                    <Minus className="h-3.5 w-3.5" />
                    Unsorted
                  </>
                )}
                <ChevronDown className={`h-3 w-3 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
              </button>

              {menuOpen && (
                <div className="absolute left-0 z-20 mt-1 w-40 max-w-[calc(100vw-2rem)] rounded-lg border border-gray-200 bg-white py-1 shadow-lg sm:left-auto sm:right-0">
                  {TIER_OPTIONS.map((opt) => {
                    const Icon = opt.icon
                    const isActive = application.status === opt.tier
                    return (
                      <button
                        type="button"
                        key={opt.tier}
                        onClick={() => handleSelect(opt.tier)}
                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-gray-50 ${
                          isActive ? opt.menuActiveClass + ' font-medium' : 'text-gray-700'
                        }`}
                      >
                        <Icon className="h-4 w-4 flex-shrink-0" />
                        {opt.label}
                      </button>
                    )
                  })}
                  {currentTier && (
                    <>
                      <div className="my-1 border-t border-gray-100" />
                      <button
                        type="button"
                        onClick={() => handleSelect('pending')}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-400 transition-colors hover:bg-gray-50"
                      >
                        <Minus className="h-4 w-4 flex-shrink-0" />
                        Clear
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* View Profile Button */}
          <button
            type="button"
            onClick={handleViewProfile}
            className="inline-flex items-center justify-center rounded-lg border border-[#8026FA]/20 px-4 py-2 text-sm font-medium text-[#8026FA] transition-colors hover:bg-[#8026FA]/5 sm:px-5 sm:py-2"
          >
            View Profile
          </button>
        </div>
      </div>
    </div>
  )
}
