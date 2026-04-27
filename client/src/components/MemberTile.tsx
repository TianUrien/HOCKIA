import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapPin, Building2, Shield } from 'lucide-react'
import { RoleBadge, TierBadge, VerifiedBadge, DualNationalityDisplay } from '@/components'
import type { ProfileTier } from '@/lib/profileTier'
import SignInPromptModal from '@/components/SignInPromptModal'
import { useAuthStore } from '@/lib/auth'
import { useWorldClubLogo } from '@/hooks/useWorldClubLogo'
import { getImageUrl } from '@/lib/imageUrl'

const BRAND_CATEGORY_LABELS: Record<string, string> = {
  equipment: 'Equipment',
  apparel: 'Apparel',
  accessories: 'Accessories',
  nutrition: 'Nutrition',
  technology: 'Technology',
  coaching: 'Coaching & Training',
  recruiting: 'Recruiting',
  media: 'Media',
  services: 'Services',
  other: 'Other',
}

interface MemberTileProps {
  id: string
  avatar_url: string | null
  full_name: string
  role: 'player' | 'coach' | 'club' | 'brand' | 'umpire'
  brandSlug?: string | null
  brandCategory?: string | null
  brandLogoUrl?: string | null
  nationality: string | null
  nationality_country_id?: number | null
  nationality2_country_id?: number | null
  base_location: string | null
  current_team: string | null
  current_world_club_id?: string | null
  open_to_play?: boolean
  open_to_coach?: boolean
  tier?: ProfileTier
  isVerified?: boolean
  verifiedAt?: string | null
  umpireLevel?: string | null
  federation?: string | null
  /** When provided, overrides the default navigate-to-profile behavior.
   * Community passes this to open the preview modal instead — the preview
   * itself then handles the auth-gated CTAs. */
  onPreview?: () => void
}

export default function MemberTile(props: MemberTileProps) {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const [showSignInPrompt, setShowSignInPrompt] = useState(false)
  const clubLogo = useWorldClubLogo(props.current_world_club_id ?? null)

  const isBrand = props.role === 'brand'
  const heroSrc = isBrand ? (props.brandLogoUrl ?? props.avatar_url) : props.avatar_url
  const heroImageUrl = heroSrc ? getImageUrl(heroSrc, 'avatar-md') : null
  const showGreenDot =
    (props.role === 'player' && props.open_to_play) ||
    (props.role === 'coach' && props.open_to_coach)

  const initials = props.full_name
    ? props.full_name.trim().split(/\s+/).filter(Boolean).map(n => n[0]).join('').slice(0, 2).toUpperCase()
    : '?'

  const handleClick = () => {
    // Preview takes precedence — it handles auth-gating on its own CTAs,
    // so unauth users still see the preview.
    if (props.onPreview) {
      props.onPreview()
      return
    }
    if (!user) {
      setShowSignInPrompt(true)
      return
    }
    if (props.role === 'brand') {
      navigate(props.brandSlug ? `/brands/${props.brandSlug}?ref=community` : '/marketplace')
    } else if (props.role === 'club') {
      navigate(`/clubs/id/${props.id}?ref=community`)
    } else if (props.role === 'umpire') {
      navigate(`/umpires/id/${props.id}?ref=community`)
    } else {
      navigate(`/players/id/${props.id}?ref=community`)
    }
  }

  // Role-native line (below nationality). One line per tile, in role priority order.
  const roleNative = (() => {
    if (props.role === 'player' || props.role === 'coach') {
      if (props.current_team) return { kind: 'team' as const, label: props.current_team }
      if (props.base_location) return { kind: 'location' as const, label: props.base_location }
      return null
    }
    if (props.role === 'club') {
      return props.base_location ? { kind: 'location' as const, label: props.base_location } : null
    }
    if (props.role === 'brand') {
      if (!props.brandCategory) return null
      return {
        kind: 'category' as const,
        label: BRAND_CATEGORY_LABELS[props.brandCategory] ?? props.brandCategory,
      }
    }
    if (props.role === 'umpire') {
      if (props.federation) return { kind: 'federation' as const, label: props.federation }
      if (props.base_location) return { kind: 'location' as const, label: props.base_location }
      return null
    }
    return null
  })()

  // Modifier pill next to RoleBadge. Brands intentionally skip to avoid duplicating category.
  const modifierPill = (() => {
    if (props.role === 'brand') return null
    if (props.role === 'umpire') {
      return props.umpireLevel ? (
        <span className="inline-flex items-center rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
          {props.umpireLevel}
        </span>
      ) : null
    }
    return props.tier ? <TierBadge tier={props.tier} size="sm" /> : null
  })()

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className="group block w-full text-left bg-white border border-gray-200 rounded-xl overflow-hidden hover:shadow-md hover:border-gray-300 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8026FA] focus-visible:ring-offset-2"
        aria-label={`View ${props.full_name}'s profile`}
      >
        {/* Hero image */}
        <div className={`relative aspect-square ${isBrand ? 'bg-gradient-to-br from-gray-50 to-gray-100' : 'bg-gray-100'}`}>
          {heroImageUrl ? (
            <img
              src={heroImageUrl}
              alt=""
              className={`absolute inset-0 w-full h-full ${isBrand ? 'object-contain p-4' : 'object-cover'} group-hover:scale-[1.02] transition-transform duration-200`}
              loading="lazy"
              decoding="async"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-[#8026FA] to-[#924CEC] text-white font-semibold text-2xl sm:text-3xl select-none">
              {initials}
            </div>
          )}
          {showGreenDot && (
            <span
              className="absolute top-2 right-2 w-3 h-3 rounded-full bg-emerald-500 ring-2 ring-white"
              aria-label="Open to opportunities"
              title="Open to opportunities"
            />
          )}
        </div>

        {/* Info */}
        <div className="p-2.5 sm:p-3 space-y-1.5">
          <div className="flex items-center gap-1 min-w-0">
            <h3 className="text-sm font-semibold text-gray-900 truncate min-w-0 flex-1 leading-tight">
              {props.full_name}
            </h3>
            <VerifiedBadge verified={props.isVerified} verifiedAt={props.verifiedAt} size="sm" />
          </div>

          <div className="flex items-center gap-1 flex-wrap">
            <RoleBadge role={props.role} />
            {modifierPill}
          </div>

          {(props.nationality_country_id || props.nationality) && (
            <div className="text-xs text-gray-600 truncate">
              <DualNationalityDisplay
                primaryCountryId={props.nationality_country_id}
                secondaryCountryId={props.nationality2_country_id}
                fallbackText={props.nationality}
                mode="compact"
                className="text-gray-600"
              />
            </div>
          )}

          {roleNative && (
            <div className="flex items-center gap-1.5 text-xs text-gray-500 min-w-0">
              {roleNative.kind === 'team' && clubLogo ? (
                <img
                  src={clubLogo}
                  alt=""
                  className="w-3.5 h-3.5 rounded-sm object-cover flex-shrink-0"
                />
              ) : roleNative.kind === 'federation' ? (
                <Shield className="w-3 h-3 flex-shrink-0 text-gray-400" />
              ) : roleNative.kind === 'team' ? (
                <Building2 className="w-3 h-3 flex-shrink-0 text-gray-400" />
              ) : roleNative.kind === 'category' ? (
                <Building2 className="w-3 h-3 flex-shrink-0 text-gray-400" />
              ) : (
                <MapPin className="w-3 h-3 flex-shrink-0 text-gray-400" />
              )}
              <span className="truncate">{roleNative.label}</span>
            </div>
          )}
        </div>
      </button>

      <SignInPromptModal
        isOpen={showSignInPrompt}
        onClose={() => setShowSignInPrompt(false)}
        title="Sign in to view profile"
        message="Sign in or create a free HOCKIA account to view member profiles."
      />
    </>
  )
}
