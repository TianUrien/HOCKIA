import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MapPin, Building2, Shield } from 'lucide-react'
import { RoleBadge, TierBadge, VerifiedBadge, DualNationalityDisplay } from '@/components'
import type { ProfileTier } from '@/lib/profileTier'
import SignInPromptModal from '@/components/SignInPromptModal'
import { useAuthStore } from '@/lib/auth'
import { useWorldClubLogo, getPlayerLeagueName } from '@/hooks/useWorldClubLogo'
import HockeyContextLine from '@/components/recruiting/HockeyContextLine'
import QuickActionsRow from '@/components/recruiting/QuickActionsRow'
import { getImageUrl } from '@/lib/imageUrl'
import RolePlaceholder from './RolePlaceholder'
import ClubFitChip from './recruiting/ClubFitChip'
import ProvenSignal from './recruiting/ProvenSignal'
import InterestSignal from './recruiting/InterestSignal'
import { useCoachFit } from '@/hooks/useCoachFit'
import { useEvidence } from '@/hooks/useEvidence'
import { useInterest } from '@/hooks/useInterest'

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
  /** Optional — used by ClubFitChip for "open to opportunities" check
   *  on umpires + brands. Players/coaches use open_to_play/coach. */
  open_to_opportunities?: boolean
  /** Phase 3e player playing category — drives the gender_match
   *  component of the recruiter-only Club Fit chip. */
  playing_category?: string | null
  /** Phase 2C — coach specialization + coaching categories, drive the
   *  recruiter-only Coach Fit chip on coach candidates (specialization
   *  match vs the sought coaching role, category as a tiebreak). */
  coach_specialization?: string | null
  coaching_categories?: string[] | null
  /** P1.2 curated 1..10 level band — drives the competition_proximity
   *  component of the recruiter-only Club Fit chip. Null when the
   *  player has no current_world_club_id or the club's league hasn't
   *  been seeded with a band. */
  competition_level_band?: number | null
  /** P1.4 — player position (Forward / Midfield / Defender /
   *  Goalkeeper). Renders as the third segment of HockeyContextLine.
   *  Only meaningful for players. */
  position?: string | null
  /** Recency-30d signal for Fit availability + recency components. */
  last_active_at?: string | null
  /** Increment #1 (Proven lens) — evidence inputs for the recruiter-only
   *  confidence signal: highlight reel, full-match footage count, and
   *  accepted references. (Verified + linked club come from isVerified +
   *  current_world_club_id.) */
  highlight_video_url?: string | null
  full_game_video_count?: number | null
  accepted_reference_count?: number | null
  /** Increment #2.2 (Interested lens) — candidate intent for the 🤝 signal
   *  vs the active opportunity scope. */
  relocation_willingness?: string | null
  relocation_countries_open?: number[] | null
  relocation_countries_excluded?: number[] | null
  available_from?: string | null
  /** Home country (base_country_id ?? nationality_country_id). */
  home_country_id?: number | null
  tier?: ProfileTier
  isVerified?: boolean
  verifiedAt?: string | null
  umpireLevel?: string | null
  federation?: string | null
  /** Profile completeness percentage (0-100). Renders as a small badge
   *  on the avatar so users can see how complete each member's profile
   *  is at a glance. Optional — older callers without the column may
   *  omit, in which case nothing renders. */
  profileCompletenessPct?: number | null
  /** When provided, overrides the default navigate-to-profile behavior.
   * Community passes this to open the preview modal instead — the preview
   * itself then handles the auth-gated CTAs. */
  onPreview?: () => void
}

export default function MemberTile(props: MemberTileProps) {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const [showSignInPrompt, setShowSignInPrompt] = useState(false)
  // Quick actions (Save / Message / Shortlist menu / recruiter
  // placeholders) live as a footer strip beneath the clickable
  // identity area. QuickActionsRow self-gates on auth + non-self,
  // and hides recruiter-only items (Invite/Compare) for non-recruiter
  // viewers. Rendering it for every role is fine — Save + Message
  // work the same across player/coach/club/brand/umpire.
  const showQuickActions = Boolean(user) && user?.id !== props.id
  const clubLogo = useWorldClubLogo(props.current_world_club_id ?? null)
  // Phase 2C — Coach Fit for this candidate vs the active scope. Returns
  // NOT_APPLICABLE (chip renders null) for non-coaches or non-coach scopes.
  const coachFit = useCoachFit(
    props.role === 'coach'
      ? {
          id: props.id,
          role: props.role,
          coach_specialization: props.coach_specialization ?? null,
          coaching_categories: props.coaching_categories ?? null,
        }
      : null,
  )
  // Increment #1 — Proven lens. Recruiter-only evidence/confidence signal
  // (renders nothing for non-recruiter viewers or candidates with no
  // evidence on file).
  const evidence = useEvidence({
    role: props.role,
    highlight_video_url: props.highlight_video_url ?? null,
    full_game_video_count: props.full_game_video_count ?? null,
    accepted_reference_count: props.accepted_reference_count ?? null,
    is_verified: props.isVerified ?? null,
    current_world_club_id: props.current_world_club_id ?? null,
  })
  // Increment #2.2 — Interested lens vs the active opportunity scope.
  // NOT_APPLICABLE (renders null) for non-recruiters or with no scope.
  const interest = useInterest({
    role: props.role,
    relocation_willingness: props.relocation_willingness ?? null,
    relocation_countries_open: props.relocation_countries_open ?? null,
    relocation_countries_excluded: props.relocation_countries_excluded ?? null,
    available_from: props.available_from ?? null,
    home_country_id: props.home_country_id ?? null,
  })

  const isBrand = props.role === 'brand'
  const heroSrc = isBrand ? (props.brandLogoUrl ?? props.avatar_url) : props.avatar_url
  const heroImageUrl = heroSrc ? getImageUrl(heroSrc, 'avatar-md') : null
  const showGreenDot =
    (props.role === 'player' && props.open_to_play) ||
    (props.role === 'coach' && props.open_to_coach)

  // Initials block was the previous fallback when no avatar — now replaced
  // by RolePlaceholder. Computation removed; the role + name are surfaced
  // by the card header instead.

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
    } else if (props.role === 'coach') {
      // Coach has its own public route (PublicPlayerProfile is the
      // shared component, but the URL prefix matters for SEO + share).
      navigate(`/coaches/id/${props.id}?ref=community`)
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
      <div className="flex flex-col h-full bg-white border border-gray-200 rounded-2xl overflow-hidden hover:shadow-md hover:border-gray-300 transition-all">
      <button
        type="button"
        onClick={handleClick}
        className="group block w-full text-left flex-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8026FA] focus-visible:ring-offset-2"
        aria-label={(() => {
          const name = props.full_name?.trim() ?? ''
          const pct = props.profileCompletenessPct
          if (typeof pct === 'number' && pct > 0) {
            return `${name}, ${pct}% profile complete. Tap to open profile.`
          }
          return `${name}. Tap to open profile.`
        })()}
      >
        {/* Avatar — centered circle inside top padding. Replaces the
            previous full-width square hero. The role-tinted placeholder
            still appears for users without a photo; brands keep their
            logo-on-light-bg treatment. Green "open to opportunities"
            dot anchors to the avatar's bottom-right. */}
        <div className="pt-5 pb-4 px-4 flex items-center justify-center">
          <div className="relative w-24 h-24 sm:w-28 sm:h-28">
            <div className={`absolute inset-0 rounded-full overflow-hidden ${isBrand ? 'bg-gradient-to-br from-gray-50 to-gray-100' : 'bg-gray-100'}`}>
              {heroImageUrl ? (
                <img
                  src={heroImageUrl}
                  alt=""
                  className={`absolute inset-0 w-full h-full ${isBrand ? 'object-contain p-3' : 'object-cover'} group-hover:scale-[1.03] transition-transform duration-200`}
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <div className="absolute inset-0">
                  <RolePlaceholder role={props.role} label="" />
                </div>
              )}
            </div>
            {showGreenDot && (
              <span
                className="absolute top-1 right-1 w-3.5 h-3.5 rounded-full bg-emerald-500 ring-2 ring-white"
                aria-label="Open to opportunities"
                title="Open to opportunities"
              />
            )}
            {/* Profile completeness badge — sits at the bottom-right of
                the avatar matching the reference image. Only shown when
                a real numeric % is provided (not 0 from a default). */}
            {typeof props.profileCompletenessPct === 'number' && props.profileCompletenessPct > 0 && (
              <span
                className="absolute -bottom-0.5 right-0 inline-flex items-center rounded-full bg-[#8026FA] px-1.5 py-0.5 text-[10px] font-bold text-white ring-2 ring-white tabular-nums"
                aria-label={`Profile ${props.profileCompletenessPct}% complete`}
                title={`Profile ${props.profileCompletenessPct}% complete`}
              >
                {props.profileCompletenessPct}%
              </span>
            )}
          </div>
        </div>

        {/* Info — vertical stack, generous breathing room. Each row is
            its own concept: name → role/tier → nationality → club. */}
        <div className="px-4 pb-4 space-y-2.5">
          {/* Row 1: name + verified */}
          <div className="flex items-center gap-1 min-w-0">
            <h3
              className="text-base font-semibold text-gray-900 truncate min-w-0 flex-1 leading-tight"
              title={props.full_name?.trim()}
            >
              {props.full_name?.trim()}
            </h3>
            <VerifiedBadge verified={props.isVerified} verifiedAt={props.verifiedAt} size="sm" />
          </div>

          {/* Row 2: role pill + tier/level pill + Club Fit chip
              (recruiter-only; renders nothing when viewer isn't a club
              or candidate isn't player/coach). */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <RoleBadge role={props.role} />
            {modifierPill}
            <ClubFitChip
              candidate={{
                id: props.id,
                role: props.role,
                playing_category: props.playing_category ?? null,
                current_world_club_id: props.current_world_club_id ?? null,
                competition_level_band: props.competition_level_band ?? null,
                open_to_play: props.open_to_play ?? null,
                open_to_coach: props.open_to_coach ?? null,
                open_to_opportunities: props.open_to_opportunities ?? null,
                last_active_at: props.last_active_at ?? null,
              }}
            />
            {/* Phase 2C — Coach Fit chip. Renders only for coach
                candidates under a coach-seeking scope (returns null
                otherwise); the player chip above is null for coaches. */}
            <ClubFitChip kind="coach" fitResult={coachFit} />
          </div>

          {/* Proven lens (Increment #1) — recruiter-only evidence
              confidence: tier pill + glanceable facts. Renders nothing
              for non-recruiter viewers or candidates with no evidence. */}
          <ProvenSignal result={evidence} />

          {/* Interested lens (Increment #2.2) — recruiter + active-scope
              only; renders nothing otherwise. */}
          <InterestSignal result={interest} variant="compact" />

          {/* Row 3: nationality (tile mode — full names + flags, EU pill
              as a small chip; flex-wrap so dual-nat doesn't truncate). */}
          {(props.nationality_country_id || props.nationality) && (
            <div className="text-xs text-gray-600">
              <DualNationalityDisplay
                primaryCountryId={props.nationality_country_id}
                secondaryCountryId={props.nationality2_country_id}
                fallbackText={props.nationality}
                mode="tile"
                className="text-gray-600"
              />
            </div>
          )}

          {/* P1.4 Hockey context line — players only (club ·
              competition · position with per-segment "Not added yet"
              fallback). Competition name is pulled from the
              prefetchWorldClubLogos cache, which PeopleListView warms
              before rendering the grid. For non-player roles we keep
              the legacy single-row team/federation/category display
              because they don't have positions or leagues in the same
              sense. */}
          {props.role === 'player' ? (
            <div className="pt-2 border-t border-gray-100">
              <HockeyContextLine
                clubName={props.current_team}
                competitionName={getPlayerLeagueName(
                  props.current_world_club_id ?? null,
                  props.playing_category ?? null,
                )}
                position={props.position}
              />
            </div>
          ) : roleNative && (
            <div className="flex items-center gap-1.5 text-xs text-gray-500 min-w-0 pt-2 border-t border-gray-100">
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
              {/* flex-1 + min-w-0 so the truncate actually engages — without
                  flex-1 the span sizes to its full intrinsic width and pushes
                  the row wider than the parent (caught by qa-mid-width-overflow:
                  "Bayside Powerhouse Saints Hockey Club" overflowed by 65px). */}
              <span className="truncate flex-1 min-w-0">{roleNative.label}</span>
            </div>
          )}
        </div>
      </button>

      {/* Quick-actions footer — sibling of the main clickable button so
          we don't nest interactive elements. stopPropagation on the
          wrapper keeps tile-level handlers from firing when a recruiter
          taps inside the row. Hidden for anon viewers + own-profile. */}
      {showQuickActions && (
        <div
          className="px-3 py-2 border-t border-gray-100 bg-gray-50/40"
          onClick={(e) => e.stopPropagation()}
        >
          <QuickActionsRow
            playerId={props.id}
            playerName={props.full_name}
            compact
          />
        </div>
      )}
      </div>

      <SignInPromptModal
        isOpen={showSignInPrompt}
        onClose={() => setShowSignInPrompt(false)}
        title="Sign in to view profile"
        message="Sign in or create a free HOCKIA account to view member profiles."
      />
    </>
  )
}
