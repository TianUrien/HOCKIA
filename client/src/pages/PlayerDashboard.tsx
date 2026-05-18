import { useEffect, useMemo, useState, useRef } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'
import {
  EditProfileModal,
  FriendsTab,
  ReferencesTab,
  PublicReferencesSection,
  PublicViewBanner,
  ScrollableTabs,
  CategoryConfirmationBanner,
} from '@/components'
import Header from '@/components/Header'
import JourneyTab from '@/components/JourneyTab'
import MediaTab from '@/components/MediaTab'
import CommentsTab from '@/components/CommentsTab'
import AddVideoLinkModal from '@/components/AddVideoLinkModal'
import ProfilePostsTab from '@/components/ProfilePostsTab'
import SignInPromptModal from '@/components/SignInPromptModal'
import HeroIdentityCard from '@/components/dashboard/bento/HeroIdentityCard'
import PlayerBentoGrid from '@/components/dashboard/bento/PlayerBentoGrid'
import { ProfileViewersSection } from '@/components/ProfileViewersSection'
import type { Profile } from '@/lib/supabase'
import { supabase } from '@/lib/supabase'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useToastStore } from '@/lib/toast'
import { useNotificationStore } from '@/lib/notifications'
import { useProfileStrength, type ProfileStrengthBucket } from '@/hooks/useProfileStrength'
import { trackReferenceBadgeClick } from '@/lib/analytics'
import { useWorldClubLogo } from '@/hooks/useWorldClubLogo'
import { useTabDeepLinkScroll } from '@/hooks/useTabDeepLinkScroll'

// `?section=` query param → DOM anchor id. Used by the deep-link scroll
// hook so notifications like ?tab=profile&section=viewers land on the
// right card instead of the top of the page.
const PLAYER_SECTION_ANCHORS = { viewers: 'profile-viewers' } as const

type TabType = 'profile' | 'media' | 'journey' | 'references' | 'friends' | 'comments' | 'posts'

// Centralised whitelist so URL parsing + push handlers stay in sync.
// 'media' is new in the Bento redesign — MediaCard CTAs land here so the
// existing MediaTab + FullGameVideosSection surface keeps working
// without re-implementing CRUD inside a card.
const VALID_TABS: TabType[] = ['profile', 'media', 'journey', 'references', 'friends', 'comments', 'posts']

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
    return tabParam && (VALID_TABS as string[]).includes(tabParam) ? tabParam : 'profile'
  })
  const [showEditModal, setShowEditModal] = useState(false)
  const [showAddVideoModal, setShowAddVideoModal] = useState(false)
  const [showSignInPrompt, setShowSignInPrompt] = useState(false)
  const [sendingMessage, setSendingMessage] = useState(false)
  const claimCommentHighlights = useNotificationStore((state) => state.claimCommentHighlights)

  // Profile strength for player profiles (only for own profile)
  const profileStrength = useProfileStrength(!readOnly ? (profile as Profile) : null)
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
    if (tabParam !== activeTab && (VALID_TABS as string[]).includes(tabParam)) {
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

  const handleTabChange = useMemo(
    () => (tab: TabType) => {
      const wasSameTab = activeTab === tab
      setActiveTab(tab)
      const next = new URLSearchParams(searchParams)
      next.set('tab', tab)
      setSearchParams(next, { replace: true })

      // useTabDeepLinkScroll fires when tabParam changes — but a click on
      // the currently-active tab leaves params unchanged, so it skips the
      // scroll. Users tapping their already-selected tab from a scrolled
      // position rightfully expect the strip to scroll back to top, same
      // as a tab change. Replay the scroll directly for that case. Fire
      // both rAF and a setTimeout so it survives async tab content that
      // shifts layout late (mirrors useTabDeepLinkScroll's pattern).
      if (wasSameTab && tab !== 'profile') {
        const performTabStripScroll = () => {
          const el = document.getElementById('profile-tab-content')
          if (el && typeof el.scrollIntoView === 'function') {
            try { el.scrollIntoView({ behavior: 'smooth', block: 'start' }) } catch { /* noop */ }
          }
        }
        window.requestAnimationFrame(performTabStripScroll)
        window.setTimeout(performTabStripScroll, 400)
      }
    },
    [activeTab, searchParams, setSearchParams],
  )

  // Scroll-and-flash request from a bucket action. The actual scroll
  // runs inside a useEffect below so React's commit phase has finished
  // before we look up the DOM node — rAF inside the click handler was
  // racing the route-change re-render on some viewports and silently
  // missing the element. Nonce forces the effect to re-fire on every
  // click even when the target id is unchanged.
  const [pendingScrollFlash, setPendingScrollFlash] = useState<{ testid: string; nonce: number } | null>(null)

  useEffect(() => {
    if (!pendingScrollFlash) return
    let cancelled = false

    // Two-phase: immediate rAF (typical case), then a 250ms retry to
    // cover viewports where the OpportunitiesCard mounts asynchronously
    // (the AvailabilityToggleStrip fetches its own state on mount).
    const performScroll = () => {
      if (cancelled) return
      const el = document.querySelector<HTMLElement>(
        `[data-testid="${pendingScrollFlash.testid}"]`,
      )
      if (!el) return
      try {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      } catch {
        // Browsers without smooth-scroll support — fall through silently.
      }
      if (!el.classList.contains('flash-highlight')) {
        el.classList.add('flash-highlight')
        window.setTimeout(() => el.classList.remove('flash-highlight'), 1600)
      }
    }

    const rafId = window.requestAnimationFrame(performScroll)
    const settleTimeoutId = window.setTimeout(performScroll, 250)

    return () => {
      cancelled = true
      window.cancelAnimationFrame(rafId)
      window.clearTimeout(settleTimeoutId)
    }
  }, [pendingScrollFlash])

  // Handler for profile strength bucket actions. Fires when the user
  // taps an action button inside the Hero's "Full checklist" accordion.
  const handleProfileStrengthAction = (bucket: ProfileStrengthBucket) => {
    switch (bucket.action.type) {
      case 'edit-profile':
        setShowEditModal(true)
        break
      case 'tab': {
        const targetTab = bucket.action.tab as TabType
        handleTabChange(targetTab)
        // Availability lands the user on the Bento Grid (same view they
        // came from). Schedule a scroll-and-flash on the
        // OpportunitiesCard so the click doesn't feel like a no-op.
        if (bucket.id === 'availability') {
          setPendingScrollFlash({ testid: 'opportunities-card', nonce: Date.now() })
        }
        break
      }
      case 'add-video':
        if (activeTab !== 'profile') {
          handleTabChange('profile')
        }
        setShowAddVideoModal(true)
        break
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

  const handleViewPublic = () => {
    const base = profile.role === 'coach' ? '/coaches' : '/players'
    const slug = profile.username ? profile.username : `id/${profile.id}`
    navigate(`${base}/${slug}`)
  }

  const handleReferencesClick = () => {
    trackReferenceBadgeClick('player', profile.accepted_reference_count ?? 0)
    handleTabChange('references')
  }

  const handleFriendsClick = () => handleTabChange('friends')

  const handleViewOpportunities = () => navigate('/opportunities')

  const tabs: { id: TabType; label: string }[] = [
    { id: 'profile', label: 'Profile' },
    { id: 'media', label: 'Media' },
    { id: 'journey', label: 'Journey' },
    { id: 'references', label: 'References' },
    { id: 'friends', label: 'Friends' },
    { id: 'comments', label: 'Comments' },
    { id: 'posts', label: 'Posts' },
  ]

  // The Profile tab IS the new Bento Grid landing page. Other tabs keep
  // their existing UIs as deep-link destinations from card CTAs. PR2 will
  // promote each tab to its own route and delete the tab strip.
  const isLanding = activeTab === 'profile'

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />

      {/* Public View Banner - shown when user views their own profile in public mode */}
      {readOnly && isOwnProfile && <PublicViewBanner />}

      <main className="max-w-7xl mx-auto px-4 md:px-6 pt-24 pb-12 space-y-5 md:space-y-6">
        {readOnly && !isOwnProfile && (
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm font-medium">Back</span>
          </button>
        )}

        {/* Visitor on a non-Profile tab — quick back-to-profile shortcut
            since visitors don't have a tab strip to navigate with. */}
        {readOnly && !isLanding && (
          <button
            type="button"
            onClick={() => handleTabChange('profile')}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm font-medium">Back to profile</span>
          </button>
        )}

        {!readOnly && (
          <CategoryConfirmationBanner
            needsConfirmation={Boolean(profile.category_confirmation_needed)}
            onConfirm={() => setShowEditModal(true)}
          />
        )}

        {/* Hero — replaces the legacy Profile Header card. Always at the top so
            users know whose profile they're on regardless of which tab they're
            viewing. Owner sees completion arc + edit; visitor sees Message + Connect. */}
        <HeroIdentityCard
          profile={profile}
          readOnly={readOnly}
          isOwnProfile={isOwnProfile}
          authProfileRole={authProfile?.role}
          completionPercentage={profileStrength.percentage}
          completionLoading={profileStrength.loading}
          completionBuckets={!readOnly ? profileStrength.buckets : undefined}
          onBucketAction={handleProfileStrengthAction}
          currentClubLogo={currentClubLogo}
          onEdit={() => setShowEditModal(true)}
          onViewPublic={handleViewPublic}
          onMessage={handleSendMessage}
          sendingMessage={sendingMessage}
          onFriendsClick={handleFriendsClick}
          onReferencesClick={handleReferencesClick}
        />

        {/* "Who viewed your profile" — owner-only engagement nudge that
            sits between the Hero and the Bento Grid. Same placement
            pattern as Coach/Club/Brand dashboards. The `profile-viewers`
            anchor + scroll-mt are required for the existing notification
            deep-link `?tab=profile&section=viewers` to land correctly
            (wired via useTabDeepLinkScroll + PLAYER_SECTION_ANCHORS). */}
        {!readOnly && isLanding && (
          <div id="profile-viewers" className="scroll-mt-20">
            <ProfileViewersSection />
          </div>
        )}

        {isLanding ? (
          // Landing view — the Bento Grid. Each card lives in its own
          // white container; no outer card wrapper needed here.
          <PlayerBentoGrid
            profile={profile}
            readOnly={readOnly}
            onOpenTab={handleTabChange}
            onEdit={() => setShowEditModal(true)}
            onViewOpportunities={handleViewOpportunities}
          />
        ) : (
          // Tab views — existing UIs preserved verbatim. Owner gets the
          // ScrollableTabs strip; visitor navigates back via the Back-to-
          // profile button at the top of the page.
          <div id="profile-tab-content" className="bg-white rounded-2xl shadow-sm scroll-mt-4">
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

            <div className="p-6 md:p-8 min-h-screen">
              {activeTab === 'journey' && (
                <div className="animate-fade-in">
                  <JourneyTab
                    profileId={profile.id}
                    readOnly={readOnly}
                    {...(readOnly ? { variant: 'inline' as const, title: 'Journey' } : {})}
                  />
                </div>
              )}

              {activeTab === 'media' && (
                <div className="animate-fade-in">
                  <MediaTab
                    profileId={profile.id}
                    readOnly={readOnly}
                    showVideo={true}
                    showGallery={true}
                    viewerRole={viewerRole ?? authProfile?.role ?? null}
                    isOwnProfile={!readOnly || isOwnProfile}
                    highlightVisibility={(profile as Profile)?.highlight_visibility ?? 'public'}
                  />
                </div>
              )}

              {activeTab === 'friends' && (
                <div id="visitor-section-friends" className="animate-fade-in">
                  <FriendsTab profileId={profile.id} readOnly={readOnly} profileRole={profile.role} hideReferences />
                </div>
              )}

              {activeTab === 'comments' && (
                <div id="visitor-section-comments" className="animate-fade-in">
                  <CommentsTab profileId={profile.id} highlightedCommentIds={highlightedComments} profileRole={profile.role} />
                </div>
              )}

              {activeTab === 'references' && !readOnly && (
                <div className="animate-fade-in">
                  <ReferencesTab profileId={profile.id} readOnly={readOnly} profileRole={profile.role} />
                </div>
              )}

              {activeTab === 'references' && readOnly && (
                <div className="animate-fade-in">
                  <PublicReferencesSection profileId={profile.id} profileName={profile.full_name ?? profile.username ?? null} />
                </div>
              )}

              {activeTab === 'posts' && (
                <div className="animate-fade-in">
                  <ProfilePostsTab profileId={profile.id} readOnly={readOnly} />
                </div>
              )}
            </div>
          </div>
        )}
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
