/**
 * MemberPreviewModal
 *
 * Intermediate "preview" layer between the Community grid tile and the full
 * profile/dashboard. Shows more than the tile, less than the dashboard, and
 * gates explicit actions (View Profile, Message) behind the usual auth flow.
 *
 * Analytics: fires a distinct `profile_preview` event — NOT `profile_view` —
 * so previews do not appear in the owner's "Who Viewed Your Profile" list,
 * do not inflate profile-view stats, and do not trigger the daily viewer
 * notification cron. The full `profile_view` event fires only when the user
 * explicitly presses View Profile (the dashboard page handles that as usual,
 * via ?ref=community_preview).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  X,
  User,
  MapPin,
  Building2,
  Shield,
  Flag,
  Calendar,
  Globe,
  Instagram,
  ExternalLink,
  Languages as LanguagesIcon,
  Activity,
  Check,
  ShieldCheck,
} from 'lucide-react'
import { RoleBadge, TierBadge, VerifiedBadge, DualNationalityDisplay } from '@/components'
import { ConditionalAvailabilityPill } from '@/components/AvailabilityPill'
import { availabilityLabel } from '@/lib/availabilityLabel'
import ClubFitChip from '@/components/recruiting/ClubFitChip'
import RolePlaceholder from '@/components/RolePlaceholder'
import SignInPromptModal from '@/components/SignInPromptModal'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'
import { useIsProfileSaved } from '@/hooks/useSavedProfiles'
import QuickActionsRow from '@/components/recruiting/QuickActionsRow'
import { useWorldClubLogo, getClubLevelBand } from '@/hooks/useWorldClubLogo'
import { categoryToBandTarget } from '@/hooks/useInterest'
import { computeEvidence, evidenceLevelLabel, evidenceChecklist } from '@/lib/evidence'
import { getImageUrl } from '@/lib/imageUrl'
import { logger } from '@/lib/logger'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { trackEvent } from '@/lib/analytics'
import { getMemberTier, calculateTier } from '@/lib/profileTier'
import { getSpecializationLabel } from '@/lib/coachSpecializations'
import { getUmpireActivity } from '@/lib/umpireActivity'
import { resolveConversationRoute } from '@/lib/startConversation'
import type { Profile } from './PeopleListView'

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

interface MemberPreviewModalProps {
  member: Profile | null
  onClose: () => void
}

export function MemberPreviewModal({ member, onClose }: MemberPreviewModalProps) {
  const { user, profile } = useAuthStore()
  const isRecruiterViewer = profile?.role === 'club' || profile?.role === 'coach'
  const navigate = useNavigate()
  const location = useLocation()
  const { addToast } = useToastStore()
  // Save action — sits next to the close X. Hidden on own preview +
  // for anon viewers; the hook's toggle shows a sign-in toast for anon.
  const savedState = useIsProfileSaved(member?.id ?? null)
  const showSaveButton = savedState.isAuthenticated && !savedState.isOwnProfile
  const [showSignInPrompt, setShowSignInPrompt] = useState(false)
  const [signInAction, setSignInAction] = useState<'message' | 'view'>('view')
  const [sendingMessage, setSendingMessage] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const isBrand = member?.role === 'brand'
  const clubLogo = useWorldClubLogo(member?.current_world_club_id ?? null)

  // Keeps the in-flight Message request bound to the member it started for.
  // If the user closes the preview or switches to another member while the
  // conversations query is still resolving, we bail instead of navigating.
  const activeMemberIdRef = useRef<string | null>(null)
  useEffect(() => {
    activeMemberIdRef.current = member?.id ?? null
  }, [member])

  // Reset message-sending state when the modal switches to a new member or
  // closes. Prevents a pending request from one member leaving the button in
  // "Sending…" state for another.
  useEffect(() => {
    setSendingMessage(false)
  }, [member?.id])

  // Drag-to-dismiss for the mobile bottom-sheet layout. Touch events don't
  // fire from a desktop mouse, so this is naturally mobile-only — and the
  // window-width gate in handleDragStart guards the edge case of touch-input
  // tablets in landscape (where the modal is centered, not anchored).
  const [translateY, setTranslateY] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const dragStartYRef = useRef(0)

  // Animated exit — defer the parent's onClose until the slide-out plays so
  // the sheet animates OUT instead of vanishing. Drag-dismiss keeps calling
  // onClose directly; the drag gesture is the exit.
  const [closing, setClosing] = useState(false)
  const closeTimerRef = useRef<number | null>(null)
  const requestClose = useCallback(() => {
    if (closing) return
    setClosing(true)
    const reduce =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    closeTimerRef.current = window.setTimeout(() => onClose(), reduce ? 0 : 200)
  }, [closing, onClose])
  useEffect(() => () => { if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current) }, [])

  // Reset drag + closing state whenever the modal opens for a new member or
  // closes. Resetting on close is a no-op (component returns null) but keeps
  // the effect simple and lint-clean.
  useEffect(() => {
    setTranslateY(0)
    setIsDragging(false)
    setClosing(false)
  }, [member?.id])

  const handleDragStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (typeof window !== 'undefined' && window.innerWidth >= 768) return
    dragStartYRef.current = e.touches[0].clientY
    setIsDragging(true)
  }

  const handleDragMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!isDragging) return
    const delta = e.touches[0].clientY - dragStartYRef.current
    setTranslateY(Math.max(0, delta))
  }

  const handleDragEnd = () => {
    if (!isDragging) return
    setIsDragging(false)
    if (translateY > 100) {
      onClose()
    } else {
      setTranslateY(0)
    }
  }

  // Trap focus inside the dialog when open. Matches Modal.tsx convention.
  // Deactivate while SignInPromptModal is showing so its own trap can own
  // keyboard focus — otherwise two active traps fight for focus and the
  // sign-in modal becomes unreachable via keyboard.
  useFocusTrap({
    containerRef: contentRef,
    isActive: member !== null && !showSignInPrompt,
  })

  // Stable callback so SignInPromptModal's Modal doesn't re-run its effect on
  // every render (which previously fought our scroll lock).
  const handleSignInPromptClose = useCallback(() => {
    setShowSignInPrompt(false)
  }, [])

  // Analytics: fire on open (profile_preview → DB, community_preview_open → GA4).
  // Uses the distinct `profile_preview` event name so none of the eight
  // `event_name = 'profile_view'` consumers pick it up.
  useEffect(() => {
    if (!member) return
    trackDbEvent('profile_preview', 'profile', member.id, {
      viewed_role: member.role,
      source: 'community',
    })
    trackEvent({
      action: 'community_preview_open',
      category: 'community',
      label: member.role,
    })
  }, [member])

  // Body scroll lock. Uses the position:fixed + scrollY-preservation
  // pattern (vs naive overflow:hidden) because on iOS WKWebView the
  // simple overflow toggle drops scrollY back to 0 on close, dumping
  // the user at the top of the Community list every time they peek
  // at a preview.
  useBodyScrollLock(member !== null)

  // Escape to close
  useEffect(() => {
    if (!member) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('keydown', handleKey)
    }
  }, [member, requestClose])

  if (!member) return null

  const profileRoute = (() => {
    if (member.role === 'brand') {
      return member.brand_slug
        ? `/brands/${member.brand_slug}?ref=community_preview`
        : '/marketplace'
    }
    if (member.role === 'club') return `/clubs/id/${member.id}?ref=community_preview`
    if (member.role === 'umpire') return `/umpires/id/${member.id}?ref=community_preview`
    if (member.role === 'coach') return `/coaches/id/${member.id}?ref=community_preview`
    return `/players/id/${member.id}?ref=community_preview`
  })()

  const handleViewProfile = () => {
    if (!user) {
      setSignInAction('view')
      setShowSignInPrompt(true)
      return
    }
    trackEvent({
      action: 'community_preview_view_profile',
      category: 'community',
      label: member.role,
    })
    onClose()
    navigate(profileRoute)
  }

  const handleMessage = async () => {
    if (!user) {
      setSignInAction('message')
      setShowSignInPrompt(true)
      return
    }
    if (user.id === member.id) {
      addToast('You cannot message yourself.', 'error')
      return
    }
    const targetId = member.id
    const targetRole = member.role
    setSendingMessage(true)
    try {
      const route = await resolveConversationRoute(user.id, targetId)
      // Bail if the user closed the preview (or switched members) while the
      // conversations query was in flight — don't navigate them away.
      if (activeMemberIdRef.current !== targetId) return
      trackEvent({
        action: 'community_preview_message',
        category: 'community',
        label: targetRole,
      })
      onClose()
      // returnTo: the page that opened the preview modal (typically
      // /community). Conversation back button reads this so closing
      // the chat returns the user to where they were browsing.
      const returnTo = location.pathname + location.search
      navigate(route, { state: { returnTo, messageOrigin: 'Community' } })
    } catch (error) {
      if (activeMemberIdRef.current !== targetId) return
      logger.error('Error starting conversation from preview:', error)
      addToast('Failed to start conversation. Please try again.', 'error')
    } finally {
      if (activeMemberIdRef.current === targetId) {
        setSendingMessage(false)
      }
    }
  }

  const heroSrc = isBrand ? (member.brand_logo_url ?? member.avatar_url) : member.avatar_url
  const heroImageUrl = heroSrc ? getImageUrl(heroSrc, 'avatar-lg') : null
  // Positive, role-specific availability signal (or null) — single source.
  const availLabel = availabilityLabel(member.role, member)

  // initials block was the previous purple fallback; replaced by
  // RolePlaceholder. Computation removed.

  // Prefer the server's canonical profile_completeness_pct (same value the grid
  // card shows) so the preview tier and the card never disagree; fall back to
  // the client estimator only when the column is absent (2d unification).
  const tier = member.profile_completeness_pct != null
    ? calculateTier(member.profile_completeness_pct)
    : getMemberTier(member)
  const positions = [member.position, member.secondary_position]
    .filter((value, index, self): value is string => {
      if (!value) return false
      return self.findIndex(item => item === value) === index
    })
    .map(p => p.charAt(0).toUpperCase() + p.slice(1))
  const umpireActivity = member.role === 'umpire' ? getUmpireActivity(member.last_officiated_at) : null
  const bioText = (() => {
    if (member.role === 'club') return member.club_bio?.trim() ?? null
    if (member.role === 'brand') return member.brand_bio?.trim() ?? null
    return member.bio?.trim() ?? null
  })()

  const overlay = (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/50 ${closing ? 'animate-fade-out' : 'animate-fade-in'}`}
        onClick={requestClose}
        aria-hidden="true"
      />

      {/* Dialog container — bottom sheet on mobile, centered modal on md+ */}
      <div
        className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-6 pointer-events-none"
        role="dialog"
        aria-modal="true"
        aria-labelledby="member-preview-name"
      >
        <div
          ref={contentRef}
          tabIndex={-1}
          className={`pointer-events-auto relative w-full md:max-w-md bg-white rounded-t-2xl md:rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto ${closing ? 'animate-slide-out-down' : 'animate-slide-in-up'}`}
          onClick={e => e.stopPropagation()}
          style={{
            transform: translateY > 0 ? `translateY(${translateY}px)` : undefined,
            transition: isDragging ? 'none' : 'transform 0.2s ease-out',
            // Hint to the browser that touch on the top region is a vertical
            // gesture we'll handle ourselves — improves drag responsiveness on
            // iOS Safari without breaking native scroll on the body content.
            touchAction: isDragging ? 'none' : undefined,
          }}
        >
          {/* Sticky top: drag handle (mobile) + always-visible close pill.
              The strip is transparent so the hero shows through; the close
              button gets its own opaque white pill for prominence over any
              hero color. Drag handlers only initiate from this region so
              native scroll inside the modal body keeps working. */}
          <div
            className="sticky top-0 z-10 px-4 pt-3 pb-2"
            onTouchStart={handleDragStart}
            onTouchMove={handleDragMove}
            onTouchEnd={handleDragEnd}
            onTouchCancel={handleDragEnd}
          >
            <div className="md:hidden flex justify-center">
              <span className="inline-block w-12 h-1.5 rounded-full bg-gray-400/80" aria-hidden="true" />
            </div>
            {/* Save button moved INTO QuickActionsRow above the
                sticky footer (Spec G.5 mount). Players viewing other
                profiles still get a Save action via QuickActionsRow;
                recruiters get the full row (Save + Message + Invite
                + Compare + ⋯). Removing the corner bookmark de-
                clutters the hero image area. */}
            <button
              type="button"
              onClick={requestClose}
              className="absolute top-2.5 right-3 w-9 h-9 rounded-full bg-white shadow-md ring-1 ring-gray-200 flex items-center justify-center text-gray-900 hover:bg-gray-50 active:bg-gray-100 transition-colors active:scale-95"
              aria-label="Close preview"
            >
              <X className="w-4 h-4" strokeWidth={2.5} />
            </button>
          </div>

          {/* Hero image */}
          <div className={`relative ${isBrand ? 'aspect-[4/3] bg-gradient-to-br from-gray-50 to-gray-100' : 'aspect-[4/3] bg-gray-100'}`}>
            {heroImageUrl ? (
              <img
                src={heroImageUrl}
                alt=""
                className={`absolute inset-0 w-full h-full ${isBrand ? 'object-contain p-8' : 'object-cover'}`}
                decoding="async"
              />
            ) : (
              // Role-tinted placeholder. Matches the MemberTile fallback so
              // tapping a tile and opening this modal stays visually
              // consistent. Profile is still flagged photo-missing in DB.
              <div className="absolute inset-0">
                <RolePlaceholder role={member.role} label="" />
              </div>
            )}
            {availLabel && (
              <span
                className="absolute top-3 right-3 w-3.5 h-3.5 rounded-full bg-emerald-500 ring-2 ring-white"
                aria-label={availLabel}
                title={availLabel}
              />
            )}
          </div>

          {/* Content */}
          <div className="p-5 space-y-4">
            {/* Name row */}
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <h2 id="member-preview-name" className="text-xl font-bold text-gray-900 truncate flex-1">
                  {member.full_name}
                </h2>
                <VerifiedBadge verified={Boolean(member.is_verified)} verifiedAt={member.verified_at ?? null} />
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <RoleBadge role={member.role} />
                {member.role !== 'brand' && member.role !== 'umpire' && (
                  <TierBadge tier={tier} size="sm" />
                )}
                {member.role === 'umpire' && member.umpire_level && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                    <Shield className="w-3 h-3" />
                    {member.umpire_level}
                  </span>
                )}
                <ConditionalAvailabilityPill
                  role={member.role}
                  open_to_play={member.open_to_play}
                  open_to_coach={member.open_to_coach}
                  open_to_opportunities={member.open_to_opportunities}
                  available_for_appointments={member.available_for_appointments}
                  size="sm"
                />
                {member.role === 'brand' && member.brand_category && (
                  <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                    {BRAND_CATEGORY_LABELS[member.brand_category] ?? member.brand_category}
                  </span>
                )}
                {/* Club Fit chip — recruiter-only. Hidden when viewer
                    isn't a club or the candidate isn't player/coach. */}
                <ClubFitChip
                  candidate={{
                    id: member.id,
                    role: member.role,
                    playing_category: member.playing_category ?? null,
                    current_world_club_id: member.current_world_club_id ?? null,
                    open_to_play: member.open_to_play ?? null,
                    open_to_coach: member.open_to_coach ?? null,
                    open_to_opportunities: (member as { open_to_opportunities?: boolean | null }).open_to_opportunities ?? null,
                    last_active_at: (member as { last_active_at?: string | null }).last_active_at ?? null,
                    // Increment #2B/#3.2 — the preview popover shows full Fit
                    // reasons, so it needs position + specialist for the role
                    // (position_match) component (the inline card bars don't).
                    position: member.position ?? null,
                    secondary_position: member.secondary_position ?? null,
                    specialist_skills: (member as { specialist_skills?: string[] | null }).specialist_skills ?? null,
                  }}
                />
              </div>
            </div>

            {/* Identity rows */}
            <div className="space-y-2 text-sm">
              {(member.nationality_country_id || member.nationality) && (
                <div className="flex items-center gap-2 text-gray-700">
                  <Globe className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <DualNationalityDisplay
                    primaryCountryId={member.nationality_country_id}
                    secondaryCountryId={member.role === 'club' ? null : member.nationality2_country_id}
                    fallbackText={member.nationality}
                    mode="compact"
                    className="text-gray-700"
                  />
                </div>
              )}

              {member.base_location && (
                <div className="flex items-center gap-2 text-gray-700">
                  <MapPin className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <span>{member.base_location}</span>
                </div>
              )}

              {(member.role === 'player' || member.role === 'coach') && member.current_club && (
                <div className="flex items-center gap-2 text-gray-700">
                  {clubLogo ? (
                    <img src={getImageUrl(clubLogo, 'card-thumb') ?? clubLogo} alt="" loading="lazy" decoding="async" className="w-4 h-4 rounded-sm object-cover flex-shrink-0" />
                  ) : (
                    <Building2 className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  )}
                  <span className="font-medium">{member.current_club}</span>
                </div>
              )}

              {(member.role === 'player' || member.role === 'coach') && positions.length > 0 && (
                <div className="flex items-center gap-2 text-gray-700">
                  <Shield className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <span>{positions.join(' • ')}</span>
                </div>
              )}

              {member.role === 'coach' && member.coach_specialization && (
                <div className="flex items-center gap-2 text-gray-700">
                  <Shield className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <span>{getSpecializationLabel(member.coach_specialization, member.coach_specialization_custom)}</span>
                </div>
              )}

              {member.role === 'club' && member.year_founded && (
                <div className="flex items-center gap-2 text-gray-700">
                  <Calendar className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <span>Founded {member.year_founded}</span>
                </div>
              )}

              {member.role === 'umpire' && member.federation && (
                <div className="flex items-center gap-2 text-gray-700">
                  <Flag className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <span>{member.federation}</span>
                </div>
              )}

              {member.role === 'umpire' && member.umpire_since && (
                <div className="flex items-center gap-2 text-gray-700">
                  <Calendar className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <span>Umpiring since {member.umpire_since}</span>
                </div>
              )}

              {member.role === 'umpire' && member.officiating_specialization && (
                <div className="flex items-center gap-2 text-gray-700">
                  <Shield className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <span className="capitalize">{member.officiating_specialization}</span>
                </div>
              )}

              {member.role === 'umpire' && umpireActivity && (
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  <span className={umpireActivity.state === 'active' ? 'text-emerald-700 font-medium' : 'text-gray-700'}>
                    {umpireActivity.label}
                  </span>
                </div>
              )}

              {member.role === 'umpire' && member.languages && member.languages.length > 0 && (
                <div className="flex items-start gap-2 text-gray-700">
                  <LanguagesIcon className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                  <div className="flex flex-wrap gap-1">
                    {member.languages.map(lang => (
                      <span key={lang} className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                        {lang}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Evidence breakdown — recruiter-only, player/coach. The
                Community card shows only the LEVEL; here in the Preview we
                show the full present/missing breakdown behind it. */}
            {isRecruiterViewer && (member.role === 'player' || member.role === 'coach') && (() => {
              const evInput = {
                role: member.role,
                highlight_video_url: member.highlight_video_url ?? null,
                full_game_video_count: member.full_game_video_count ?? null,
                accepted_reference_count: member.accepted_reference_count ?? null,
                is_verified: member.is_verified ?? null,
                current_world_club_id: member.current_world_club_id ?? null,
              }
              const ev = computeEvidence(evInput)
              const rows = evidenceChecklist({
                ...evInput,
                current_club: member.current_club ?? null,
                career_entry_count: (member as { career_entry_count?: number | null }).career_entry_count ?? null,
                open_to_play: member.open_to_play ?? null,
                open_to_coach: member.open_to_coach ?? null,
                competition_level_band: getClubLevelBand(
                  member.current_world_club_id ?? null,
                  categoryToBandTarget(member.playing_category ?? null),
                ),
              })
              const label = ev.isApplicable ? evidenceLevelLabel(ev.level) : 'Missing evidence'
              const color = !ev.isApplicable
                ? 'text-gray-400'
                : ev.level === 'strong'
                  ? 'text-emerald-600'
                  : ev.level === 'moderate'
                    ? 'text-gray-700'
                    : 'text-gray-500'
              return (
                <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3">
                  <div className="mb-2 flex items-center gap-1.5">
                    <ShieldCheck className={`h-4 w-4 ${color}`} />
                    <span className={`text-sm font-semibold ${color}`}>{label}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                    {rows.map((r) => (
                      <div key={r.key} className="flex items-center gap-1.5 text-xs">
                        {r.present ? (
                          <Check className="h-3.5 w-3.5 flex-shrink-0 text-emerald-600" />
                        ) : (
                          <X className="h-3.5 w-3.5 flex-shrink-0 text-gray-300" />
                        )}
                        <span className={r.present ? 'text-gray-700' : 'text-gray-400'}>{r.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}

            {/* Bio excerpt */}
            {bioText && (
              <p className="text-sm text-gray-700 leading-relaxed line-clamp-4 whitespace-pre-line">
                {bioText}
              </p>
            )}

            {/* Stats chips */}
            {(member.role !== 'brand' && member.role !== 'club') &&
              ((member.accepted_reference_count ?? 0) > 0 || (member.accepted_friend_count ?? 0) > 0) && (
              <div className="flex flex-wrap gap-2">
                {(member.accepted_reference_count ?? 0) > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800">
                    <Shield className="w-3 h-3" />
                    Trusted by {member.accepted_reference_count}
                  </span>
                )}
                {(member.accepted_friend_count ?? 0) > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">
                    {member.accepted_friend_count} {member.accepted_friend_count === 1 ? 'friend' : 'friends'}
                  </span>
                )}
              </div>
            )}

            {/* Brand external links */}
            {member.role === 'brand' && (member.brand_website_url || member.brand_instagram_url) && (
              <div className="flex items-center gap-2">
                {member.brand_website_url && (
                  <a
                    href={member.brand_website_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-100 text-gray-700 text-xs font-medium hover:bg-gray-200 transition-colors"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Website
                  </a>
                )}
                {member.brand_instagram_url && (
                  <a
                    href={member.brand_instagram_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-100 text-gray-700 text-xs font-medium hover:bg-gray-200 transition-colors"
                  >
                    <Instagram className="w-3 h-3" />
                    Instagram
                  </a>
                )}
              </div>
            )}
          </div>

          {/* Quick actions row — Spec G.5. Save toggle, Message
              (uses the bespoke handleMessage so the smart
              conversation-resolution logic is preserved), Invite/
              Compare (recruiter-only, disabled until built), and
              overflow with Move-to-list / Add note. The row
              auto-hides for own-profile + anonymous viewers; for
              non-recruiters only Save + Message + ⋯ render. */}
          {showSaveButton && (
            <div className="px-4 pb-3 flex justify-center">
              <QuickActionsRow
                playerId={member.id}
                playerName={member.full_name ?? 'this member'}
                onMessage={() => void handleMessage()}
                showAddFriend={member.role !== 'club' && member.role !== 'brand'}
                className="w-full justify-center flex-wrap"
              />
            </div>
          )}

          {/* Footer CTA — View Profile only now. Message moved into
              QuickActionsRow above so the sticky footer stays single-
              purpose: the primary "see more" action. */}
          <div className="sticky bottom-0 bg-white border-t border-gray-100 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <button
              type="button"
              onClick={handleViewProfile}
              disabled={sendingMessage}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] rounded-lg bg-gradient-to-r from-[#8026FA] to-[#924CEC] text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-60"
            >
              <User className="w-4 h-4" />
              View Profile
            </button>
          </div>
        </div>
      </div>

      <SignInPromptModal
        isOpen={showSignInPrompt}
        onClose={handleSignInPromptClose}
        title={signInAction === 'message' ? 'Sign in to message' : 'Sign in to view profile'}
        message={
          signInAction === 'message'
            ? 'Sign in or create a free HOCKIA account to connect with this member.'
            : 'Sign in or create a free HOCKIA account to view member profiles.'
        }
      />
    </>
  )

  return createPortal(overlay, document.body)
}
