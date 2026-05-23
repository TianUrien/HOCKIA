import { useEffect, useMemo, useState, useRef } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import Header from '@/components/Header'
import {
  EditProfileModal,
  FriendsTab,
  CommentsTab,
  PublicViewBanner,
} from '@/components'
import ClubMediaTab from '@/components/ClubMediaTab'
import ClubMembersTab from '@/components/ClubMembersTab'
import OpportunitiesTab from '@/components/OpportunitiesTab'
import ProfilePostsTab from '@/components/ProfilePostsTab'
import SignInPromptModal from '@/components/SignInPromptModal'
import ClubHeroCard from '@/components/dashboard/bento/ClubHeroCard'
import ClubBentoGrid from '@/components/dashboard/bento/ClubBentoGrid'
import { ProfileViewersSection } from '@/components/ProfileViewersSection'
import type { Profile } from '@/lib/supabase'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { useNotificationStore } from '@/lib/notifications'
import { useClubProfileStrength } from '@/hooks/useClubProfileStrength'
import type { ProfileStrengthBucket } from '@/hooks/useProfileStrength'
import { useSearchAppearances } from '@/hooks/useSearchAppearances'
import { useTabDeepLinkScroll } from '@/hooks/useTabDeepLinkScroll'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'

// `?section=` query param → DOM anchor id. Drives the deep-link scroll
// for notifications + shareable URLs (e.g. ?section=viewers).
const CLUB_SECTION_ANCHORS = {
  viewers: 'profile-viewers',
} as const

type TabType =
  | 'profile'
  | 'media'
  | 'members'
  | 'friends'
  | 'comments'
  | 'posts'
  | 'opportunities'

const VALID_TABS: TabType[] = [
  'profile',
  'media',
  'members',
  'friends',
  'comments',
  'posts',
  'opportunities',
]

// Legacy section aliases. 'vacancies' → 'opportunities' (PR #101);
// 'overview' was the old landing tab id — it maps to the bare
// /dashboard/profile landing (no section segment); 'connections' was
// flagged in the CASI production QA report — ?tab=connections silently
// fell through to overview because the section never existed for clubs.
// Map it to 'friends', which is the closest equivalent (club's people-
// graph view).
const LEGACY_SECTION_ALIASES: Record<string, TabType> = {
  vacancies: 'opportunities',
  overview: 'profile',
  connections: 'friends',
}

const resolveLegacySection = (section: string | undefined): TabType | null =>
  section && LEGACY_SECTION_ALIASES[section] ? LEGACY_SECTION_ALIASES[section] : null

type ClubProfileShape =
  Partial<Profile> &
  Pick<
    Profile,
    | 'id'
    | 'role'
    | 'full_name'
    | 'avatar_url'
    | 'base_location'
    | 'nationality'
    | 'nationality_country_id'
    | 'club_bio'
    | 'club_history'
    | 'website'
    | 'year_founded'
    | 'email'
    | 'contact_email'
    | 'contact_email_public'
  > & {
    womens_league_division?: string | null
    mens_league_division?: string | null
  }

interface ClubDashboardProps {
  profileData?: ClubProfileShape
  readOnly?: boolean
  /** When true and readOnly is true, shows a banner indicating the user
   *  is viewing their own public profile. */
  isOwnProfile?: boolean
}

export default function ClubDashboard({
  profileData,
  readOnly = false,
  isOwnProfile = false,
}: ClubDashboardProps) {
  const { profile: authProfile, user } = useAuthStore()
  const profile = (profileData ?? authProfile) as ClubProfileShape | null
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { addToast } = useToastStore()

  // Section comes from the URL route segment (PR2-style route promotion),
  // not a ?tab= param.
  //  - Owner:  /dashboard/profile/:section  (DashboardRouter dispatches)
  //  - Visitor: /clubs/:username/:section, /clubs/id/:id/:section
  const routeParams = useParams<{ section?: string; username?: string; id?: string }>()
  const sectionFromRoute = routeParams.section as TabType | undefined
  const aliasedSection = resolveLegacySection(sectionFromRoute) ?? sectionFromRoute
  const sectionIsValid = aliasedSection
    ? (VALID_TABS as string[]).includes(aliasedSection)
    : true
  const activeTab: TabType =
    aliasedSection && (VALID_TABS as string[]).includes(aliasedSection)
      ? aliasedSection
      : 'profile'

  // Document title reflects the dashboard sub-route. For visitor views,
  // prefix with the club name so browser history is identifiable.
  const visitedName = readOnly ? profile?.full_name : null
  const ownerTabTitle: Record<TabType, string> = {
    profile: 'Club dashboard',
    media: 'Media',
    members: 'Members',
    friends: 'Connections',
    comments: 'Comments',
    posts: 'Posts',
    opportunities: 'Opportunities',
  }
  const visitorTabSuffix: Record<TabType, string | null> = {
    profile: null,
    media: 'Media',
    members: 'Members',
    friends: 'Connections',
    comments: 'Comments',
    posts: 'Posts',
    opportunities: 'Opportunities',
  }
  const computedTitle = visitedName
    ? visitorTabSuffix[activeTab]
      ? `${visitedName} — ${visitorTabSuffix[activeTab]}`
      : visitedName
    : ownerTabTitle[activeTab]
  useDocumentTitle(computedTitle)

  const visitorBasePath = useMemo(() => {
    if (!readOnly) return null
    if (routeParams.username) return `/clubs/${routeParams.username}`
    if (routeParams.id) return `/clubs/id/${routeParams.id}`
    return null
  }, [readOnly, routeParams.username, routeParams.id])

  // Legacy route-segment redirect — old /dashboard/profile/vacancies
  // (and visitor equivalents) rewrite to /opportunities so the URL bar
  // shows the canonical slug.
  useEffect(() => {
    if (!sectionFromRoute) return
    const aliased = resolveLegacySection(sectionFromRoute)
    if (!aliased) return
    if (readOnly) {
      if (visitorBasePath) {
        navigate(aliased === 'profile' ? visitorBasePath : `${visitorBasePath}/${aliased}`, { replace: true })
      }
    } else {
      navigate(aliased === 'profile' ? '/dashboard/profile' : `/dashboard/profile/${aliased}`, { replace: true })
    }
  }, [sectionFromRoute, readOnly, visitorBasePath, navigate])

  // Unknown section → redirect back to the landing.
  useEffect(() => {
    if (sectionFromRoute && !sectionIsValid) {
      if (readOnly) {
        if (visitorBasePath) navigate(visitorBasePath, { replace: true })
      } else {
        navigate('/dashboard/profile', { replace: true })
      }
    }
  }, [sectionFromRoute, sectionIsValid, readOnly, visitorBasePath, navigate])

  const [showEditModal, setShowEditModal] = useState(false)
  const [showSignInPrompt, setShowSignInPrompt] = useState(false)
  const [sendingMessage, setSendingMessage] = useState(false)
  const [triggerCreateVacancy, setTriggerCreateVacancy] = useState(false)
  const [memberCount, setMemberCount] = useState<number | null>(null)
  const claimCommentHighlights = useNotificationStore((state) => state.claimCommentHighlights)
  const clearCommentNotifications = useNotificationStore((state) => state.clearCommentNotifications)
  const commentHighlightVersion = useNotificationStore((state) => state.commentHighlightVersion)
  const [highlightedComments, setHighlightedComments] = useState<Set<string>>(new Set())

  // Profile strength — owner only.
  const strength = useClubProfileStrength({
    profile: readOnly ? null : (profileData ?? authProfile) as ClubProfileShape | null,
  })
  const prevPercentageRef = useRef<number | null>(null)

  // Search appearances — owner only, last 7 days. Kept warm for parity
  // with the coach/player dashboards' freshness signals.
  useSearchAppearances({
    profileId: readOnly ? null : (profileData?.id ?? authProfile?.id ?? null),
  })

  const sectionParam = searchParams.get('section')
  const profileId = profile?.id ?? null

  // Hero roster count — single-row probe of get_club_members.
  useEffect(() => {
    if (!profileId) return
    let cancelled = false
    const fetchMemberCount = async () => {
      try {
        const { data, error } = await supabase.rpc('get_club_members', {
          p_profile_id: profileId,
          p_limit: 1,
          p_offset: 0,
        })
        if (cancelled) return
        if (error) throw error
        setMemberCount(data && data.length > 0 ? data[0].total_count : 0)
      } catch (err) {
        logger.error('[ClubDashboard] member count fetch failed', err)
        if (!cancelled) setMemberCount(0)
      }
    }
    void fetchMemberCount()
    return () => {
      cancelled = true
    }
  }, [profileId])

  // Legacy ?tab=X migration — old notification links / bookmarks.
  useEffect(() => {
    const legacyTab = searchParams.get('tab')
    if (!legacyTab) return
    const resolved = resolveLegacySection(legacyTab) ?? (legacyTab as TabType)
    if (!(VALID_TABS as string[]).includes(resolved)) return

    const next = new URLSearchParams(searchParams)
    next.delete('tab')
    const qs = next.toString()
    const qsSuffix = qs ? `?${qs}` : ''

    let path: string
    if (readOnly) {
      if (!visitorBasePath) return
      path = resolved === 'profile' ? visitorBasePath : `${visitorBasePath}/${resolved}`
    } else {
      path = resolved === 'profile' ? '/dashboard/profile' : `/dashboard/profile/${resolved}`
    }
    navigate(`${path}${qsSuffix}`, { replace: true })
  }, [searchParams, readOnly, visitorBasePath, navigate])

  useTabDeepLinkScroll({
    activeTab,
    tabParam: sectionFromRoute ?? null,
    sectionParam,
    sectionAnchors: CLUB_SECTION_ANCHORS,
  })

  // Refresh profile strength when switching tabs.
  useEffect(() => {
    if (!readOnly) {
      void strength.refresh()
    }
  }, [activeTab, readOnly]) // eslint-disable-line react-hooks/exhaustive-deps

  // Comment highlight claiming when entering the comments section.
  useEffect(() => {
    if (readOnly) return
    if (activeTab !== 'comments') {
      if (highlightedComments.size > 0) setHighlightedComments(new Set())
      return
    }
    const ids = claimCommentHighlights()
    const hasNew = ids.some((id) => !highlightedComments.has(id))
    if (hasNew) {
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
    const current = strength.percentage
    const prev = prevPercentageRef.current
    if (prev !== null && current > prev) {
      const increase = current - prev
      if (current >= 100) {
        addToast('Your club profile is now complete! Players and coaches see complete clubs first.', 'success')
      } else {
        addToast(`Profile strength +${increase}%. Keep going!`, 'success')
      }
    }
    prevPercentageRef.current = current
  }, [strength.percentage, strength.loading, readOnly, addToast])

  // Adapt club buckets (actionId strings) to the Hero's
  // ProfileStrengthBucket shape (action objects). 'gallery-section'
  // routes to the Media section; everything else opens the edit modal.
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
          b.actionId === 'gallery-section'
            ? { type: 'tab' as const, tab: 'media' }
            : { type: 'edit-profile' as const },
      })),
    [strength.buckets],
  )

  const handleTabChange = useMemo(
    () => (tab: TabType | 'community') => {
      // CommunityCard's main CTA emits 'community'; clubs have no unified
      // community hub, so it resolves to the Connections section.
      const target: TabType = tab === 'community' ? 'friends' : tab
      const wasSameTab = activeTab === target

      const preserved = new URLSearchParams(searchParams)
      preserved.delete('tab')
      const qs = preserved.toString()
      const qsSuffix = qs ? `?${qs}` : ''

      let path: string
      if (readOnly) {
        if (!visitorBasePath) return
        path = target === 'profile' ? visitorBasePath : `${visitorBasePath}/${target}`
      } else {
        path = target === 'profile' ? '/dashboard/profile' : `/dashboard/profile/${target}`
      }
      navigate(`${path}${qsSuffix}`, { replace: true })

      if (wasSameTab && target !== 'profile') {
        const performScroll = () => {
          const el = document.getElementById('profile-tab-content')
          if (el && typeof el.scrollIntoView === 'function') {
            try { el.scrollIntoView({ behavior: 'smooth', block: 'start' }) } catch { /* noop */ }
          }
        }
        window.requestAnimationFrame(performScroll)
        window.setTimeout(performScroll, 400)
      }
    },
    [activeTab, navigate, readOnly, visitorBasePath, searchParams],
  )

  const handleProfileStrengthAction = (bucket: ProfileStrengthBucket) => {
    if (bucket.action.type === 'tab') {
      handleTabChange(bucket.action.tab as TabType)
    } else {
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
    navigate(`/clubs/${slug}`)
  }

  const handleCreateOpportunity = () => {
    setTriggerCreateVacancy(true)
    handleTabChange('opportunities')
  }

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

        <ClubHeroCard
          profile={profile as Parameters<typeof ClubHeroCard>[0]['profile']}
          readOnly={readOnly}
          isOwnProfile={isOwnProfile}
          memberCount={memberCount}
          completionPercentage={strength.percentage}
          completionLoading={strength.loading}
          completionBuckets={!readOnly ? adaptedBuckets : undefined}
          onBucketAction={handleProfileStrengthAction}
          onEdit={() => setShowEditModal(true)}
          onViewPublic={handleViewPublic}
          onMessage={handleSendMessage}
          sendingMessage={sendingMessage}
          onConnectionsClick={() => handleTabChange('friends')}
          onMembersClick={() => handleTabChange('members')}
          authProfileRole={authProfile?.role}
        />

        {!readOnly && isLanding && (
          <div id="profile-viewers" className="scroll-mt-20">
            <ProfileViewersSection />
          </div>
        )}

        {isLanding ? (
          <ClubBentoGrid
            profile={profile as Parameters<typeof ClubBentoGrid>[0]['profile']}
            readOnly={readOnly}
            onOpenTab={handleTabChange}
            onEdit={() => setShowEditModal(true)}
            onCreateOpportunity={handleCreateOpportunity}
            onManageOpportunities={() => handleTabChange('opportunities')}
          />
        ) : (
          <div id="profile-tab-content" className="bg-white rounded-2xl shadow-sm scroll-mt-4">
            <div className="p-6 md:p-8 min-h-screen">
              {activeTab === 'media' && (
                <div className="animate-fade-in">
                  <ClubMediaTab
                    clubId={profile.id}
                    readOnly={readOnly}
                    // Keep the Hero completion arc in sync when photos
                    // are added/removed without a route change.
                    onCountChange={readOnly ? undefined : () => { void strength.refresh() }}
                  />
                </div>
              )}

              {activeTab === 'members' && (
                <div className="animate-fade-in">
                  <ClubMembersTab profileId={profile.id} />
                </div>
              )}

              {activeTab === 'friends' && (
                <div id="visitor-section-friends" className="animate-fade-in">
                  {/* hideReferences — clubs don't carry trust references,
                      and the dashboard drops the References tile, so the
                      Connections section stays references-free too. */}
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
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      <EditProfileModal isOpen={showEditModal} onClose={() => setShowEditModal(false)} role="club" />

      <SignInPromptModal
        isOpen={showSignInPrompt}
        onClose={() => setShowSignInPrompt(false)}
        title="Sign in to message"
        message="Sign in to message and follow this club."
      />
    </div>
  )
}
