import { useNavigate } from 'react-router-dom'
import { ChevronRight, Shield, Check, AlertCircle, ArrowRight, Globe2 } from 'lucide-react'
import Avatar from '@/components/Avatar'
import RoleBadge from '@/components/RoleBadge'
import AvailabilityPill from '@/components/AvailabilityPill'
import type { DiscoverResult } from '@/hooks/useDiscover'
import { getSpecializationLabel } from '@/lib/coachSpecializations'

interface DiscoverResultCardProps {
  result: DiscoverResult
}

// Phase 4 MVP-A — fit-level visual treatment. Color choices match HOCKIA's
// existing palette: amber (already used for the references shield),
// emerald for positive accent, gray for muted/incomplete states. Fit
// labels avoid quality language — "Strong match" means strong-against-
// criteria, not "good player".
const FIT_LEVEL_PRESET: Record<NonNullable<DiscoverResult['fit_level']>, {
  label: string
  pillBg: string
  pillText: string
}> = {
  strong_match: {
    label: 'Strong match',
    pillBg: 'bg-emerald-50',
    pillText: 'text-emerald-700',
  },
  possible_match: {
    // Phase 4 audit P1-3 — was amber, but the references shield is also
    // amber-50/amber-700; side-by-side they read as the same pill. Sky-blue
    // sits in the middle of emerald (positive) and gray (muted) without
    // colliding with the amber-coded references signal.
    label: 'Possible match',
    pillBg: 'bg-sky-50',
    pillText: 'text-sky-700',
  },
  needs_more_info: {
    label: 'Needs more info',
    pillBg: 'bg-gray-100',
    pillText: 'text-gray-600',
  },
}

export default function DiscoverResultCard({ result }: DiscoverResultCardProps) {
  const navigate = useNavigate()

  // Phase 4 MVP-B — World directory rows have a different shape and a
  // different navigation target than profile rows. result_type defaults
  // to 'profile' when absent (back-compat with the legacy envelope).
  const isWorldClub = result.result_type === 'world_club'

  const handleClick = () => {
    if (isWorldClub) {
      // Claimed world_clubs link to a HOCKIA club profile (you can message
      // them); unclaimed ones go to the country directory page where the
      // user can browse the full club roster for that region.
      if (result.claimed && result.claimed_profile_id) {
        navigate(`/clubs/id/${result.claimed_profile_id}?ref=discover`)
      } else if (result.country_code) {
        navigate(`/world/${result.country_code.toLowerCase()}?ref=discover`)
      } else {
        navigate('/world?ref=discover')
      }
      return
    }
    if (result.role === 'brand') {
      navigate('/marketplace')
    } else if (result.role === 'club') {
      navigate(`/clubs/id/${result.id}?ref=discover`)
    } else if (result.role === 'umpire') {
      navigate(`/umpires/id/${result.id}?ref=discover`)
    } else if (result.role === 'coach') {
      // Coach has its own URL prefix even though the page component
      // (PublicPlayerProfile) is shared with players.
      navigate(`/coaches/id/${result.id}?ref=discover`)
    } else {
      navigate(`/players/id/${result.id}?ref=discover`)
    }
  }

  const specializationLabel = !isWorldClub && result.role === 'coach' && result.coach_specialization
    ? getSpecializationLabel(result.coach_specialization, result.coach_specialization_custom)
    : null

  // World-club subtitle: league + country (or just country). Profile
  // subtitle: position/specialization + location.
  const subtitle = isWorldClub
    ? [result.league_name, result.province_name, result.base_country_name].filter(Boolean).join(' · ')
    : [
        specializationLabel || result.position,
        result.base_location || result.base_country_name,
      ].filter(Boolean).join(' · ')

  const availabilityPill = !isWorldClub && result.open_to_play
    ? <AvailabilityPill variant="play" size="sm" />
    : !isWorldClub && result.open_to_coach
      ? <AvailabilityPill variant="coach" size="sm" />
      : null

  // Phase 4 MVP-A — show the fit panel only when the backend ran the
  // compose_shortlist 2nd pass and produced a per-row score. When absent
  // (cold result, compose failure, or older clients), the card renders
  // exactly as today — backwards-compat by design.
  const fitPreset = result.fit_level ? FIT_LEVEL_PRESET[result.fit_level] : null
  const hasFitReasons = (result.fit_reasons?.length ?? 0) > 0
  const hasMissing = (result.missing_data?.length ?? 0) > 0
  const hasNextAction = !!result.next_action?.trim()
  const showFitPanel = !!fitPreset && (hasFitReasons || hasMissing || hasNextAction)

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`flex w-full rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors text-left ${
        showFitPanel ? 'flex-col gap-2 px-3 py-2.5' : 'items-center gap-3 px-3 py-2.5'
      }`}
    >
      <div className="flex items-center gap-3 w-full min-w-0">
        <Avatar
          src={result.avatar_url}
          alt={result.full_name ?? undefined}
          initials={result.full_name?.charAt(0)}
          size="md"
          role={result.role}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-gray-900 truncate">
              {result.full_name ?? 'Unknown'}
            </span>
            <RoleBadge role={result.role} className="flex-shrink-0" />
            {!isWorldClub && result.accepted_reference_count > 0 && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[10px] font-medium flex-shrink-0">
                <Shield className="w-2.5 h-2.5" />
                {result.accepted_reference_count}
              </span>
            )}
            {isWorldClub && (() => {
              // Phase 4 audit P2-3: the pill must reflect the actual click
              // destination. A claimed world_club without a claimed_profile_id
              // is a data edge — the click handler falls back to the country
              // directory, so the pill must say "Directory" too. Tying the
              // pill state to (claimed && claimed_profile_id) prevents the
              // pill copy from ever lying about where the user lands.
              const isMessageable = result.claimed && !!result.claimed_profile_id
              return (
                <span
                  className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium flex-shrink-0 ${
                    isMessageable
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-blue-50 text-blue-700'
                  }`}
                  title={isMessageable
                    ? 'Active on HOCKIA — you can message them inside the platform'
                    : 'In the global directory — not yet active on HOCKIA, reach out externally'}
                >
                  <Globe2 className="w-2.5 h-2.5" aria-hidden="true" />
                  {isMessageable ? 'Claimed' : 'Directory'}
                </span>
              )
            })()}
            {fitPreset && (
              <span
                className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium flex-shrink-0 ml-auto ${fitPreset.pillBg} ${fitPreset.pillText}`}
              >
                {fitPreset.label}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            {subtitle && (
              <p className="text-xs text-gray-500 truncate">{subtitle}</p>
            )}
            {availabilityPill && (
              <span className="flex-shrink-0">{availabilityPill}</span>
            )}
          </div>
        </div>
        {!showFitPanel && (
          <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
        )}
      </div>

      {showFitPanel && (
        <div className="w-full pl-[52px] -mt-1 space-y-1">
          {hasFitReasons && (
            <ul className="space-y-0.5">
              {result.fit_reasons!.map((reason, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[11px] text-gray-700 leading-[1.4]">
                  <Check className="w-3 h-3 mt-0.5 text-emerald-600 flex-shrink-0" aria-hidden="true" />
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
          )}
          {hasMissing && (
            <ul className="space-y-0.5">
              {result.missing_data!.map((item, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[11px] text-amber-700 leading-[1.4]">
                  <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          )}
          {hasNextAction && (
            <div className="flex items-start gap-1.5 text-[11px] text-gray-600 italic leading-[1.4] pt-1">
              <ArrowRight className="w-3 h-3 mt-0.5 flex-shrink-0" aria-hidden="true" />
              <span>{result.next_action}</span>
            </div>
          )}
        </div>
      )}
    </button>
  )
}
