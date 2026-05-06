import { useEffect, useMemo, useState, useRef } from 'react'
import { ArrowLeft, MapPin, Calendar, Edit2, Eye, MessageCircle, Landmark, Mail, Plus } from 'lucide-react'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { Avatar, DashboardMenu, EditProfileModal, JourneyTab, CommentsTab, FriendsTab, FriendshipButton, NextStepCard, FreshnessCard, ProfileSnapshot, RecentlyConnectedCard, SearchAppearancesCard, PublicReferencesSection, PublicViewBanner, RoleBadge, ScrollableTabs, DualNationalityDisplay, AvailabilityPill, TierBadge, TrustBadge, VerifiedBadge, CategoryConfirmationBanner } from '@/components'
import { PulseSection } from '@/components/home/PulseSection'
import { calculateTier } from '@/lib/profileTier'
import { useProfileFreshness } from '@/hooks/useProfileFreshness'
import type { FreshnessNudge } from '@/lib/profileFreshness'
import { useSearchAppearances } from '@/hooks/useSearchAppearances'
import { useReferenceFriendOptions } from '@/hooks/useReferenceFriendOptions'
import { useTrustedReferences } from '@/hooks/useTrustedReferences'
import { trackReferenceBadgeClick } from '@/lib/analytics'
import ProfileActionMenu from '@/components/ProfileActionMenu'
import Header from '@/components/Header'
import MediaTab from '@/components/MediaTab'
import OpportunitiesTab from '@/components/OpportunitiesTab'
import ProfilePostsTab from '@/components/ProfilePostsTab'
import Button from '@/components/Button'
import { DashboardSkeleton } from '@/components/Skeleton'
import ShareProfileButton from '@/components/profile/ShareProfileButton'
import SignInPromptModal from '@/components/SignInPromptModal'
import SocialLinksDisplay from '@/components/SocialLinksDisplay'
import type { Profile } from '@/lib/supabase'
import { categoriesToDisplay } from '@/lib/hockeyCategories'
import { supabase } from '@/lib/supabase'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useToastStore } from '@/lib/toast'
import { useNotificationStore } from '@/lib/notifications'
import { derivePublicContactEmail } from '@/lib/profile'
import type { SocialLinks } from '@/lib/socialLinks'
import { useCoachProfileStrength, type ProfileBucket as CoachStrengthBucket } from '@/hooks/useCoachProfileStrength'
import { ProfileViewersSection } from '@/components/ProfileViewersSection'
import AvailabilityToggleStrip from '@/components/AvailabilityToggleStrip'
import ClubLinkPrompt from '@/components/ClubLinkPrompt'
import { useWorldClubLogo } from '@/hooks/useWorldClubLogo'
import { calculateAge, formatDateOfBirth, getInitials } from '@/lib/utils'
import { getSpecializationLabel } from '@/lib/coachSpecializations'

type TabType = 'profile' | 'vacancies' | 'journey' | 'friends' | 'comments' | 'posts'

export type CoachProfileShape =
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
    | 'email'
    | 'contact_email'
    | 'contact_email_public'
    | 'current_club'
  >

interface CoachDashboardProps {
  profileData?: CoachProfileShape
  readOnly?: boolean
  /** When true and readOnly is true, shows a banner indicating user is viewing their own public profile */
  isOwnProfile?: boolean
}

export default function CoachDashboard({ profileData, readOnly = false, isOwnProfile = false }: CoachDashboardProps) {
  const { profile: authProfile, user } = useAuthStore()
  const profile = (profileData ?? authProfile) as CoachProfileShape | null
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [activeTab, setActiveTab] = useState<TabType>(() => {
    const param = searchParams.get('tab') as TabType | null
    return param && ['profile', 'vacancies', 'journey', 'friends', 'comments', 'posts'].includes(param) ? param : 'profile'
  })
  const [showEditModal, setShowEditModal] = useState(false)
  const [showSignInPrompt, setShowSignInPrompt] = useState(false)
  const [sendingMessage, setSendingMessage] = useState(false)
  const [triggerCreateVacancy, setTriggerCreateVacancy] = useState(false)
  const { addToast } = useToastStore()
  const claimCommentHighlights = useNotificationStore((state) => state.claimCommentHighlights)
  const clearCommentNotifications = useNotificationStore((state) => state.clearCommentNotifications)
  const commentHighlightVersion = useNotificationStore((state) => state.commentHighlightVersion)
  const [highlightedComments, setHighlightedComments] = useState<Set<string>>(new Set())
  const currentWorldClubId = (profile as Partial<Profile> | null)?.current_world_club_id ?? null
  const currentClubLogo = useWorldClubLogo(currentWorldClubId)

  const tabParam = searchParams.get('tab') as TabType | null

  // Profile strength for coaches (only compute for own profile)
  // Must be called before any early returns to satisfy React hooks rules
  const { percentage, buckets, loading: strengthLoading, refresh: refreshStrength } = useCoachProfileStrength({
    profile: readOnly ? null : (profileData ?? authProfile) as CoachProfileShape | null,
  })

  // Freshness nudges (owner only)
  const { nudge: freshnessNudge } = useProfileFreshness({
    role: 'coach',
    profileId: readOnly ? null : (profileData?.id ?? authProfile?.id ?? null),
    profileUpdatedAt: readOnly ? null : (profile as Partial<Profile> | null)?.updated_at ?? null,
  })
  // Search appearances (owner only) — last 7 days aggregate.
  const { summary: searchAppearances } = useSearchAppearances({
    profileId: readOnly ? null : (profileData?.id ?? authProfile?.id ?? null),
  })
  // Phase 3 — RecentlyConnectedCard data (owner-only).
  const nudgeOwnerId = readOnly ? null : (profileData?.id ?? authProfile?.id ?? null)
  const { friendOptions: nudgeFriendOptions } = useReferenceFriendOptions(nudgeOwnerId)
  const { acceptedReferences: nudgeAccepted, pendingReferences: nudgePending } = useTrustedReferences(
    nudgeOwnerId ?? '',
  )
  const nudgeExcludeIds = useMemo(
    () =>
      new Set([
        ...nudgeAccepted.map((r) => r.profile?.id).filter((id): id is string => Boolean(id)),
        ...nudgePending.map((r) => r.profile?.id).filter((id): id is string => Boolean(id)),
      ]),
    [nudgeAccepted, nudgePending],
  )
  const nudgeAcceptedFloor = nudgeAccepted.length + nudgePending.length

  // Shared handler for NextStepCard — routes a bucket to the right deep-link.
  // Tab switcher that preserves any other search params (e.g. ?ref=…,
  // ?ask=…). Object-form `setSearchParams({ tab })` would clobber them.
  const switchTab = (tab: TabType) => {
    setActiveTab(tab)
    const next = new URLSearchParams(searchParams)
    next.set('tab', tab)
    setSearchParams(next, { replace: true })
  }

  const handleStrengthBucketAction = (bucket: CoachStrengthBucket) => {
    const actionId = bucket.actionId
    if (!actionId) return

    if (actionId === 'edit-profile') {
      setShowEditModal(true)
    } else if (actionId === 'journey-tab') {
      switchTab('journey')
    } else if (actionId === 'gallery-tab') {
      // Scroll to MediaTab section within profile tab
      const mediaSection = document.querySelector('[data-section="media"]')
      if (mediaSection) {
        mediaSection.scrollIntoView({ behavior: 'smooth' })
      }
    } else if (actionId === 'friends-tab') {
      switchTab('friends')
    }
  }

  // Handler for freshness nudges.
  const handleFreshnessAction = (nudge: FreshnessNudge) => {
    if (nudge.action.type === 'edit-profile') {
      setShowEditModal(true)
    } else if (nudge.action.type === 'tab') {
      switchTab(nudge.action.tab as TabType)
    }
  }

  // Handler for ProfileSnapshot missing-signal taps. Snapshot emits action
  // ids in the standard form ('edit-profile' | 'add-video' | 'tab:<name>')
  // — coach has no add-video flow, so video signal is omitted from coach
  // signals upstream, and the dispatcher only handles the cases the coach
  // snapshot actually emits.
  const handleSnapshotAction = (actionId: string) => {
    if (actionId === 'edit-profile') {
      setShowEditModal(true)
      return
    }
    if (actionId.startsWith('tab:')) {
      switchTab(actionId.slice(4) as TabType)
      return
    }
  }

  // Track previous percentage to show toast on improvement
  const prevPercentageRef = useRef<number | null>(null)

  useEffect(() => {
    if (!tabParam) return
    if (tabParam !== activeTab && ['profile', 'vacancies', 'journey', 'friends', 'comments', 'posts'].includes(tabParam)) {
      setActiveTab(tabParam)
    }
  }, [tabParam, activeTab])

  // If a candidate-only coach lands on ?tab=vacancies (e.g. via stale link
  // from when the tab was visible), bounce them to Profile rather than show
  // a blank pane. Runs after profile loads since the gate depends on
  // coach_recruits_for_team.
  useEffect(() => {
    if (!profile) return
    if (activeTab === 'vacancies' && !(profile.coach_recruits_for_team ?? false)) {
      setActiveTab('profile')
      const next = new URLSearchParams(searchParams)
      next.set('tab', 'profile')
      setSearchParams(next, { replace: true })
    }
  }, [profile, activeTab, searchParams, setSearchParams])

  // Refresh profile strength when switching to profile tab (to pick up gallery/journey changes)
  useEffect(() => {
    if (!readOnly && activeTab === 'profile') {
      void refreshStrength()
    }
  }, [activeTab, readOnly, refreshStrength])

  // Show toast when profile strength improves
  useEffect(() => {
    if (readOnly || strengthLoading) return
    if (prevPercentageRef.current !== null && percentage > prevPercentageRef.current) {
      const increase = percentage - prevPercentageRef.current
      if (percentage >= 100) {
        addToast("Your profile is now complete! You're fully visible to clubs.", 'success')
      } else {
        addToast(`Profile strength +${increase}%. Keep going!`, 'success')
      }
    }
    prevPercentageRef.current = percentage
  }, [percentage, readOnly, strengthLoading, addToast])

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
    if (ids.length > 0) {
      setHighlightedComments((prev) => {
        const next = new Set(prev)
        ids.forEach((id) => next.add(id))
        return next
      })
    }

    void clearCommentNotifications()
  }, [activeTab, claimCommentHighlights, clearCommentNotifications, commentHighlightVersion, highlightedComments, readOnly])

  if (!profile) return <DashboardSkeleton />

  const publicContact = derivePublicContactEmail(profile)
  const savedContactEmail = profile.contact_email?.trim() || ''

  const handleCreateVacancyClick = () => {
    handleTabChange('vacancies')
    setTriggerCreateVacancy(true)
  }

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

  // Opportunities tab is recruiter-mode only. Gated on the *visited* coach's
  // `coach_recruits_for_team` flag — for the owner this means the tab only
  // appears once they've opted into recruiter mode; for visitors it means
  // they only see it on coaches who actually recruit. Without this gate, the
  // flag was cosmetic only — any coach could navigate to ?tab=vacancies and
  // create an opportunity from the empty-state CTA.
  const showOpportunitiesTab = profile?.coach_recruits_for_team ?? false
  const tabs: { id: TabType; label: string }[] = [
    { id: 'profile', label: 'Profile' },
    ...(showOpportunitiesTab ? [{ id: 'vacancies' as TabType, label: 'Opportunities' }] : []),
    { id: 'journey', label: 'Journey' },
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
          <div className="flex flex-col md:flex-row gap-6">
            {/* Avatar */}
            <div className="flex-shrink-0">
              <Avatar
                src={profile.avatar_url}
                alt={profile.full_name ?? undefined}
                initials={getInitials(profile.full_name)}
                size="xl"
                enablePreview
                previewTitle={profile.full_name ?? undefined}
                role="coach"
              />
            </div>

            {/* Info */}
            <div className="flex-1">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4">
                <div>
                  <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-2 flex items-center gap-2">
                    <span>{profile.full_name}</span>
                    <VerifiedBadge
                      verified={(profile as unknown as { is_verified?: boolean; verified_at?: string | null } | null)?.is_verified}
                      verifiedAt={(profile as unknown as { is_verified?: boolean; verified_at?: string | null } | null)?.verified_at ?? null}
                    />
                  </h1>
                  <div className="mb-3 flex flex-wrap items-center gap-3">
                    <RoleBadge role="coach" />
                    {!readOnly && !strengthLoading && (
                      <TierBadge tier={calculateTier(percentage)} />
                    )}
                    {/* Phase 4 References UX Plan #1.5 — TrustBadge in coach
                        header. Same click semantics as PlayerDashboard. */}
                    <TrustBadge
                      count={(profile as Partial<Profile>).accepted_reference_count ?? 0}
                      isOwner={!readOnly}
                      onClick={() => {
                        trackReferenceBadgeClick('coach', (profile as Partial<Profile>).accepted_reference_count ?? 0)
                        if (!readOnly) {
                          setActiveTab('friends')
                          const next = new URLSearchParams(searchParams)
                          next.set('tab', 'friends')
                          next.set('section', 'references')
                          setSearchParams(next, { replace: false })
                        } else {
                          document.getElementById('public-references')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                        }
                      }}
                    />
                    {(profile as Partial<Profile>).coach_specialization && (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-teal-50 text-teal-700">
                        {getSpecializationLabel(
                          (profile as Partial<Profile>).coach_specialization,
                          (profile as Partial<Profile>).coach_specialization_custom
                        )}
                      </span>
                    )}
                    {profile.open_to_coach && <AvailabilityPill variant="coach" />}
                    <SocialLinksDisplay
                      links={profile.social_links as SocialLinks | null | undefined}
                      iconSize="sm"
                    />
                  </div>
                </div>

                {/* Action Buttons */}
                {!readOnly ? (
                  <div className="flex items-center gap-2">
                    <ShareProfileButton profile={{ role: 'coach', username: profile.username, id: profile.id }} />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate(`/members/id/${profile.id}`)}
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
                    <DashboardMenu />
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <FriendshipButton profileId={profile.id} />
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
                    {isOwnProfile && (
                      <ShareProfileButton profile={{ role: 'coach', username: profile.username, id: profile.id }} />
                    )}
                    {!isOwnProfile && <ProfileActionMenu targetId={profile.id} targetName={profile.full_name ?? 'this user'} />}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-4 text-gray-600 mb-4">
                <div className="flex items-center gap-2">
                  <DualNationalityDisplay
                    primaryCountryId={profile.nationality_country_id}
                    secondaryCountryId={profile.nationality2_country_id}
                    fallbackText={profile.nationality}
                    mode="compact"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <MapPin className="w-5 h-5" />
                  <span>{profile.base_location}</span>
                </div>
                {age && (
                  <div className="flex items-center gap-2">
                    <Calendar className="w-5 h-5" />
                    <span>{age} years old</span>
                  </div>
                )}
                {/* Coaching categories (if any). Phase 3 — neutral chip,
                    no per-gender color coding. */}
                {profile.coaching_categories && profile.coaching_categories.length > 0 && (
                  <div className="flex items-center gap-2 text-gray-700">
                    <span>{categoriesToDisplay(profile.coaching_categories)}</span>
                  </div>
                )}
                {/* Current Club (if specified) */}
                {profile.current_club && (
                  <div className="flex items-center gap-2">
                    {currentClubLogo ? (
                      <img
                        src={currentClubLogo}
                        alt=""
                        className="w-5 h-5 rounded-full object-cover flex-shrink-0"
                      />
                    ) : (
                      <Landmark className="w-5 h-5" />
                    )}
                    <span>{profile.current_club}</span>
                  </div>
                )}
                {/* Public contact email - visible when enabled */}
                {publicContact.shouldShow && publicContact.displayEmail && (
                  <a
                    href={`mailto:${publicContact.displayEmail}`}
                    className="flex items-center gap-2 hover:text-[#8026FA] transition-colors"
                  >
                    <Mail className="w-5 h-5" />
                    <span>{publicContact.displayEmail}</span>
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Owner-side hierarchy (matches v5-plan dashboard guideline):
              1. Pulse — "Since you last visited"
              2. NextStepCard — single gamified primary action
              3. ProfileSnapshot — positive evidence (chips, present-only)
              4. FreshnessCard
              5. RecentlyConnectedCard — gated on next step NOT being a references ask
              6. SearchAppearancesCard
            Visitor mode: just the public Snapshot (chips). */}
        {!readOnly ? (
          <>
            <PulseSection />
            <NextStepCard
              percentage={percentage}
              buckets={buckets}
              loading={strengthLoading}
              onBucketAction={handleStrengthBucketAction}
            />
            <div className="mt-3">
              <ProfileSnapshot
                profile={profile as Profile | null}
                mode="owner"
                onSignalAction={handleSnapshotAction}
              />
            </div>
            <div className="mt-3">
              <FreshnessCard nudge={freshnessNudge} onAction={handleFreshnessAction} />
            </div>
            {nudgeOwnerId && (() => {
              const nextStepBucket = buckets.find((b) => !b.completed)
              const nextStepIsReferences =
                nextStepBucket?.id === 'references' || nextStepBucket?.id === 'friends'
              if (nextStepIsReferences) return null
              return (
                <div className="mt-3">
                  <RecentlyConnectedCard
                    friendOptions={nudgeFriendOptions}
                    ownerProfileId={nudgeOwnerId}
                    excludeIds={nudgeExcludeIds}
                    acceptedReferenceCount={nudgeAcceptedFloor}
                    profileRole={profile.role}
                    onAsk={(friendId) => {
                      setActiveTab('friends')
                      const next = new URLSearchParams(searchParams)
                      next.set('tab', 'friends')
                      next.set('section', 'references')
                      next.set('ask', friendId)
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
          <div className="mb-3">
            <ProfileSnapshot
              profile={profile as Profile | null}
              mode="public"
            />
          </div>
        )}

        {/* Tabs */}
        <div className="bg-white rounded-2xl shadow-sm animate-slide-in-up">
          <div className="border-b border-gray-200 overflow-x-auto">
            <ScrollableTabs
              tabs={tabs}
              activeTab={activeTab}
              onTabChange={handleTabChange}
              className="gap-8 px-6"
              activeClassName="border-[#8026FA] text-[#8026FA]"
              inactiveClassName="border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            />
          </div>

          <div className="p-6 md:p-8">
            {/* Profile Tab */}
            {activeTab === 'profile' && (
              <div className="space-y-6 animate-fade-in">
                {!readOnly && <ProfileViewersSection />}
                {!readOnly && (
                  <AvailabilityToggleStrip role="coach" />
                )}
                {!readOnly && <ClubLinkPrompt />}

                {/* Phase 1A.4 (v5 plan): coach dual-mode Quick Actions split.
                    Card A (always shown): build the candidate-side profile.
                    Card B (only when coach_recruits_for_team=true): post a
                    vacancy to recruit. Both render side-by-side on wide
                    screens, stacked on mobile. The split keeps the
                    candidate-side coach unaware of recruiter affordances by
                    default (opt-in via onboarding step 3 or Settings). */}
                {!readOnly && (
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="bg-gradient-to-br from-[#8026FA] to-[#924CEC] rounded-xl p-6 text-white">
                      <h3 className="text-lg font-semibold mb-2">Build your coaching profile</h3>
                      <p className="text-purple-100 mb-4 text-sm">A complete profile gets you found and contacted by clubs.</p>
                      <button
                        type="button"
                        onClick={() => setShowEditModal(true)}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-white text-[#8026FA] rounded-lg hover:bg-gray-50 transition-colors font-medium text-sm"
                      >
                        <Edit2 className="w-4 h-4" />
                        Edit profile
                      </button>
                    </div>
                    {(profile?.coach_recruits_for_team ?? false) && (
                      <div className="bg-gradient-to-br from-emerald-600 to-emerald-700 rounded-xl p-6 text-white">
                        <h3 className="text-lg font-semibold mb-2">Recruit players for your team</h3>
                        <p className="text-emerald-100 mb-4 text-sm">Post an opportunity and review applicants with full context.</p>
                        <button
                          type="button"
                          onClick={handleCreateVacancyClick}
                          className="inline-flex items-center gap-2 px-4 py-2 bg-white text-emerald-700 rounded-lg hover:bg-gray-50 transition-colors font-medium text-sm"
                        >
                          <Plus className="w-4 h-4" />
                          Post an opportunity
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Basic Information - Only shown in private view (not readOnly) to avoid duplication with header card */}
                {!readOnly && (
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Basic Information</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Full Name
                      </label>
                      <p className="text-gray-900 font-medium">{profile.full_name}</p>
                    </div>

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

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Base Location (City)
                      </label>
                      <p className="text-gray-900">{profile.base_location}</p>
                    </div>

                    {profile.coaching_categories && profile.coaching_categories.length > 0 && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Coaching Categories
                        </label>
                        <p className="text-gray-900">{categoriesToDisplay(profile.coaching_categories)}</p>
                      </div>
                    )}

                    {profile.date_of_birth && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Date of Birth
                        </label>
                        <p className="text-gray-900">
                          {formatDateOfBirth(profile.date_of_birth)}
                          {age && <span className="text-gray-500 ml-2">({age} years old)</span>}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
                )}

                {/* Contact Information - Only shown in private view */}
                {!readOnly && (
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Contact</h3>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Contact Email</label>
                      {publicContact.shouldShow && publicContact.displayEmail ? (
                        <a href={`mailto:${publicContact.displayEmail}`} className="text-[#8026FA] hover:underline">
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
                </div>
                )}

                {readOnly && (
                  // Phase 4 References UX Plan #1.6 — TrustBadge scroll
                  // target. id + scroll-mt live on the section's own root
                  // so when PublicReferencesSection returns null (zero
                  // references), no empty wrapper is left behind to
                  // inflate the surrounding space-y gap.
                  <PublicReferencesSection profileId={profile.id} profileName={profile.full_name} />
                )}

                <section className="space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <h3 className="text-2xl font-bold text-gray-900">About</h3>
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
                          <p>Use the edit option to share your coaching background, philosophy, and achievements.</p>
                        )}
                      </div>
                    )}
                  </div>
                </section>

                <section data-section="media" className="space-y-3 pt-6 border-t border-gray-200">
                  <MediaTab
                    profileId={profile.id}
                    readOnly={readOnly}
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

                {/* Posts — shown inline on public profile below media */}
                {readOnly && (
                  <section className="space-y-3 pt-6 border-t border-gray-200">
                    <h2 className="text-2xl font-bold text-gray-900">Posts</h2>
                    <ProfilePostsTab profileId={profile.id} readOnly />
                  </section>
                )}
              </div>
            )}

            {activeTab === 'vacancies' && showOpportunitiesTab && (
              <div className="animate-fade-in">
                <OpportunitiesTab
                  profileId={profile.id}
                  readOnly={readOnly}
                  triggerCreate={triggerCreateVacancy}
                  onCreateTriggered={() => setTriggerCreateVacancy(false)}
                />
              </div>
            )}

            {/* Journey Tab */}
            {activeTab === 'journey' && (
              <div className="animate-fade-in">
                <JourneyTab profileId={profile.id} readOnly={readOnly} />
              </div>
            )}

            {activeTab === 'friends' && (
              <div className="animate-fade-in">
                <FriendsTab profileId={profile.id} readOnly={readOnly} profileRole={profile.role} />
              </div>
            )}

            {activeTab === 'comments' && (
              <div className="animate-fade-in">
                <CommentsTab profileId={profile.id} highlightedCommentIds={highlightedComments} profileRole={profile.role} />
              </div>
            )}

            {activeTab === 'posts' && (
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
        role={profile.role as 'coach'}
      />

      {/* Sign In Prompt Modal */}
      <SignInPromptModal
        isOpen={showSignInPrompt}
        onClose={() => setShowSignInPrompt(false)}
        title="Sign in to message"
        message="Sign in to message this coach and see more about their profile."
      />
    </div>
  )
}
