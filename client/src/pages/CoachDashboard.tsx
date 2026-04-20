import { useEffect, useState, useRef } from 'react'
import { ArrowLeft, MapPin, Calendar, Edit2, Eye, MessageCircle, Landmark, Mail, Plus } from 'lucide-react'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { Avatar, DashboardMenu, EditProfileModal, JourneyTab, CommentsTab, FriendsTab, FriendshipButton, NextStepCard, PublicReferencesSection, PublicViewBanner, RoleBadge, ScrollableTabs, DualNationalityDisplay, AvailabilityPill, TierBadge } from '@/components'
import { calculateTier } from '@/lib/profileTier'
import ProfileActionMenu from '@/components/ProfileActionMenu'
import Header from '@/components/Header'
import MediaTab from '@/components/MediaTab'
import OpportunitiesTab from '@/components/OpportunitiesTab'
import ProfilePostsTab from '@/components/ProfilePostsTab'
import Button from '@/components/Button'
import { DashboardSkeleton } from '@/components/Skeleton'
import SignInPromptModal from '@/components/SignInPromptModal'
import SocialLinksDisplay from '@/components/SocialLinksDisplay'
import type { Profile } from '@/lib/supabase'
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
import { calculateAge, formatDateOfBirth } from '@/lib/utils'
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

  // Shared handler for NextStepCard — routes a bucket to the right deep-link.
  const handleStrengthBucketAction = (bucket: CoachStrengthBucket) => {
    const actionId = bucket.actionId
    if (!actionId) return

    if (actionId === 'edit-profile') {
      setShowEditModal(true)
    } else if (actionId === 'journey-tab') {
      setActiveTab('journey')
      setSearchParams({ tab: 'journey' })
    } else if (actionId === 'gallery-tab') {
      // Scroll to MediaTab section within profile tab
      const mediaSection = document.querySelector('[data-section="media"]')
      if (mediaSection) {
        mediaSection.scrollIntoView({ behavior: 'smooth' })
      }
    } else if (actionId === 'friends-tab') {
      setActiveTab('friends')
      setSearchParams({ tab: 'friends' })
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

  const tabs: { id: TabType; label: string }[] = [
    { id: 'profile', label: 'Profile' },
    { id: 'vacancies', label: 'Opportunities' },
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

  const getInitials = (name: string | null) => {
    if (!name) return '?'  // Return placeholder for null/undefined
    
    return name
      .trim()
      .split(' ')
      .filter(n => n.length > 0)  // Handle multiple spaces
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)  // Limit to 2 characters
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
              />
            </div>

            {/* Info */}
            <div className="flex-1">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4">
                <div>
                  <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-2">
                    {profile.full_name}
                  </h1>
                  <div className="mb-3 flex flex-wrap items-center gap-3">
                    <RoleBadge role="coach" />
                    {!readOnly && !strengthLoading && (
                      <TierBadge tier={calculateTier(percentage)} />
                    )}
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
                {/* Gender (if specified) */}
                {profile.gender && (
                  <div className={`flex items-center gap-2 ${
                    profile.gender === 'Women' 
                      ? 'text-[#9f7aea]' 
                      : profile.gender === 'Men' 
                        ? 'text-[#5c6bc0]' 
                        : 'text-gray-600'
                  }`}>
                    <span>{profile.gender}</span>
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

        {/* Next-step prompt — visible on every tab while the profile is incomplete (owner only) */}
        {!readOnly && (
          <NextStepCard
            percentage={percentage}
            buckets={buckets}
            loading={strengthLoading}
            onBucketAction={handleStrengthBucketAction}
          />
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

                {!readOnly && (
                  <div className="bg-gradient-to-br from-[#8026FA] to-[#924CEC] rounded-xl p-6 text-white">
                    <h3 className="text-lg font-semibold mb-2">Quick Actions</h3>
                    <p className="text-purple-100 mb-4 text-sm">Manage your coaching profile and find opportunities</p>
                    <button
                      type="button"
                      onClick={handleCreateVacancyClick}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-white text-[#8026FA] rounded-lg hover:bg-gray-50 transition-colors font-medium text-sm"
                    >
                      <Plus className="w-4 h-4" />
                      Create Opportunity
                    </button>
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

                    {profile.gender && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Gender
                        </label>
                        <p className="text-gray-900 capitalize">{profile.gender}</p>
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

            {activeTab === 'vacancies' && (
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
                <CommentsTab profileId={profile.id} highlightedCommentIds={highlightedComments} />
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
        message="Sign in or create a free HOCKIA account to connect with this coach."
      />
    </div>
  )
}
