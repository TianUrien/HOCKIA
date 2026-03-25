import { useEffect, useState, useRef } from 'react'
import { ArrowLeft, MapPin, Calendar, Edit2, Eye, MessageCircle, Landmark, Mail, Award } from 'lucide-react'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { Avatar, DashboardMenu, EditProfileModal, FriendsTab, FriendshipButton, PublicReferencesSection, PublicViewBanner, RoleBadge, ScrollableTabs, ProfileStrengthCard, DualNationalityDisplay, AvailabilityPill } from '@/components'
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
import { supabase } from '@/lib/supabase'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useToastStore } from '@/lib/toast'
import { useNotificationStore } from '@/lib/notifications'
import { derivePublicContactEmail } from '@/lib/profile'
import type { SocialLinks } from '@/lib/socialLinks'
import { useProfileStrength, type ProfileStrengthBucket } from '@/hooks/useProfileStrength'
import { ProfileViewersSection } from '@/components/ProfileViewersSection'
import AvailabilityToggleStrip from '@/components/AvailabilityToggleStrip'
import ClubLinkPrompt from '@/components/ClubLinkPrompt'
import { useWorldClubLogo } from '@/hooks/useWorldClubLogo'
import { calculateAge, formatDateOfBirth } from '@/lib/utils'

type TabType = 'profile' | 'friends' | 'journey' | 'comments' | 'posts'

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
    return tabParam && ['profile', 'friends', 'journey', 'comments', 'posts'].includes(tabParam) ? tabParam : 'profile'
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

  useEffect(() => {
    if (!tabParam) return
    if (tabParam !== activeTab && ['profile', 'friends', 'journey', 'comments', 'posts'].includes(tabParam)) {
      setActiveTab(tabParam)
    }
  }, [tabParam, activeTab])

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
            />
            <div className="flex-1">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-3">
                <h1 className="text-3xl md:text-4xl font-bold text-gray-900">
                  {profile.full_name}
                </h1>
                {readOnly ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <FriendshipButton profileId={profile.id} />
                    {authProfile?.role !== 'brand' && (
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
                    {!isOwnProfile && <ProfileActionMenu targetId={profile.id} targetName={profile.full_name ?? 'this user'} />}
                  </div>
                ) : (
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

                {/* Gender (if specified) */}
                {profile.gender && (
                  <>
                    <span className="text-gray-400">•</span>
                    <div className={`flex items-center gap-1.5 ${
                      profile.gender === 'Women' 
                        ? 'text-[#9f7aea]' 
                        : profile.gender === 'Men' 
                          ? 'text-[#5c6bc0]' 
                          : 'text-gray-600'
                    }`}>
                      <span>{profile.gender}</span>
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
                {profile.open_to_play && <AvailabilityPill variant="play" />}
                <SocialLinksDisplay 
                  links={profile.social_links as SocialLinks | null | undefined} 
                  iconSize="sm" 
                />
              </div>
            </div>
          </div>
        </div>

        {/* Tabs Card */}
        <div className="bg-white rounded-2xl shadow-sm animate-slide-in-up">
          {/* Tab Navigation */}
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

          {/* Tab Content */}
          <div className="p-6 md:p-8">
            {activeTab === 'profile' && (
              <div className="space-y-10 animate-fade-in">
                {/* Profile Strength Card - Only show for own profile (not readOnly) */}
                {!readOnly && (
                  <ProfileStrengthCard
                    percentage={profileStrength.percentage}
                    buckets={profileStrength.buckets}
                    loading={profileStrength.loading}
                    onBucketAction={handleProfileStrengthAction}
                  />
                )}
                {!readOnly && <ProfileViewersSection />}
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
                        Gender
                      </label>
                      <p className={profile.gender ? "text-gray-900" : "text-gray-500 italic"}>
                        {profile.gender || 'Not specified'}
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

            {activeTab === 'journey' && (
              <div className="animate-fade-in">
                <JourneyTab profileId={profile.id} readOnly={readOnly} />
              </div>
            )}

            {activeTab === 'comments' && (
              <div className="animate-fade-in">
                <CommentsTab profileId={profile.id} highlightedCommentIds={highlightedComments} />
              </div>
            )}

            {activeTab === 'friends' && (
              <div className="animate-fade-in">
                <FriendsTab profileId={profile.id} readOnly={readOnly} profileRole={profile.role} />
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
        message="Sign in or create a free HOCKIA account to connect with this player."
      />
    </div>
  )
}
