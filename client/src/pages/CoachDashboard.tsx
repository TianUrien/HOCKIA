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
  CategoryConfirmationBanner,
} from '@/components'
import Header from '@/components/Header'
import JourneyTab from '@/components/JourneyTab'
import MediaTab from '@/components/MediaTab'
import CommentsTab from '@/components/CommentsTab'
import OpportunitiesTab from '@/components/OpportunitiesTab'
import ProfilePostsTab from '@/components/ProfilePostsTab'
import SignInPromptModal from '@/components/SignInPromptModal'
import ClubLinkPrompt from '@/components/ClubLinkPrompt'
import HeroIdentityCard from '@/components/dashboard/bento/HeroIdentityCard'
import CoachBentoGrid from '@/components/dashboard/bento/CoachBentoGrid'
import CoachCommunityHub from '@/components/community/CoachCommunityHub'
import PublicCommunityView from '@/components/community/PublicCommunityView'
import { ProfileViewersSection } from '@/components/ProfileViewersSection'
import type { Profile } from '@/lib/supabase'
import { supabase } from '@/lib/supabase'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useToastStore } from '@/lib/toast'
import { useNotificationStore } from '@/lib/notifications'
import { useCoachProfileStrength } from '@/hooks/useCoachProfileStrength'
import type { ProfileStrengthBucket } from '@/hooks/useProfileStrength'
import { trackReferenceBadgeClick } from '@/lib/analytics'
import { useWorldClubLogo } from '@/hooks/useWorldClubLogo'
import { useTabDeepLinkScroll } from '@/hooks/useTabDeepLinkScroll'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'

// `?section=` query param → DOM anchor id. Drives the deep-link scroll
// for notifications and shareable URLs. Mirrors PlayerDashboard so
// /coaches/:username?section=connections lands on the Connections
// section inside the Community hub.
const COACH_SECTION_ANCHORS = {
  viewers: 'profile-viewers',
  connections: 'community-connections',
  references: 'community-references',
  comments: 'community-comments',
  posts: 'community-posts',
} as const

type TabType =
  | 'profile'
  | 'media'
  | 'journey'
  | 'references'
  | 'friends'
  | 'comments'
  | 'posts'
  | 'community'
  | 'opportunities'

// Centralised whitelist so URL parsing + push handlers stay in sync.
// 'community' renders the CoachCommunityHub. 'opportunities' is recruiter-
// only and unlocks an OpportunitiesTab surface for posting/managing
// opportunities (Coach uses the same `coach_recruits_for_team` gate the
// Bento RecruitingCard uses).
const VALID_TABS: TabType[] = [
  'profile',
  'media',
  'journey',
  'references',
  'friends',
  'comments',
  'posts',
  'community',
  'opportunities',
]

// Legacy aliases — the 'vacancies' section id was renamed to
// 'opportunities' in PR #101 (?tab=vacancies → ?tab=opportunities).
// The redesigned dashboard uses route segments instead of query params,
// so this also covers `/dashboard/profile/vacancies` →
// `/dashboard/profile/opportunities`. Maps stale notification + bookmark
// URLs to the canonical section at parse time; the redirect effect
// below rewrites the URL bar so browser history shows the new slug.
const LEGACY_SECTION_ALIASES: Record<string, TabType> = {
  vacancies: 'opportunities',
  // CASI production QA: ?tab=connections silently routed to overview
  // because 'connections' is a sub-section inside the community tab
  // (see navigateToCommunitySection below), not a top-level dashboard
  // tab. Map the legacy ?tab=connections to 'community' so deep links
  // from notifications / bookmarks land on the right surface.
  connections: 'community',
}

const resolveLegacySection = (section: string | undefined): TabType | null =>
  section && LEGACY_SECTION_ALIASES[section] ? LEGACY_SECTION_ALIASES[section] : null

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
  /** When true and readOnly is true, shows a banner indicating user is
   *  viewing their own public profile */
  isOwnProfile?: boolean
}

export default function CoachDashboard({
  profileData,
  readOnly = false,
  isOwnProfile = false,
}: CoachDashboardProps) {
  const { profile: authProfile, user } = useAuthStore()
  const refreshAuthProfile = useAuthStore((s) => s.refreshProfile)
  const profile = (profileData ?? authProfile) as CoachProfileShape | null
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { addToast } = useToastStore()

  // Section comes from the URL route segment, not a ?tab= param. Same
  // pattern as PlayerDashboard's PR2 route promotion.
  //  - Owner:  /dashboard/profile/:section  (DashboardRouter dispatches)
  //  - Visitor: /coaches/:username/:section, /coaches/id/:id/:section
  const routeParams = useParams<{ section?: string; username?: string; id?: string }>()
  const sectionFromRoute = routeParams.section as TabType | undefined
  // Legacy 'vacancies' segment resolves to 'opportunities' silently so
  // old notification links / saved bookmarks still land on the right
  // surface while the URL-rewrite effect below fixes the address bar.
  const aliasedSection = resolveLegacySection(sectionFromRoute) ?? sectionFromRoute
  const sectionIsValid = aliasedSection
    ? (VALID_TABS as string[]).includes(aliasedSection)
    : true
  const activeTab: TabType =
    aliasedSection && (VALID_TABS as string[]).includes(aliasedSection)
      ? aliasedSection
      : 'profile'

  // Document title reflects the dashboard sub-route so tab strips +
  // browser history make sense at a glance. Labels mirror the UI
  // section names. For visitor (readOnly) views, prefix with the
  // viewed coach's name so the tab is identifiable in browser history
  // — otherwise every coach's profile would read "Coach dashboard".
  // 'community' on the owner side maps to "My Network" to disambiguate
  // from the global /community marketplace route.
  const visitedName = readOnly ? profile?.full_name : null
  const ownerTabTitle: Record<TabType, string> = {
    profile: 'Coach dashboard',
    media: 'Media',
    journey: 'Journey',
    references: 'References',
    friends: 'Connections',
    comments: 'Comments',
    posts: 'Posts',
    community: 'My Network',
    opportunities: 'Opportunities',
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
    opportunities: 'Opportunities',
  }
  const computedTitle = visitedName
    ? visitorTabSuffix[activeTab]
      ? `${visitedName} — ${visitorTabSuffix[activeTab]}`
      : visitedName
    : ownerTabTitle[activeTab]
  useDocumentTitle(computedTitle)

  // Legacy route-segment redirect — old links to
  // /dashboard/profile/vacancies (and the visitor equivalents) rewrite
  // to /opportunities so the URL bar reflects the new canonical slug.
  // Companion to LEGACY_SECTION_ALIASES, which already mapped the
  // section internally; this effect updates browser history.
  useEffect(() => {
    if (!sectionFromRoute) return
    const aliased = resolveLegacySection(sectionFromRoute)
    if (!aliased) return
    if (readOnly) {
      const base = routeParams.username
        ? `/coaches/${routeParams.username}`
        : routeParams.id
          ? `/coaches/id/${routeParams.id}`
          : null
      if (base) navigate(`${base}/${aliased}`, { replace: true })
    } else {
      navigate(`/dashboard/profile/${aliased}`, { replace: true })
    }
  }, [sectionFromRoute, readOnly, routeParams.username, routeParams.id, navigate])

  // /dashboard/profile/<unknown> redirects to /dashboard/profile so
  // typos and stale notification links don't silently render the
  // wrong surface. Mirrors PlayerDashboard.
  useEffect(() => {
    if (sectionFromRoute && !sectionIsValid) {
      if (readOnly) {
        const base = routeParams.username
          ? `/coaches/${routeParams.username}`
          : routeParams.id
            ? `/coaches/id/${routeParams.id}`
            : null
        if (base) navigate(base, { replace: true })
      } else {
        navigate('/dashboard/profile', { replace: true })
      }
    }
  }, [sectionFromRoute, sectionIsValid, readOnly, routeParams.username, routeParams.id, navigate])

  const [showEditModal, setShowEditModal] = useState(false)
  const [showSignInPrompt, setShowSignInPrompt] = useState(false)
  const [sendingMessage, setSendingMessage] = useState(false)
  const [triggerCreateVacancy, setTriggerCreateVacancy] = useState(false)
  const claimCommentHighlights = useNotificationStore((state) => state.claimCommentHighlights)
  const clearCommentNotifications = useNotificationStore((state) => state.clearCommentNotifications)
  const commentHighlightVersion = useNotificationStore((state) => state.commentHighlightVersion)
  const [highlightedComments, setHighlightedComments] = useState<Set<string>>(new Set())

  // Profile strength for coaches (only compute for own profile).
  const strength = useCoachProfileStrength({
    profile: readOnly ? null : (profileData ?? authProfile) as CoachProfileShape | null,
  })
  const prevPercentageRef = useRef<number | null>(null)

  const currentWorldClubId = (profile as Partial<Profile> | null)?.current_world_club_id ?? null
  const currentClubLogo = useWorldClubLogo(currentWorldClubId)

  const sectionParam = searchParams.get('section')

  // Legacy ?tab=X migration. Mirrors PlayerDashboard's effect — the
  // coach version of the same migration so old notification links
  // (/dashboard/profile?tab=journey) still land on the right section
  // without touching the notification templates.
  useEffect(() => {
    const rawTab = searchParams.get('tab')
    if (!rawTab) return
    // Apply legacy alias first (e.g. connections → community), then check
    // VALID_TABS so an unknown alias no longer silently falls through to
    // the default Overview tab — it lands on the mapped target instead.
    const resolved = (resolveLegacySection(rawTab) ?? rawTab) as TabType
    if (!(VALID_TABS as string[]).includes(resolved)) return

    const next = new URLSearchParams(searchParams)
    next.delete('tab')
    const qs = next.toString()
    const qsSuffix = qs ? `?${qs}` : ''

    let path: string
    if (readOnly) {
      const base = routeParams.username
        ? `/coaches/${routeParams.username}`
        : routeParams.id
          ? `/coaches/id/${routeParams.id}`
          : null
      if (!base) return
      path = resolved === 'profile' ? base : `${base}/${resolved}`
    } else {
      path = resolved === 'profile' ? '/dashboard/profile' : `/dashboard/profile/${resolved}`
    }

    navigate(`${path}${qsSuffix}`, { replace: true })
  }, [searchParams, routeParams.username, routeParams.id, readOnly, navigate])

  useTabDeepLinkScroll({
    activeTab,
    tabParam: sectionFromRoute ?? null,
    sectionParam,
    sectionAnchors: COACH_SECTION_ANCHORS,
  })

  // Refresh profile strength when switching tabs.
  useEffect(() => {
    if (!readOnly) {
      void strength.refresh()
    }
  }, [activeTab, readOnly]) // eslint-disable-line react-hooks/exhaustive-deps

  // Comment notifications — claim highlights when entering the
  // comments tab so the UI flashes the freshly-arrived comments.
  useEffect(() => {
    if (readOnly) return

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

  // Toast when profile strength increases.
  useEffect(() => {
    if (readOnly || strength.loading) return
    const currentPercentage = strength.percentage
    const prevPercentage = prevPercentageRef.current

    if (prevPercentage !== null && currentPercentage > prevPercentage) {
      const increase = currentPercentage - prevPercentage
      if (currentPercentage >= 100) {
        addToast('Your coach profile is now complete! Clubs can fully evaluate you.', 'success')
      } else {
        addToast(`Profile strength +${increase}%. Keep going!`, 'success')
      }
    }
    prevPercentageRef.current = currentPercentage
  }, [strength.percentage, strength.loading, readOnly, addToast])

  // Coach buckets have a slightly different shape than player buckets
  // (actionId string vs action object). Adapt them to the Hero's
  // ProfileStrengthBucket shape so the same checklist UI renders.
  const adaptedBuckets: ProfileStrengthBucket[] = useMemo(
    () =>
      strength.buckets.map((b) => ({
        id: b.id,
        label: b.label,
        description: b.hint,
        unlockCopy: b.unlockCopy,
        weight: b.weight,
        completed: b.completed,
        action:
          b.actionId === 'journey-tab'
            ? { type: 'tab' as const, tab: 'journey' }
            : b.actionId === 'gallery-tab'
              ? { type: 'tab' as const, tab: 'media' }
              : b.actionId === 'friends-tab'
                ? { type: 'tab' as const, tab: 'community' }
                : { type: 'edit-profile' as const },
      })),
    [strength.buckets],
  )

  const handleTabChange = useMemo(
    () => (tab: TabType) => {
      const wasSameTab = activeTab === tab

      const preserved = new URLSearchParams(searchParams)
      preserved.delete('tab')
      const qs = preserved.toString()
      const qsSuffix = qs ? `?${qs}` : ''

      let path: string
      if (readOnly) {
        const base = routeParams.username
          ? `/coaches/${routeParams.username}`
          : routeParams.id
            ? `/coaches/id/${routeParams.id}`
            : null
        if (!base) return
        path = tab === 'profile' ? base : `${base}/${tab}`
      } else {
        path = tab === 'profile' ? '/dashboard/profile' : `/dashboard/profile/${tab}`
      }

      navigate(`${path}${qsSuffix}`, { replace: true })

      // Tap on the same tab → replay scroll (mirrors Player).
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

  const handleProfileStrengthAction = (bucket: ProfileStrengthBucket) => {
    switch (bucket.action.type) {
      case 'edit-profile':
        setShowEditModal(true)
        break
      case 'tab': {
        const targetTab = bucket.action.tab as TabType
        handleTabChange(targetTab)
        break
      }
      // Coach buckets don't have add-video; fall through.
      default:
        setShowEditModal(true)
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
          `and(participant_one_id.eq.${user.id},participant_two_id.eq.${profileData.id}),and(participant_one_id.eq.${profileData.id},participant_two_id.eq.${user.id})`,
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
    const slug = profile.username ? profile.username : `id/${profile.id}`
    navigate(`/coaches/${slug}`)
  }

  // Hero pills route to the Community hub.
  const navigateToCommunitySection = (section: 'connections' | 'references') => {
    if (readOnly) {
      const base = routeParams.username
        ? `/coaches/${routeParams.username}`
        : routeParams.id
          ? `/coaches/id/${routeParams.id}`
          : null
      if (!base) return
      navigate(`${base}/community?section=${section}`, { replace: true })
    } else {
      navigate(`/dashboard/profile/community?section=${section}`, { replace: true })
    }
  }

  const handleReferencesClick = () => {
    trackReferenceBadgeClick('coach', profile.accepted_reference_count ?? 0)
    navigateToCommunitySection('references')
  }

  const handleFriendsClick = () => navigateToCommunitySection('connections')

  const handleManageOpportunities = () => handleTabChange('opportunities')

  // Primary CTA for the CoachPostedOpportunitiesCard. Two responsibilities:
  //
  //   1. Auto-enable recruiter mode for the coach.
  //      The opportunities INSERT policy gates coach writes on
  //      coach_recruits_for_team=true (migration 20260505000000).
  //      The dashboard exposes the Create CTA to ALL coaches now, so
  //      we implicitly opt the coach into recruiter mode by flipping
  //      the flag on first Create click. QA-flagged 403 on POST
  //      /opportunities was caused by this mismatch.
  //
  //   2. Trigger the create modal + route to the vacancies surface.
  //      OpportunitiesTab.triggerCreate opens the modal on mount;
  //      we navigate AFTER the flag update so the RLS check reads
  //      the fresh profile state.
  const handleCreateOpportunity = async () => {
    if (profile?.role === 'coach' && profile.coach_recruits_for_team !== true) {
      try {
        const { error } = await supabase
          .from('profiles')
          .update({ coach_recruits_for_team: true })
          .eq('id', profile.id)
        if (error) throw error
        // Refresh the auth store so the dashboard hero immediately
        // shows the "Recruiting players" badge.
        await refreshAuthProfile()
      } catch (err) {
        logger.error('[CoachDashboard] failed to enable recruiter mode', err)
        addToast(
          'Unable to enable recruiter mode. Please try again.',
          'error',
        )
        return
      }
    }
    setTriggerCreateVacancy(true)
    handleTabChange('opportunities')
  }

  // CoachApplicationsCard CTAs — both land on /opportunities (the
  // marketplace). "View applications" appends ?applied=mine so the
  // page can filter to only the coach's own applications; the
  // marketplace also shows "you applied" badges inline.
  const handleBrowseOpportunities = () => navigate('/opportunities')
  const handleViewApplications = () => navigate('/opportunities?applied=mine')

  const isLanding = activeTab === 'profile'

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />

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

        {/* Coaches without a current world club id get a one-time
            nudge to link their club. Owner-only; doesn't appear on
            visitor views. ClubLinkPrompt reads auth/profile state
            internally — no props needed. */}
        {!readOnly && isLanding && <ClubLinkPrompt />}

        <HeroIdentityCard
          // PlayerProfileShape requires position: string | null but
          // CoachProfileShape leaves it optional via Partial<Profile>.
          // The Hero never reads position for coaches (the role check
          // bypasses the player position render). Cast is safe.
          profile={profile as unknown as import('@/pages/PlayerDashboard').PlayerProfileShape}
          readOnly={readOnly}
          isOwnProfile={isOwnProfile}
          authProfileRole={authProfile?.role}
          completionPercentage={strength.percentage}
          completionLoading={strength.loading}
          completionBuckets={!readOnly ? adaptedBuckets : undefined}
          onBucketAction={handleProfileStrengthAction}
          currentClubLogo={currentClubLogo}
          onEdit={() => setShowEditModal(true)}
          onViewPublic={handleViewPublic}
          onMessage={handleSendMessage}
          sendingMessage={sendingMessage}
          onFriendsClick={handleFriendsClick}
          onReferencesClick={handleReferencesClick}
        />

        {!readOnly && isLanding && (
          <div id="profile-viewers" className="scroll-mt-20">
            <ProfileViewersSection />
          </div>
        )}

        {isLanding ? (
          <CoachBentoGrid
            // Same cast rationale as the Hero — Coach and Player share
            // shape but TypeScript's structural check on the optional
            // 'position' field needs an explicit acknowledgement.
            profile={profile as unknown as import('@/pages/PlayerDashboard').PlayerProfileShape}
            readOnly={readOnly}
            onOpenTab={handleTabChange}
            onEdit={() => setShowEditModal(true)}
            onCreateOpportunity={handleCreateOpportunity}
            onManageOpportunities={handleManageOpportunities}
            onBrowseOpportunities={handleBrowseOpportunities}
            onViewApplications={handleViewApplications}
          />
        ) : (
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
                    showVideo={false}
                    showGallery={true}
                    viewerRole={authProfile?.role ?? null}
                    isOwnProfile={!readOnly || isOwnProfile}
                    highlightVisibility={(profile as Profile)?.highlight_visibility ?? 'public'}
                  />
                </div>
              )}

              {activeTab === 'friends' && (
                <div id="visitor-section-friends" className="animate-fade-in">
                  <FriendsTab
                    profileId={profile.id}
                    readOnly={readOnly}
                    profileRole={profile.role}
                    hideReferences
                  />
                </div>
              )}

              {activeTab === 'comments' && (
                <div id="visitor-section-comments" className="animate-fade-in">
                  <CommentsTab
                    profileId={profile.id}
                    highlightedCommentIds={highlightedComments}
                    profileRole={profile.role}
                  />
                </div>
              )}

              {activeTab === 'references' && !readOnly && (
                <div className="animate-fade-in">
                  <ReferencesTab
                    profileId={profile.id}
                    readOnly={readOnly}
                    profileRole={profile.role}
                  />
                </div>
              )}

              {activeTab === 'references' && readOnly && (
                <div className="animate-fade-in">
                  <PublicReferencesSection
                    profileId={profile.id}
                    profileName={profile.full_name ?? profile.username ?? null}
                  />
                </div>
              )}

              {activeTab === 'community' && (
                // Coach Community Hub for owners; Public view for
                // visitors. Same surface shape as Player.
                <div className="animate-fade-in">
                  {readOnly ? (
                    <PublicCommunityView
                      profile={profile as Pick<Profile, 'id' | 'role' | 'full_name' | 'username' | 'accepted_friend_count' | 'accepted_reference_count' | 'post_count'>}
                    />
                  ) : (
                    <CoachCommunityHub
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

              {activeTab === 'opportunities' && (
                <div className="animate-fade-in">
                  <OpportunitiesTab
                    profileId={profile.id}
                    readOnly={readOnly}
                    triggerCreate={triggerCreateVacancy}
                    onCreateTriggered={() => setTriggerCreateVacancy(false)}
                    initialOpportunityType="coach"
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      <EditProfileModal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        role={profile.role as 'player' | 'coach'}
      />

      <SignInPromptModal
        isOpen={showSignInPrompt}
        onClose={() => setShowSignInPrompt(false)}
        title="Sign in to message"
        message="Sign in to message this coach and see more about their profile."
      />
    </div>
  )
}
