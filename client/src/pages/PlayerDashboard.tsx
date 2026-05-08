import { useEffect, useMemo, useState, useRef } from 'react'
import { ArrowLeft, MapPin, Calendar, Edit2, Eye, MessageCircle, Landmark, Mail, Award } from 'lucide-react'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { Avatar, EditProfileModal, FriendsTab, ReferencesTab, FriendshipButton, PublicReferencesSection, PublicViewBanner, RoleBadge, ScrollableTabs, NextStepCard, ProfileHealthCard, LastActivePill, WelcomeValueCard, FreshnessCard, RecentlyConnectedCard, SearchAppearancesCard, DualNationalityDisplay, AvailabilityPill, TierBadge, TrustBadge, VerifiedBadge, CategoryConfirmationBanner } from '@/components'
import { PulseSection } from '@/components/home/PulseSection'
import { calculateTier } from '@/lib/profileTier'
import { useProfileFreshness } from '@/hooks/useProfileFreshness'
import type { FreshnessNudge } from '@/lib/profileFreshness'
import { useSearchAppearances } from '@/hooks/useSearchAppearances'
import ProfileActionMenu from '@/components/ProfileActionMenu'
import Header from '@/components/Header'
import MediaTab from '@/components/MediaTab'
import JourneyTab from '@/components/JourneyTab'
import CommentsTab from '@/components/CommentsTab'
import AddVideoLinkModal from '@/components/AddVideoLinkModal'
import ProfilePostsTab from '@/components/ProfilePostsTab'
import Button from '@/components/Button'
import SignInPromptModal from '@/components/SignInPromptModal'
import SocialLinksDisplay from '@/components/SocialLinksDisplay'
import type { Profile } from '@/lib/supabase'
import { categoryToDisplay } from '@/lib/hockeyCategories'
import { supabase } from '@/lib/supabase'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useToastStore } from '@/lib/toast'
import { useNotificationStore } from '@/lib/notifications'
import { derivePublicContactEmail } from '@/lib/profile'
import type { SocialLinks } from '@/lib/socialLinks'
import { useProfileStrength, type ProfileStrengthBucket } from '@/hooks/useProfileStrength'
import { useReferenceFriendOptions } from '@/hooks/useReferenceFriendOptions'
import { useTrustedReferences } from '@/hooks/useTrustedReferences'
import { trackReferenceBadgeClick } from '@/lib/analytics'
import { ProfileViewersSection } from '@/components/ProfileViewersSection'
import AvailabilityToggleStrip from '@/components/AvailabilityToggleStrip'
import ClubLinkPrompt from '@/components/ClubLinkPrompt'
import ShareProfileButton from '@/components/profile/ShareProfileButton'
import { useWorldClubLogo } from '@/hooks/useWorldClubLogo'
import { useTabDeepLinkScroll } from '@/hooks/useTabDeepLinkScroll'

// `?section=` query param → DOM anchor id. Used by the deep-link scroll
// hook so notifications like ?tab=profile&section=viewers land on the
// right card instead of the top of the page.
const PLAYER_SECTION_ANCHORS = { viewers: 'profile-viewers' } as const
import { calculateAge, formatDateOfBirth, getInitials } from '@/lib/utils'

type TabType = 'profile' | 'journey' | 'references' | 'friends' | 'comments' | 'posts'

export type PlayerProfileShape =
  Partial<Profile> &
  Pick<
    Profile,
    | 'id'
    | 'role'
    | 'full_name'
    | 'avatar_url'
    | 'base_location'
    | 'bio'
    | 'nationality'
    | 'nationality_country_id'
    | 'nationality2_country_id'
    | 'gender'
    | 'date_of_birth'
    | 'position'
    | 'secondary_position'
    | 'current_club'
    | 'email'
    | 'contact_email'
    | 'contact_email_public'
  >

interface PlayerDashboardProps {
  profileData?: PlayerProfileShape
  readOnly?: boolean
  /** When true and readOnly is true, shows a banner indicating user is viewing their own public profile */
  isOwnProfile?: boolean
  /** Role of the viewer (from auth store), used for highlight video visibility */
  viewerRole?: string | null
}

export default function PlayerDashboard({ profileData, readOnly = false, isOwnProfile = false, viewerRole }: PlayerDashboardProps) {
  const { profile: authProfile, user } = useAuthStore()
  const profile = (profileData ?? authProfile) as PlayerProfileShape | null
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { addToast } = useToastStore()
  const [activeTab, setActiveTab] = useState<TabType>(() => {
    const tabParam = searchParams.get('tab') as TabType | null
    return tabParam && ['profile', 'journey', 'references', 'friends', 'comments', 'posts'].includes(tabParam) ? tabParam : 'profile'
  })
  const [showEditModal, setShowEditModal] = useState(false)
  const [showAddVideoModal, setShowAddVideoModal] = useState(false)
  const [showSignInPrompt, setShowSignInPrompt] = useState(false)
  const [sendingMessage, setSendingMessage] = useState(false)
  const claimCommentHighlights = useNotificationStore((state) => state.claimCommentHighlights)

  // Profile strength for player profiles (only for own profile)
  const profileStrength = useProfileStrength(!readOnly ? (profile as Profile) : null)
  // Freshness nudges (owner only — no value in showing "your Journey is stale" to visitors)
  const { nudge: freshnessNudge } = useProfileFreshness({
    role: 'player',
    profileId: readOnly ? null : profile?.id ?? null,
  })
  // Search appearances (owner only) — last 7 days aggregate.
  const { summary: searchAppearances } = useSearchAppearances({
    profileId: readOnly ? null : profile?.id ?? null,
  })
  // Phase 3 — RecentlyConnectedCard data. Pull friend options + references
  // so we can compute "recently accepted, not yet asked" candidates and hide
  // the nudge once the owner has any accepted reference. Owner-only.
  const { friendOptions: nudgeFriendOptions } = useReferenceFriendOptions(
    readOnly ? null : profile?.id ?? null,
  )
  const { acceptedReferences: nudgeAccepted, pendingReferences: nudgePending } = useTrustedReferences(
    readOnly ? '' : profile?.id ?? '',
  )
  // Stable Set identity so RecentlyConnectedCard's useMemo doesn't recompute
  // on every parent render. Memo deps are the raw arrays whose identity only
  // changes after a refetch.
  const nudgeExcludeIds = useMemo(
    () =>
      new Set([
        ...nudgeAccepted.map((r) => r.profile?.id).filter((id): id is string => Boolean(id)),
        ...nudgePending.map((r) => r.profile?.id).filter((id): id is string => Boolean(id)),
      ]),
    [nudgeAccepted, nudgePending],
  )
  // Treat pending requests like accepted ones for the discovery-nudge
  // visibility check. A user with 0 accepted but several pending references
  // has already discovered the feature; the nudge would just push them to
  // create more requests they're already at the cap for (server rejects at
  // MAX_REFERENCES). nudgeFloor collapses both into one "has activity?" gate.
  const nudgeAcceptedFloor = nudgeAccepted.length + nudgePending.length
  const prevPercentageRef = useRef<number | null>(null)
  const clearCommentNotifications = useNotificationStore((state) => state.clearCommentNotifications)
  const commentHighlightVersion = useNotificationStore((state) => state.commentHighlightVersion)
  const [highlightedComments, setHighlightedComments] = useState<Set<string>>(new Set())
  const currentWorldClubId = (profile as Partial<Profile> | null)?.current_world_club_id ?? null
  const currentClubLogo = useWorldClubLogo(currentWorldClubId)

  const tabParam = searchParams.get('tab') as TabType | null
  const sectionParam = searchParams.get('section')

  useEffect(() => {
    if (!tabParam) return
    if (tabParam !== activeTab && ['profile', 'journey', 'references', 'friends', 'comments', 'posts'].includes(tabParam)) {
      setActiveTab(tabParam)
    }
  }, [tabParam, activeTab])

  // Tab + section deep-link scroll. Notifications and shareable URLs (e.g.
  // ?tab=profile&section=viewers, ?tab=journey) used to land at the top
  // of the profile, leaving the user staring at the header instead of the
  // section they were sent to.
  useTabDeepLinkScroll({
    activeTab,
    tabParam,
    sectionParam,
    sectionAnchors: PLAYER_SECTION_ANCHORS,
  })

  // Refresh profile strength when switching tabs (picks up gallery/journey changes)
  useEffect(() => {
    if (!readOnly) {
      void profileStrength.refresh()
    }
  }, [activeTab, readOnly]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (readOnly) {
      return
    }

    if (activeTab !== 'comments') {
      if (highlightedComments.size > 0) {
        setHighlightedComments(new Set())
      }
      return
    }

    const ids = claimCommentHighlights()
    const hasNewHighlights = ids.some((id) => !highlightedComments.has(id))
    if (hasNewHighlights) {
      setHighlightedComments((prev) => {
        const next = new Set(prev)
        ids.forEach((id) => next.add(id))
        return next
      })
    }

    void clearCommentNotifications()
  }, [activeTab, claimCommentHighlights, clearCommentNotifications, commentHighlightVersion, readOnly, highlightedComments])

  // Show toast when profile strength increases
  useEffect(() => {
    if (readOnly || profileStrength.loading) return
    
    const currentPercentage = profileStrength.percentage
    const prevPercentage = prevPercentageRef.current
    
    // Only show toast if we have a previous value and the percentage increased
    if (prevPercentage !== null && currentPercentage > prevPercentage) {
      const increase = currentPercentage - prevPercentage
      if (currentPercentage >= 100) {
        addToast("Your profile is now complete! Clubs can fully evaluate you.", 'success')
      } else {
        addToast(`Profile strength +${increase}%. Keep going!`, 'success')
      }
    }
    
    prevPercentageRef.current = currentPercentage
  }, [profileStrength.percentage, profileStrength.loading, readOnly, addToast])

  // Handler for profile strength bucket actions
  const handleProfileStrengthAction = (bucket: ProfileStrengthBucket) => {
    switch (bucket.action.type) {
      case 'edit-profile':
        setShowEditModal(true)
        break
      case 'tab':
        handleTabChange(bucket.action.tab as TabType)
        break
      case 'add-video':
        // Navigate to profile tab first, then open video modal
        if (activeTab !== 'profile') {
          handleTabChange('profile')
        }
        setShowAddVideoModal(true)
        break
    }
  }

  // Handler for freshness nudges — routes to the relevant tab or edit modal.
  const handleFreshnessAction = (nudge: FreshnessNudge) => {
    if (nudge.action.type === 'edit-profile') {
      setShowEditModal(true)
    } else if (nudge.action.type === 'tab') {
      handleTabChange(nudge.action.tab as TabType)
    }
  }

  if (!profile) return null

  const handleSendMessage = async () => {
    if (!user) {
      setShowSignInPrompt(true)
      return
    }
    if (!profileData) return
    if (user.id === profileData.id) {
      addToast('You cannot message yourself.', 'error')
      return
    }

    setSendingMessage(true)
    try {
      const { data: existingConv, error: fetchError } = await supabase
        .from('conversations')
        .select('id')
        .or(
          `and(participant_one_id.eq.${user.id},participant_two_id.eq.${profileData.id}),and(participant_one_id.eq.${profileData.id},participant_two_id.eq.${user.id})`
        )
        .maybeSingle()

      if (fetchError) throw fetchError

      if (existingConv?.id) {
        navigate(`/messages?conversation=${existingConv.id}`)
      } else {
        navigate(`/messages?new=${profileData.id}`)
      }
    } catch (error) {
      logger.error('Error starting conversation:', error)
      addToast('Failed to start conversation. Please try again.', 'error')
    } finally {
      setSendingMessage(false)
    }
  }

  const tabs: { id: TabType; label: string }[] = [
    { id: 'profile', label: 'Profile' },
    { id: 'journey', label: 'Journey' },
    { id: 'references', label: 'References' },
    { id: 'friends', label: 'Friends' },
    { id: 'comments', label: 'Comments' },
    { id: 'posts', label: 'Posts' },
  ]

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab)
    const next = new URLSearchParams(searchParams)
    next.set('tab', tab)
    setSearchParams(next, { replace: true })
  }

  const age = calculateAge(profile.date_of_birth)
  const positions = [profile.position, profile.secondary_position].filter((value, index, self): value is string => {
    if (!value) return false
    return self.findIndex((item) => item === value) === index
  })
  const publicContact = derivePublicContactEmail(profile)
  const savedContactEmail = profile.contact_email?.trim() || ''

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      
      {/* Public View Banner - shown when user views their own profile in public mode */}
      {readOnly && isOwnProfile && <PublicViewBanner />}

      <main className="max-w-7xl mx-auto px-4 md:px-6 pt-24 pb-12">
        {readOnly && !isOwnProfile && (
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm font-medium">Back</span>
          </button>
        )}

        {!readOnly && (
          <CategoryConfirmationBanner
            needsConfirmation={Boolean(profile.category_confirmation_needed)}
            onConfirm={() => setShowEditModal(true)}
          />
        )}

        {/* Profile Header */}
        <div className="bg-white rounded-2xl p-6 md:p-8 shadow-sm mb-6 animate-fade-in overflow-visible">
          <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
            {/* Avatar */}
            <Avatar
              src={profile.avatar_url}
              initials={getInitials(profile.full_name)}
              size="xl"
              className="flex-shrink-0"
              alt={profile.full_name ?? undefined}
              enablePreview
              previewTitle={profile.full_name ?? undefined}
              role="player"
            />
            <div className="flex-1">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-3">
                <h1 className="text-3xl md:text-4xl font-bold text-gray-900 flex items-center gap-2">
                  <span>{profile.full_name}</span>
                  <VerifiedBadge
                    verified={(profile as unknown as { is_verified?: boolean; verified_at?: string | null } | null)?.is_verified}
                    verifiedAt={(profile as unknown as { is_verified?: boolean; verified_at?: string | null } | null)?.verified_at ?? null}
                  />
                </h1>
                {readOnly ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <FriendshipButton profileId={profile.id} />
                    {!isOwnProfile && authProfile?.role !== 'brand' && (
                      <button
                        type="button"
                        onClick={handleSendMessage}
                        disabled={sendingMessage}
                        className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-[#8026FA] to-[#924CEC] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-60"
                      >
                        {sendingMessage ? (
                          <>
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            Sending...
                          </>
                        ) : (
                          <>
                            <MessageCircle className="w-4 h-4" />
                            Message
                          </>
                        )}
                      </button>
                    )}
                    {isOwnProfile && (
                      <ShareProfileButton profile={{ role: profile.role as 'player' | 'coach', username: profile.username, id: profile.id }} />
                    )}
                    {!isOwnProfile && <ProfileActionMenu targetId={profile.id} targetName={profile.full_name ?? 'this user'} />}
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <ShareProfileButton profile={{ role: profile.role as 'player' | 'coach', username: profile.username, id: profile.id }} />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        // Use the canonical role-specific URL so the owner's
                        // Network View matches the URL the share button copies
                        // (avoids two URL shapes for the same content).
                        const base = profile.role === 'coach' ? '/coaches' : '/players'
                        const slug = profile.username ? profile.username : `id/${profile.id}`
                        navigate(`${base}/${slug}`)
                      }}
                      className="gap-1.5 whitespace-nowrap text-xs sm:text-sm px-2.5 sm:px-4"
                    >
                      <Eye className="w-4 h-4 flex-shrink-0" />
                      <span className="hidden xs:inline">Network View</span>
                      <span className="xs:hidden">View</span>
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => setShowEditModal(true)}
                      className="gap-1.5 whitespace-nowrap text-xs sm:text-sm px-2.5 sm:px-4"
                    >
                      <Edit2 className="w-4 h-4 flex-shrink-0" />
                      <span className="hidden xs:inline">Edit Profile</span>
                      <span className="xs:hidden">Edit</span>
                    </Button>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3 text-gray-600">
                {/* Nationality */}
                <div className="flex items-center gap-1.5">
                  <DualNationalityDisplay
                    primaryCountryId={profile.nationality_country_id}
                    secondaryCountryId={profile.nationality2_country_id}
                    fallbackText={profile.nationality}
                    mode="compact"
                  />
                </div>

                <span className="text-gray-400">•</span>
                
                {/* Base Location */}
                <div className="flex items-center gap-1.5">
                  <MapPin className="w-4 h-4 md:w-5 md:h-5" />
                  <span>{profile.base_location}</span>
                </div>

                {/* Age (if date of birth exists) */}
                {age && (
                  <>
                    <span className="text-gray-400">•</span>
                    <div className="flex items-center gap-1.5">
                      <Calendar className="w-4 h-4 md:w-5 md:h-5" />
                      <span>{age} years old</span>
                    </div>
                  </>
                )}

                {/* Playing category (if specified). Phase 3 — neutral chip,
                    no per-gender color coding (5 categories make arbitrary
                    colors noisy). */}
                {profile.playing_category && (
                  <>
                    <span className="text-gray-400">•</span>
                    <div className="flex items-center gap-1.5 text-gray-700">
                      <span>{categoryToDisplay(profile.playing_category)}</span>
                    </div>
                  </>
                )}

                {/* Position (if specified) */}
                {positions.length > 0 && (
                  <>
                    <span className="text-gray-400">•</span>
                    <div className="flex items-center gap-1.5">
                      <span>🏑</span>
                      <span>{positions.join(' • ')}</span>
                    </div>
                  </>
                )}

                {/* Current Club (if specified) */}
                {profile.current_club && (
                  <>
                    <span className="text-gray-400">•</span>
                    <div className="flex items-center gap-1.5">
                      {currentClubLogo ? (
                        <img
                          src={currentClubLogo}
                          alt=""
                          className="w-5 h-5 rounded-full object-cover flex-shrink-0"
                        />
                      ) : (
                        <Landmark className="w-4 h-4 md:w-5 md:h-5" />
                      )}
                      <span>{profile.current_club}</span>
                    </div>
                  </>
                )}

                {/* Brand Representation (if specified) */}
                {profile.brand_representation && (
                  <>
                    <span className="text-gray-400">•</span>
                    <div className="flex items-center gap-1.5">
                      <Award className="w-4 h-4 md:w-5 md:h-5" />
                      <span>{profile.brand_representation}</span>
                    </div>
                  </>
                )}

                {/* Public contact email - visible when enabled */}
                {publicContact.shouldShow && publicContact.displayEmail && (
                  <>
                    <span className="text-gray-400">•</span>
                    <a
                      href={`mailto:${publicContact.displayEmail}`}
                      className="flex items-center gap-1.5 hover:text-[#8026FA] transition-colors"
                    >
                      <Mail className="w-4 h-4 md:w-5 md:h-5" />
                      <span>{publicContact.displayEmail}</span>
                    </a>
                  </>
                )}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-4">
                <RoleBadge role="player" />
                {!readOnly && !profileStrength.loading && (
                  <TierBadge tier={calculateTier(profileStrength.percentage)} />
                )}
                {/* LastActivePill — auth-only "Active today / this week /
                    this month" indicator. Self-gates on viewer auth and
                    on whether last_active_at is recent enough. Renders
                    nothing for anonymous visitors and silently absent
                    when the profile is >30 days inactive. */}
                <LastActivePill
                  lastActiveAt={(profile as Partial<Profile> | null)?.last_active_at ?? null}
                  // show_last_active was added in migration 20260508800000
                  // and isn't in database.types.ts yet (re-gen happens after
                  // the migration is applied). Loose-cast read so the
                  // TypeScript build stays green; LastActivePill defaults
                  // to "show" when the value is undefined/null so the
                  // ordering of code-vs-migration deploys is forgiving.
                  showLastActive={
                    (profile as { show_last_active?: boolean | null } | null)?.show_last_active ?? null
                  }
                />
                {/* Phase 4 References UX Plan #1.5 — TrustBadge in the metadata
                    pills row. Owner with 0 references sees a "Get vouches →"
                    CTA that switches to the friends tab and scrolls to the
                    references area (uses the B2 deep-link wiring). Visitor
                    with 0 references sees nothing (silent). Owner or visitor
                    with N>0 sees "Trusted by N" and tapping anchors to
                    PublicReferencesSection (visitor) or the trust subarea
                    (owner). */}
                <TrustBadge
                  count={profile.accepted_reference_count ?? 0}
                  isOwner={!readOnly}
                  onClick={() => {
                    trackReferenceBadgeClick('player', profile.accepted_reference_count ?? 0)
                    if (!readOnly) {
                      // Owner — go to the dedicated References tab.
                      setActiveTab('references')
                      const next = new URLSearchParams(searchParams)
                      next.set('tab', 'references')
                      next.delete('section')
                      setSearchParams(next, { replace: false })
                    } else {
                      // Visitor — anchor scroll to public references.
                      document.getElementById('public-references')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    }
                  }}
                />
                {profile.open_to_play && <AvailabilityPill variant="play" />}
                <SocialLinksDisplay
                  links={profile.social_links as SocialLinks | null | undefined}
                  iconSize="sm"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Owner-side hierarchy (matches the v5-plan dashboard guideline):
              1. Pulse — "Since you last visited" (only when high-signal items exist)
              2. NextStepCard — single gamified primary action (bar + % + Next Step)
              3. ProfileSnapshot — positive evidence (chips of present signals)
              4. FreshnessCard — secondary recency nudge
              5. RecentlyConnectedCard — only when NextStep ISN'T a references ask
              6. SearchAppearancesCard — informational only
            Visitor mode skips 1/2/4/5/6 and only sees the Snapshot (chips). */}
        {!readOnly ? (
          <>
            <WelcomeValueCard />
            <div className="mt-3" />
            <PulseSection />
            <NextStepCard
              percentage={profileStrength.percentage}
              buckets={profileStrength.buckets}
              loading={profileStrength.loading}
              onBucketAction={handleProfileStrengthAction}
            />
            {/* ProfileHealthCard — diagnostic counterpart to NextStepCard.
                Sits in the slot ProfileSnapshot used to occupy. Distinct
                role from NextStepCard above:
                  - NextStepCard answers "what should I do next?" (single
                    gamified CTA, motivational tone)
                  - ProfileHealthCard answers "what's the full picture?"
                    (every bucket with ✓ / ○, neutral comparative copy)
                Reuses the same useProfileStrength data — no extra queries. */}
            <div className="mt-3">
              <ProfileHealthCard
                percentage={profileStrength.percentage}
                buckets={profileStrength.buckets}
                loading={profileStrength.loading}
              />
            </div>
            <div className="mt-3">
              <FreshnessCard nudge={freshnessNudge} onAction={handleFreshnessAction} />
            </div>
            {/* Recently-connected vouch nudge — gated on the next step NOT
                already being a references ask. Without this gate the owner
                sees a NextStepCard "Get your first reference" plus a
                RecentlyConnectedCard "Ask Maria for a reference?" stacked
                directly on top of each other. */}
            {profile?.id && (() => {
              const nextStepBucket = profileStrength.buckets.find((b) => !b.completed)
              const nextStepIsReferences =
                nextStepBucket?.id === 'references' || nextStepBucket?.id === 'friends'
              if (nextStepIsReferences) return null
              return (
                <div className="mt-3">
                  <RecentlyConnectedCard
                    friendOptions={nudgeFriendOptions}
                    ownerProfileId={profile.id}
                    excludeIds={nudgeExcludeIds}
                    acceptedReferenceCount={nudgeAcceptedFloor}
                    profileRole={profile.role}
                    onAsk={(friendId) => {
                      setActiveTab('references')
                      const next = new URLSearchParams(searchParams)
                      next.set('tab', 'references')
                      next.set('ask', friendId)
                      next.delete('section')
                      setSearchParams(next, { replace: false })
                    }}
                  />
                </div>
              )
            })()}
            {searchAppearances && searchAppearances.total > 0 && (
              <div className="mt-3">
                <SearchAppearancesCard
                  days={searchAppearances.days}
                  total={searchAppearances.total}
                  windowDays={7}
                />
              </div>
            )}
          </>
        ) : (
          // Visitor view 2026-05-08: ProfileSnapshot card removed — the
          // per-tab content sections (Highlight Video, References,
          // Journey, etc.) already surface the same signals in their
          // canonical locations, and the LastActivePill in the profile
          // header now owns the activity signal that was the snapshot's
          // unique contribution. Showing both was duplicate signal in
          // two visual treatments. Tabs Card below still renders for
          // visitors — the full tab→scroll restructure is queued as a
          // dedicated follow-up batch.
          null
        )}

        {/* Tabs Card — anchor lives on the outer wrapper so the deep-link
            scroll lands with the tab strip at the top of the viewport
            (otherwise the strip is pushed off-screen and the user only
            sees tab content with no indication of which tab is active). */}
        <div id="profile-tab-content" className="bg-white rounded-2xl shadow-sm animate-slide-in-up scroll-mt-4">
          {/* Tab Navigation — owner only.
              Network View v0 (2026-05-08): visitors get a single scrollable
              narrative instead of tabbed navigation. Recruiters scan
              profiles end-to-end rather than tab-clicking through them, so
              a tab strip with hidden content adds friction; the same
              underlying components render inline below. Owner mode keeps
              the tabs to manage each surface independently. */}
          {!readOnly && (
            <div className="border-b border-gray-200 overflow-x-auto">
                <ScrollableTabs
                  tabs={tabs}
                  activeTab={activeTab}
                  onTabChange={handleTabChange}
                  className="gap-8 px-6"
                  activeClassName="border-[#8026FA] text-[#8026FA]"
                  inactiveClassName="border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300"
                />
            </div>
          )}

          {/* Tab Content. min-h-screen guarantees the document is always
              tall enough for useTabDeepLinkScroll's scrollIntoView({block:
              'start'}) to land the tab strip at the viewport top — even on
              Friends/Journey where the rendered content can be shorter than
              the viewport. With less padding (e.g. 70vh) the document caps
              before reaching the needed scroll Y, leaving the strip
              partway down. Empty space below short content is acceptable;
              broken scroll-to-top is not. Verified by qa-tabs-scroll spec. */}
          <div className="p-6 md:p-8 min-h-screen">
            {/* Profile section — always rendered for visitors (top of the
                Network View scroll narrative); activeTab gate for owners. */}
            {(activeTab === 'profile' || readOnly) && (
              <div className="space-y-10 animate-fade-in">
                {!readOnly && (
                  <div id="profile-viewers" className="scroll-mt-20">
                    <ProfileViewersSection />
                  </div>
                )}
                {!readOnly && (
                  <AvailabilityToggleStrip role="player" />
                )}
                {!readOnly && <ClubLinkPrompt />}
                {/* Basic Information - Only shown in private view (not readOnly) to avoid duplication with header card */}
                {!readOnly && (
                <section className="space-y-6">
                  <div className="flex items-start justify-between gap-4">
                    <h2 className="text-2xl font-bold text-gray-900">Basic Information</h2>
                    <button
                      onClick={() => setShowEditModal(true)}
                      className="hidden md:inline-flex items-center gap-2 px-4 py-2 bg-[#8026FA] text-white rounded-lg hover:bg-[#6B20D4] transition-colors text-sm font-medium"
                    >
                      <Edit2 className="w-4 h-4" />
                      Edit Profile
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Left Column */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Full Name
                      </label>
                      <p className="text-gray-900 font-medium">{profile.full_name}</p>
                    </div>

                    {/* Right Column */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Contact Email
                      </label>
                      {publicContact.shouldShow && publicContact.displayEmail ? (
                        <a
                          href={`mailto:${publicContact.displayEmail}`}
                          className="text-[#8026FA] hover:text-[#6B20D4] underline break-words"
                        >
                          {publicContact.displayEmail}
                        </a>
                      ) : (
                        <p className="text-gray-500 italic">Not shared with other HOCKIA members</p>
                      )}
                      <p className="text-xs text-gray-500 mt-1">
                        {profile.contact_email_public
                          ? publicContact.source === 'contact'
                            ? 'Other HOCKIA members see your contact email.'
                            : 'Add a contact email to be reachable.'
                          : savedContactEmail
                            ? 'Saved contact email is private.'
                            : 'No contact email saved; only private channels apply.'}
                      </p>
                      {!profile.contact_email_public && savedContactEmail && (
                        <p className="text-xs text-gray-500 break-words">
                          Private contact email: <span className="text-gray-700 font-medium">{savedContactEmail}</span>
                        </p>
                      )}
                    </div>

                    {/* Left Column */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Nationality
                      </label>
                      <DualNationalityDisplay
                        primaryCountryId={profile.nationality_country_id}
                        secondaryCountryId={profile.nationality2_country_id}
                        fallbackText={profile.nationality}
                        mode="full"
                        className="text-gray-900"
                      />
                    </div>

                    {/* Right Column */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Base Location (City)
                      </label>
                      <p className="text-gray-900">{profile.base_location}</p>
                    </div>

                    {/* Left Column */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Positions
                      </label>
                      <p className={positions.length > 0 ? 'text-gray-900' : 'text-gray-500 italic'}>
                        {positions.length > 0 ? positions.join(' • ') : 'Not specified'}
                      </p>
                    </div>

                    {/* Right Column */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Playing Category
                      </label>
                      <p className={profile.playing_category ? "text-gray-900" : "text-gray-500 italic"}>
                        {categoryToDisplay(profile.playing_category) || 'Not specified'}
                      </p>
                    </div>

                    {/* Left Column */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Date of Birth {age && `(Age: ${age})`}
                      </label>
                      {profile.date_of_birth ? (
                        <p className="text-gray-900">
                          {formatDateOfBirth(profile.date_of_birth)}
                        </p>
                      ) : (
                        <p className="text-gray-500 italic">Not specified</p>
                      )}
                    </div>

                    {/* Left Column */}
                    {profile.current_club && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Current Club
                        </label>
                        <p className="text-gray-900">{profile.current_club}</p>
                      </div>
                    )}
                  </div>

                  <div className="pt-6 border-t border-gray-200 md:hidden">
                    <button
                      onClick={() => setShowEditModal(true)}
                      className="w-full px-6 py-3 bg-[#8026FA] text-white rounded-lg hover:bg-[#6B20D4] transition-colors font-medium"
                    >
                      Update Profile Information
                    </button>
                  </div>
                </section>
                )}

                {readOnly && (
                  // Phase 4 References UX Plan #1.6 — TrustBadge scroll
                  // target. The id + scroll-mt live on the section's own
                  // root so when PublicReferencesSection returns null (zero
                  // references for a visitor), no empty wrapper is left
                  // behind to inflate the surrounding space-y-10 gap.
                  <PublicReferencesSection profileId={profile.id} profileName={profile.full_name ?? profile.username ?? null} />
                )}

                {/* Highlight Video - placed early for immediate visual context */}
                <section className="space-y-3">
                  <MediaTab
                    profileId={profile.id}
                    readOnly={readOnly}
                    showVideo={true}
                    showGallery={false}
                    viewerRole={viewerRole ?? authProfile?.role ?? null}
                    isOwnProfile={!readOnly || isOwnProfile}
                    highlightVisibility={(profile as Profile)?.highlight_visibility ?? 'public'}
                    renderHeader={({ canManageVideo, openManageModal }) => (
                      <div className="flex items-center justify-between gap-3">
                        <h2 className="text-2xl font-bold text-gray-900">Highlight Video</h2>
                        {canManageVideo && (
                          <Button variant="outline" size="sm" onClick={openManageModal}>
                            Manage
                          </Button>
                        )}
                      </div>
                    )}
                  />
                </section>

                <section className="space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <h2 className="text-2xl font-bold text-gray-900">About Me</h2>
                    {!readOnly && (
                      <button
                        onClick={() => setShowEditModal(true)}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium"
                      >
                        <Edit2 className="w-4 h-4" />
                        Edit
                      </button>
                    )}
                  </div>

                  <div className="bg-gray-50 border border-gray-200 rounded-xl p-6">
                    {profile.bio?.trim() ? (
                      <p className="text-gray-700 leading-relaxed whitespace-pre-line break-words">
                        {profile.bio}
                      </p>
                    ) : (
                      <div className="text-gray-500 italic space-y-2">
                        <p>No bio yet.</p>
                        {!readOnly && (
                          <p>
                            Use the edit option to share your background, playing style, and what you&apos;re looking for in a club.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </section>

                {/* Inline Journey — public/read-only viewers only.
                    Surfaces career history directly in the scroll instead of
                    requiring tab discovery. Hidden for owners on /dashboard
                    (the existing Journey tab is unchanged for them). When
                    the profile has no entries, JourneyTab renders nothing
                    in inline+readOnly mode so visitors don't see an empty
                    placeholder. */}
                {readOnly && (
                  <section className="space-y-3">
                    <JourneyTab
                      profileId={profile.id}
                      readOnly
                      variant="inline"
                      title="Journey"
                    />
                  </section>
                )}

                {/* Photo Gallery - placed after About Me for visual balance */}
                <section className="space-y-3">
                  <MediaTab
                    profileId={profile.id}
                    readOnly={readOnly}
                    showVideo={false}
                    showGallery={true}
                  />
                </section>

                {/* Posts — shown inline on public profile below Gallery */}
                {readOnly && (
                  <section className="space-y-3 pt-6 border-t border-gray-200">
                    <h2 className="text-2xl font-bold text-gray-900">Posts</h2>
                    <ProfilePostsTab profileId={profile.id} readOnly />
                  </section>
                )}
              </div>
            )}

            {/* Journey — owner only as a separate tab. Visitors get
                Journey rendered inline within the Profile section above
                (see the `readOnly && <JourneyTab variant="inline" />`
                block ~line 910). Rendering it here too would double up
                the career-history surface. */}
            {activeTab === 'journey' && !readOnly && (
              <div className="animate-fade-in">
                <JourneyTab profileId={profile.id} readOnly={readOnly} />
              </div>
            )}

            {/* Friends/Connections — always for visitors. The internal
                FriendsTab heading is "Connections", which provides the
                section label naturally without a duplicate outer heading. */}
            {(activeTab === 'friends' || readOnly) && (
              <div
                id="visitor-section-friends"
                className={readOnly ? 'mt-12 pt-10 border-t border-gray-200 animate-fade-in' : 'animate-fade-in'}
              >
                <FriendsTab profileId={profile.id} readOnly={readOnly} profileRole={profile.role} hideReferences />
              </div>
            )}

            {/* Comments — always for visitors. CommentsTab has its own
                section heading internally. */}
            {(activeTab === 'comments' || readOnly) && (
              <div
                id="visitor-section-comments"
                className={readOnly ? 'mt-12 pt-10 border-t border-gray-200 animate-fade-in' : 'animate-fade-in'}
              >
                <CommentsTab profileId={profile.id} highlightedCommentIds={highlightedComments} profileRole={profile.role} />
              </div>
            )}

            {/* References — owner only as a separate tab. Visitors see
                PublicReferencesSection inline within the Profile section
                above; rendering ReferencesTab here too would double up the
                trust-references surface. */}
            {activeTab === 'references' && !readOnly && (
              <div className="animate-fade-in">
                <ReferencesTab profileId={profile.id} readOnly={readOnly} profileRole={profile.role} />
              </div>
            )}

            {/* Posts — owner only as a separate tab. Visitors get Posts
                rendered inline at the bottom of the Profile section above
                (existing behaviour, line ~922). */}
            {activeTab === 'posts' && !readOnly && (
              <div className="animate-fade-in">
                <ProfilePostsTab profileId={profile.id} readOnly={readOnly} />
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Edit Profile Modal */}
      <EditProfileModal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        role={profile.role as 'player' | 'coach'}
      />

      {/* Add Video Link Modal - for profile strength action */}
      <AddVideoLinkModal
        isOpen={showAddVideoModal}
        onClose={() => {
          setShowAddVideoModal(false)
          // Refresh profile strength after closing (video may have been added)
          void profileStrength.refresh()
        }}
        currentVideoUrl={(profile as Profile)?.highlight_video_url || ''}
      />

      {/* Sign In Prompt Modal */}
      <SignInPromptModal
        isOpen={showSignInPrompt}
        onClose={() => setShowSignInPrompt(false)}
        title="Sign in to message"
        message="Sign in to message this player and see more about their profile."
      />
    </div>
  )
}
