import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'
import {
  EditProfileModal,
  FriendsTab,
  ReferencesTab,
  PublicReferencesSection,
  PublicViewBanner,
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
import RecruitmentVisibilityWidget from '@/components/dashboard/bento/RecruitmentVisibilityWidget'
import RecruitmentPrefsNudge from '@/components/dashboard/RecruitmentPrefsNudge'
import PlayerBentoGrid from '@/components/dashboard/bento/PlayerBentoGrid'
import ScoutingCard from '@/components/profile/ScoutingCard'
import PlayerCommunityHub from '@/components/community/PlayerCommunityHub'
import PublicCommunityView from '@/components/community/PublicCommunityView'
import { ProfileViewersSection } from '@/components/ProfileViewersSection'
import type { Profile } from '@/lib/supabase'
import { supabase } from '@/lib/supabase'
import { useNavigate, useParams, useSearchParams, useLocation } from 'react-router-dom'
import { useToastStore } from '@/lib/toast'
import { useNotificationStore } from '@/lib/notifications'
import { useProfileStrength, type ProfileStrengthBucket } from '@/hooks/useProfileStrength'
import { trackReferenceBadgeClick } from '@/lib/analytics'
import { useWorldClubLogo } from '@/hooks/useWorldClubLogo'
import { useTabDeepLinkScroll } from '@/hooks/useTabDeepLinkScroll'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'

// `?section=` query param → DOM anchor id. Used by the deep-link scroll
// hook so notifications like ?tab=profile&section=viewers land on the
// right card instead of the top of the page.
//
// The May 2026 Community redesign added `connections` and `references` so
// the Hero pills (Connections / References under the player's name) can
// route to the unified /community hub and scroll to the relevant area
// instead of bouncing the user to the old focused tabs.
const PLAYER_SECTION_ANCHORS = {
  viewers: 'profile-viewers',
  connections: 'community-connections',
  references: 'community-references',
  comments: 'community-comments',
  posts: 'community-posts',
} as const

type TabType = 'profile' | 'media' | 'journey' | 'references' | 'friends' | 'comments' | 'posts' | 'community'

// Centralised whitelist so URL parsing + push handlers stay in sync.
// 'media' is new in the Bento redesign — MediaCard CTAs land here so the
// existing MediaTab + FullGameVideosSection surface keeps working
// without re-implementing CRUD inside a card.
// 'community' renders the full social bundle (Friends + References +
// Comments + Posts stacked vertically). It's the "Go to community" CTA
// target from the CommunityCard — individual tile clicks still deep-link
// to the dedicated section pages.
const VALID_TABS: TabType[] = ['profile', 'media', 'journey', 'references', 'friends', 'comments', 'posts', 'community']

// Legacy ?tab=X aliases — mirror of CoachDashboard's map. CASI production
// QA flagged ?tab=connections silently routing to overview because
// 'connections' is a sub-section inside the community tab (see
// navigateToCommunitySection below), not a top-level dashboard tab. Map
// it to 'community' so notification + bookmark deep links land correctly.
const LEGACY_TAB_ALIASES: Record<string, TabType> = {
  connections: 'community',
}

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
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const { addToast } = useToastStore()

  /** Visitor-view back button. When the user reached this profile via
   *  an in-app navigation, navigate(-1) is correct. When they arrived
   *  via a shared/deep link in a fresh tab, the browser history is
   *  empty — navigate(-1) would exit the app (back to chrome://newtab
   *  on Chrome, dropping them out of HOCKIA entirely). React-Router
   *  marks the initial entry with location.key === 'default'; on that
   *  case we route to /community as a sensible app-internal fallback.
   *  (Visitor view only — owner's back button is unused; this only
   *  fires when readOnly && !isOwnProfile.) */
  const handleBack = () => {
    if (location.key === 'default') {
      navigate('/community')
    } else {
      navigate(-1)
    }
  }

  // PR2 — section comes from the URL route segment, not a ?tab= param.
  // - Owner: /dashboard/profile/:section  (DashboardRouter dispatches here)
  // - Visitor: /players/:username/:section, /players/id/:id/:section,
  //   /members/:username/:section, /members/id/:id/:section
  // The bare /dashboard/profile or /players/:username (no /:section) is
  // the Bento Grid landing — activeTab falls through to 'profile'. The
  // legacy ?tab=X URL shape from notifications/config.ts is migrated on
  // mount by the redirect effect below.
  const routeParams = useParams<{ section?: string; username?: string; id?: string }>()
  const sectionFromRoute = routeParams.section as TabType | undefined
  const sectionIsValid = sectionFromRoute
    ? (VALID_TABS as string[]).includes(sectionFromRoute)
    : true
  const activeTab: TabType =
    sectionFromRoute && (VALID_TABS as string[]).includes(sectionFromRoute)
      ? sectionFromRoute
      : 'profile'

  // Document title reflects the dashboard sub-route so tab strips +
  // browser history make sense at a glance. For visitor (readOnly)
  // views, prefix with the viewed player's name so the tab is
  // identifiable in history. 'community' on the owner side maps to
  // "My Network" to disambiguate from the global /community route.
  const visitedName = readOnly ? profile?.full_name : null
  const ownerTabTitle: Record<TabType, string> = {
    profile: 'Player dashboard',
    media: 'Media',
    journey: 'Journey',
    references: 'References',
    friends: 'Connections',
    comments: 'Comments',
    posts: 'Posts',
    community: 'My Network',
  }
  const visitorTabSuffix: Record<TabType, string | null> = {
    profile: null,
    media: 'Media',
    journey: 'Journey',
    references: 'References',
    friends: 'Connections',
    comments: 'Comments',
    posts: 'Posts',
    community: 'Community',
  }
  const computedTitle = visitedName
    ? visitorTabSuffix[activeTab]
      ? `${visitedName} — ${visitorTabSuffix[activeTab]}`
      : visitedName
    : ownerTabTitle[activeTab]
  useDocumentTitle(computedTitle)

  // /dashboard/profile/<unknown> used to silently render the Bento Grid,
  // which meant typos and stale notification links landed on the wrong
  // surface with no signal. Redirect unknown segments back to the
  // dashboard landing so the URL state and rendered content agree.
  useEffect(() => {
    if (sectionFromRoute && !sectionIsValid) {
      if (readOnly) {
        const base = routeParams.username
          ? `/players/${routeParams.username}`
          : routeParams.id
            ? `/players/id/${routeParams.id}`
            : null
        if (base) navigate(base, { replace: true })
      } else {
        navigate('/dashboard/profile', { replace: true })
      }
    }
  }, [sectionFromRoute, sectionIsValid, readOnly, routeParams.username, routeParams.id, navigate])
  const [showEditModal, setShowEditModal] = useState(false)
  const [showAddVideoModal, setShowAddVideoModal] = useState(false)
  const [showSignInPrompt, setShowSignInPrompt] = useState(false)
  const [sendingMessage, setSendingMessage] = useState(false)
  const claimCommentHighlights = useNotificationStore((state) => state.claimCommentHighlights)

  // Profile strength refresh is still wired so other consumers
  // (ProfileCompletionCard on the home feed, ProfileHealthCard) stay
  // current after the user edits their profile from this page. The
  // dashboard itself no longer renders a percentage — recruitment
  // signals live in RecruitmentVisibilityWidget below the Hero.
  const profileStrength = useProfileStrength(!readOnly ? (profile as Profile) : null)
  const clearCommentNotifications = useNotificationStore((state) => state.clearCommentNotifications)
  const commentHighlightVersion = useNotificationStore((state) => state.commentHighlightVersion)
  const [highlightedComments, setHighlightedComments] = useState<Set<string>>(new Set())
  const currentWorldClubId = (profile as Partial<Profile> | null)?.current_world_club_id ?? null
  const currentClubLogo = useWorldClubLogo(currentWorldClubId)

  const sectionParam = searchParams.get('section')

  // Legacy ?tab=X migration. Notifications/config.ts still emits the old
  // URL shape (`/dashboard/profile?tab=journey&section=incoming`); rather
  // than touch the 30+ notification templates, this effect rewrites those
  // URLs to the new route format (`/dashboard/profile/journey?section=incoming`)
  // on mount. ?section= and ?ask= and every other param survive.
  useEffect(() => {
    const rawTab = searchParams.get('tab')
    if (!rawTab) return
    // Apply legacy alias first (e.g. connections → community), then check
    // VALID_TABS so an unknown alias no longer silently falls through to
    // the default Overview tab — it lands on the mapped target instead.
    const resolved = (LEGACY_TAB_ALIASES[rawTab] ?? rawTab) as TabType
    if (!(VALID_TABS as string[]).includes(resolved)) return

    const next = new URLSearchParams(searchParams)
    next.delete('tab')
    // Legacy ?section=requests was renamed to ?section=incoming on
    // 2026-05-09 (see FriendsTab section anchor handler — it only
    // recognises 'incoming' and 'references' now). Emails and push
    // payloads were migrated in commit 4893b58 but old bookmarks /
    // in-app links / stale notifications still emit the old value.
    // Translate it here so old URLs land on the same scroll anchor
    // as the new ones. QA audit 2026-05-25 caught the divergence.
    if (next.get('section') === 'requests') {
      next.set('section', 'incoming')
    }
    const qs = next.toString()
    const qsSuffix = qs ? `?${qs}` : ''

    let path: string
    if (readOnly) {
      const base = routeParams.username
        ? `/players/${routeParams.username}`
        : routeParams.id
          ? `/players/id/${routeParams.id}`
          : null
      if (!base) return
      path = resolved === 'profile' ? base : `${base}/${resolved}`
    } else {
      path = resolved === 'profile' ? '/dashboard/profile' : `/dashboard/profile/${resolved}`
    }

    navigate(`${path}${qsSuffix}`, { replace: true })
  }, [searchParams, routeParams.username, routeParams.id, readOnly, navigate])

  // Section + sub-section deep-link scroll. Notifications and shareable
  // URLs (e.g. /dashboard/profile?section=viewers, /dashboard/profile/journey)
  // used to land at the top of the page; the hook anchors them. With PR2
  // the section URL segment plays the role the `?tab=` param used to.
  useTabDeepLinkScroll({
    activeTab,
    tabParam: sectionFromRoute ?? null,
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

  const handleTabChange = useMemo(
    () => (tab: TabType) => {
      const wasSameTab = activeTab === tab

      // Preserve query params that callers depend on (?ask=<friendId>,
      // ?section=incoming, etc.). Never re-emit ?tab=X — that's now the
      // route segment.
      const preserved = new URLSearchParams(searchParams)
      preserved.delete('tab')
      const qs = preserved.toString()
      const qsSuffix = qs ? `?${qs}` : ''

      let path: string
      if (readOnly) {
        const base = routeParams.username
          ? `/players/${routeParams.username}`
          : routeParams.id
            ? `/players/id/${routeParams.id}`
            : null
        if (!base) {
          // Shouldn't happen — visitor routes always carry username or id.
          return
        }
        path = tab === 'profile' ? base : `${base}/${tab}`
      } else {
        path = tab === 'profile' ? '/dashboard/profile' : `/dashboard/profile/${tab}`
      }

      navigate(`${path}${qsSuffix}`, { replace: true })

      // useTabDeepLinkScroll fires on section/tab changes. Tapping the
      // section the user is already on leaves params unchanged, so the
      // hook skips the scroll. Replay it directly for that case — same
      // UX as before PR2's route promotion. Fire both rAF and a settle
      // timeout so it survives async tab content shifting layout late.
      if (wasSameTab && tab !== 'profile') {
        const performTabContentScroll = () => {
          const el = document.getElementById('profile-tab-content')
          if (el && typeof el.scrollIntoView === 'function') {
            try { el.scrollIntoView({ behavior: 'smooth', block: 'start' }) } catch { /* noop */ }
          }
        }
        window.requestAnimationFrame(performTabContentScroll)
        window.setTimeout(performTabContentScroll, 400)
      }
    },
    [activeTab, navigate, readOnly, routeParams.id, routeParams.username, searchParams],
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

      // returnTo state: MessagesPage's back button reads this so the
      // user lands back on this profile after closing the conversation,
      // instead of the inbox (UX bug: messaging shouldn't erase the
      // browsing context). Captures current path + search so any
      // ?ref=community etc. is preserved on return.
      const returnTo = location.pathname + location.search
      if (existingConv?.id) {
        navigate(`/messages?conversation=${existingConv.id}`, { state: { returnTo } })
      } else {
        navigate(`/messages?new=${profileData.id}`, { state: { returnTo } })
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

  // Hero pills route to the unified Community hub (May 2026 redesign).
  // We bypass handleTabChange because we want to add a `?section=` param
  // that the deep-link scroll hook reads to scroll to the right card.
  // handleTabChange preserves existing params but doesn't know how to add
  // a section param of its own.
  const navigateToCommunitySection = (section: 'connections' | 'references') => {
    if (readOnly) {
      const base = routeParams.username
        ? `/players/${routeParams.username}`
        : routeParams.id
          ? `/players/id/${routeParams.id}`
          : null
      if (!base) return
      navigate(`${base}/community?section=${section}`, { replace: true })
    } else {
      navigate(`/dashboard/profile/community?section=${section}`, { replace: true })
    }
  }

  const handleReferencesClick = () => {
    trackReferenceBadgeClick('player', profile.accepted_reference_count ?? 0)
    navigateToCommunitySection('references')
  }

  const handleFriendsClick = () => navigateToCommunitySection('connections')

  const handleViewOpportunities = () => navigate('/opportunities')

  // The Profile tab IS the Bento Grid landing page. Section pages keep
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
            onClick={() => handleBack()}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm font-medium">Back</span>
          </button>
        )}

        {/* On a section page — back-shortcut. The tab strip is gone in
            PR2, so this is now the primary way users navigate from a
            section back to the Bento Grid (browser back also works). */}
        {!isLanding && (
          <button
            type="button"
            onClick={() => handleTabChange('profile')}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm font-medium">
              {readOnly ? 'Back to profile' : 'Back to dashboard'}
            </span>
          </button>
        )}

        {!readOnly && (
          <CategoryConfirmationBanner
            needsConfirmation={Boolean(profile.category_confirmation_needed)}
            onConfirm={() => setShowEditModal(true)}
          />
        )}

        {/* Hero — identity surface. Owner sees edit; visitor sees
            Message + Connect. Recruitment-readiness signals live in
            RecruitmentVisibilityWidget below for owner + landing. */}
        <HeroIdentityCard
          profile={profile}
          readOnly={readOnly}
          isOwnProfile={isOwnProfile}
          authProfileRole={authProfile?.role}
          currentClubLogo={currentClubLogo}
          onEdit={() => setShowEditModal(true)}
          onViewPublic={handleViewPublic}
          onMessage={handleSendMessage}
          sendingMessage={sendingMessage}
          onFriendsClick={handleFriendsClick}
          onReferencesClick={handleReferencesClick}
        />

        {/* G.10 — private 5-item recruitment-readiness checklist.
            Owner-only on the landing view; replaces the legacy
            "Profile complete %" arc that used to sit in HeroIdentityCard. */}
        {!readOnly && isLanding && (
          <RecruitmentVisibilityWidget
            profile={profile as Profile}
            onAction={handleProfileStrengthAction}
          />
        )}

        {/* Matching Increment #2 — dismissible nudge to add recruitment
            preferences (Interested lens). Self-hides once set or dismissed. */}
        {!readOnly && isLanding && (
          <RecruitmentPrefsNudge profile={profile as Profile} onAdd={() => setShowEditModal(true)} />
        )}

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

        {/* ScoutingCard — visitor-only recruitment decision surface.
            Three zones: availability headline, career evidence (no
            duplication with the Hero), pinned actions. Replaces the
            earlier CareerSnapshot which duplicated most of the Hero. */}
        {readOnly && !isOwnProfile && isLanding && (
          <ScoutingCard
            profile={{
              id: profile.id,
              role: profile.role ?? null,
              full_name: profile.full_name ?? null,
              current_club: profile.current_club ?? null,
              current_world_club_id: profile.current_world_club_id ?? null,
              playing_category: (profile as Profile).playing_category ?? null,
              highlight_video_url: (profile as Profile).highlight_video_url ?? null,
              full_game_video_count: (profile as Profile).full_game_video_count ?? null,
              accepted_reference_count: (profile as Profile).accepted_reference_count ?? null,
              is_verified: (profile as Profile).is_verified ?? null,
              last_active_at: (profile as Profile).last_active_at ?? null,
              show_last_active: (profile as Profile).show_last_active ?? null,
              open_to_play: (profile as Profile).open_to_play ?? null,
              open_to_coach: (profile as Profile).open_to_coach ?? null,
              open_to_opportunities: (profile as Profile).open_to_opportunities ?? null,
            }}
            onViewJourney={() => handleTabChange('journey')}
          />
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
          // Section page — content surface with no tab strip. PR2 removed
          // the strip; users navigate via card CTAs from /dashboard/profile
          // and the "Back to dashboard / profile" shortcut above.
          <div id="profile-tab-content" className="bg-white rounded-2xl shadow-sm scroll-mt-4">
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

              {activeTab === 'community' && (
                // Redesigned Community page (May 2026) — owner sees the
                // PlayerCommunityHub (credibility stats card, references
                // section, segmented connections section, comments,
                // posts). Visitor sees the slimmer PublicCommunityView.
                // The dedicated section routes (/friends, /references,
                // /comments, /posts) still render the legacy focused
                // surfaces — this hub is the unified view.
                <div className="animate-fade-in">
                  {readOnly ? (
                    <PublicCommunityView
                      profile={profile as Pick<Profile, 'id' | 'role' | 'full_name' | 'username' | 'accepted_friend_count' | 'accepted_reference_count' | 'post_count'>}
                    />
                  ) : (
                    <PlayerCommunityHub
                      profile={profile as Pick<Profile, 'id' | 'role' | 'full_name' | 'username' | 'accepted_friend_count' | 'accepted_reference_count' | 'post_count'>}
                      highlightedCommentIds={highlightedComments}
                    />
                  )}
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
