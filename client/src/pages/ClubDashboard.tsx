import { useEffect, useState, useRef } from 'react'
import { ArrowLeft, MapPin, Calendar, Plus, Eye, MessageCircle, Edit, Loader2 } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Header from '@/components/Header'
import { Avatar, Button, CountryDisplay, DashboardMenu, EditProfileModal, CommentsTab, FriendsTab, FriendshipButton, ProfileStrengthCard, PublicViewBanner, RoleBadge, ScrollableTabs } from '@/components'
import { useClubProfileStrength } from '@/hooks/useClubProfileStrength'
import { logger } from '@/lib/logger'
import OpportunitiesTab from '@/components/OpportunitiesTab'
import ProfilePostsTab from '@/components/ProfilePostsTab'
import ClubMediaTab from '@/components/ClubMediaTab'
import ClubMembersTab from '@/components/ClubMembersTab'
import Skeleton from '@/components/Skeleton'
import SignInPromptModal from '@/components/SignInPromptModal'
import SocialLinksDisplay from '@/components/SocialLinksDisplay'
import { useAuthStore } from '@/lib/auth'
import type { Profile } from '@/lib/supabase'
import { supabase } from '@/lib/supabase'
import { isUniqueViolationError } from '@/lib/supabaseErrors'
import { useToastStore } from '@/lib/toast'
import { useNotificationStore } from '@/lib/notifications'
import { derivePublicContactEmail } from '@/lib/profile'
import type { SocialLinks } from '@/lib/socialLinks'

type TabType = 'overview' | 'vacancies' | 'friends' | 'members' | 'comments' | 'posts'

const ALL_TABS: TabType[] = ['overview', 'vacancies', 'members', 'friends', 'comments', 'posts']

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
  /** When true and readOnly is true, shows a banner indicating user is viewing their own public profile */
  isOwnProfile?: boolean
}

export default function ClubDashboard({ profileData, readOnly = false, isOwnProfile = false }: ClubDashboardProps) {
  const { profile: authProfile, user } = useAuthStore()
  const profile = (profileData ?? authProfile) as ClubProfileShape | null
  const navigate = useNavigate()
  const { addToast } = useToastStore()
  const [searchParams, setSearchParams] = useSearchParams()
  const allowedTabs = ALL_TABS
  const [activeTab, setActiveTab] = useState<TabType>(() => {
    const param = searchParams.get('tab') as TabType | null
    return param && allowedTabs.includes(param) ? param : 'overview'
  })
  const [showEditModal, setShowEditModal] = useState(false)
  const [showSignInPrompt, setShowSignInPrompt] = useState(false)
  const [sendingMessage, setSendingMessage] = useState(false)
  const [triggerCreateVacancy, setTriggerCreateVacancy] = useState(false)
  const claimCommentHighlights = useNotificationStore((state) => state.claimCommentHighlights)
  const clearCommentNotifications = useNotificationStore((state) => state.clearCommentNotifications)
  const commentHighlightVersion = useNotificationStore((state) => state.commentHighlightVersion)
  const [highlightedComments, setHighlightedComments] = useState<Set<string>>(new Set())

  const tabParam = searchParams.get('tab') as TabType | null

  // Profile strength for clubs (only compute for own profile)
  const { percentage, buckets, loading: strengthLoading, refresh: refreshStrength } = useClubProfileStrength({
    profile: readOnly ? null : (profileData ?? authProfile) as ClubProfileShape | null,
  })

  // Track previous percentage to show toast on improvement
  const prevPercentageRef = useRef<number | null>(null)

  useEffect(() => {
    if (!tabParam) return
    if (!allowedTabs.includes(tabParam)) {
      if (activeTab !== 'overview') {
        setActiveTab('overview')
      }
      return
    }

    if (tabParam !== activeTab) {
      setActiveTab(tabParam)
    }
  }, [tabParam, allowedTabs, activeTab])

  // Refresh profile strength when switching to overview tab (to pick up gallery changes)
  useEffect(() => {
    if (!readOnly && activeTab === 'overview') {
      void refreshStrength()
    }
  }, [activeTab, readOnly, refreshStrength])

  // Show toast when profile strength improves
  useEffect(() => {
    if (readOnly || strengthLoading) return
    if (prevPercentageRef.current !== null && percentage > prevPercentageRef.current) {
      const increase = percentage - prevPercentageRef.current
      if (percentage >= 100) {
        addToast("Your club profile is now complete!", 'success')
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
        return
      }

      const { data: newConv, error: insertError } = await supabase
        .from('conversations')
        .insert({
          participant_one_id: user.id,
          participant_two_id: profileData.id
        })
        .select('id')
        .single()

      if (insertError) {
        if (isUniqueViolationError(insertError)) {
          const { data: refetchedConv, error: refetchError } = await supabase
            .from('conversations')
            .select('id')
            .or(
              `and(participant_one_id.eq.${user.id},participant_two_id.eq.${profileData.id}),and(participant_one_id.eq.${profileData.id},participant_two_id.eq.${user.id})`
            )
            .maybeSingle()

          if (refetchError) throw refetchError
          if (refetchedConv?.id) {
            navigate(`/messages?conversation=${refetchedConv.id}`)
            return
          }
        }

        throw insertError
      }

      if (!newConv?.id) {
        throw new Error('Conversation insert returned no data')
      }

      navigate(`/messages?conversation=${newConv.id}`)
    } catch (error) {
      logger.error('Error creating conversation:', error)
      const msg = error instanceof Error ? error.message : typeof error === 'object' && error !== null && 'message' in error ? String((error as Record<string, unknown>).message) : ''
      if (msg.includes('Brands cannot initiate')) {
        addToast('Brands cannot start conversations yet. Players and clubs can message you first.', 'error')
      } else {
        addToast('Failed to start conversation. Please try again.', 'error')
      }
    } finally {
      setSendingMessage(false)
    }
  }

  const tabs: { id: TabType; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'vacancies', label: 'Opportunities' },
    { id: 'members', label: 'Members' },
    { id: 'friends', label: 'Friends' },
    { id: 'comments', label: 'Comments' },
    { id: 'posts', label: 'Posts' },
  ]

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab)
    const next = new URLSearchParams(searchParams)
    next.set('tab', tab)
    setSearchParams(next, { replace: true })
    if (tab !== 'vacancies' && triggerCreateVacancy) {
      setTriggerCreateVacancy(false)
    }
  }

  const getInitials = (name: string | null) => {
    if (!name) return '?'
    return name
      .trim()
      .split(' ')
      .filter(Boolean)
      .map((part) => part[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />

        <main className="mx-auto max-w-7xl px-4 pt-24 pb-12 md:px-6">
          <div className="mb-6 rounded-2xl bg-white p-6 shadow-sm md:p-8">
            <div className="flex flex-col gap-6 md:flex-row md:items-center">
              <Skeleton variant="circular" width={96} height={96} className="flex-shrink-0" />
              <div className="flex-1 space-y-4">
                <Skeleton width="60%" height={40} />
                <div className="flex flex-wrap gap-4">
                  <Skeleton width={160} height={24} />
                  <Skeleton width={140} height={24} />
                  <Skeleton width={120} height={24} />
                </div>
                <Skeleton width={90} height={28} className="rounded-full" />
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-white shadow-sm">
            <div className="sticky top-[68px] z-40 border-b border-gray-200 bg-white/90 backdrop-blur">
              <div className="flex gap-6 overflow-x-auto px-6 py-4">
                {tabs.map((tab) => (
                  <div key={tab.id} className="flex flex-col items-start space-y-2">
                    <Skeleton width={80} height={24} />
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-6 p-6 md:p-8">
              <Skeleton width="40%" height={28} />
              <Skeleton width="100%" height={120} />
              <Skeleton width="100%" height={120} />
            </div>
          </div>
        </main>
      </div>
    )
  }

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

        <div className="bg-white rounded-2xl p-6 md:p-8 shadow-sm mb-6 animate-fade-in overflow-visible">
          <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
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
                <h1 className="text-3xl md:text-4xl font-bold text-gray-900">{profile.full_name}</h1>
                {readOnly ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium">
                      <Eye className="w-4 h-4" />
                      Network View
                    </div>
                    <FriendshipButton profileId={profile.id} />
                    {authProfile?.role !== 'brand' && (
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={handleSendMessage}
                        disabled={sendingMessage}
                        className="gap-2"
                      >
                        {sendingMessage ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <MessageCircle className="w-4 h-4" />
                        )}
                        {sendingMessage ? 'Starting...' : 'Message'}
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate(`/clubs/id/${profile.id}`)}
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
                      <Edit className="w-4 h-4 flex-shrink-0" />
                      <span className="hidden xs:inline">Edit Profile</span>
                      <span className="xs:hidden">Edit</span>
                    </Button>
                    <DashboardMenu />
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-4 text-gray-600 mb-4">
                <div className="flex items-center gap-2">
                  <CountryDisplay
                    countryId={profile.nationality_country_id}
                    fallbackText={profile.nationality}
                    className="font-medium"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <MapPin className="w-5 h-5" />
                  <span>{profile.base_location}</span>
                </div>
                {profile.year_founded && (
                  <div className="flex items-center gap-2">
                    <Calendar className="w-5 h-5" />
                    <span>Founded {profile.year_founded}</span>
                  </div>
                )}
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-3">
                <RoleBadge role="club" />
                <SocialLinksDisplay 
                  links={profile.social_links as SocialLinks | null | undefined} 
                  iconSize="sm" 
                />
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm animate-slide-in-up">
          <div className="sticky top-[68px] z-40 border-b border-gray-200 bg-white/90 backdrop-blur">
            <ScrollableTabs
              tabs={tabs}
              activeTab={activeTab}
              onTabChange={handleTabChange}
              className="gap-8 px-6"
              activeClassName="border-[#924CEC] text-[#924CEC]"
              inactiveClassName="border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300"
            />
          </div>

          <div className="p-6 md:p-8">
            {activeTab === 'overview' && (
              <div className="space-y-8 animate-fade-in">
                {/* Profile Strength Card - only for own profile */}
                {!readOnly && (
                  <ProfileStrengthCard
                    percentage={percentage}
                    buckets={buckets}
                    loading={strengthLoading}
                    onBucketAction={(bucket) => {
                      if (bucket.actionId === 'edit-profile') {
                        setShowEditModal(true)
                      } else if (bucket.actionId === 'gallery-section') {
                        // Scroll to gallery section
                        const gallerySection = document.querySelector('[data-section="gallery"]')
                        if (gallerySection) {
                          gallerySection.scrollIntoView({ behavior: 'smooth' })
                        }
                      }
                    }}
                  />
                )}

                {!readOnly && (
                  <div className="bg-gradient-to-br from-[#8026FA] to-[#924CEC] rounded-xl p-6 text-white">
                    <h3 className="text-lg font-semibold mb-2">Quick Actions</h3>
                    <p className="text-purple-100 mb-4 text-sm">Manage your club and find the best talent</p>
                    <button
                      onClick={handleCreateVacancyClick}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-white text-[#8026FA] rounded-lg hover:bg-gray-50 transition-colors font-medium text-sm"
                    >
                      <Plus className="w-4 h-4" />
                      Create Vacancy
                    </button>
                  </div>
                )}

                <div>
                  <h2 className="text-2xl font-bold text-gray-900 mb-6">Club Information</h2>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Club Name</label>
                      <p className="text-gray-900 font-medium">{profile.full_name}</p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
                      <p className="text-gray-900">{profile.base_location}</p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Country</label>
                      <CountryDisplay
                        countryId={profile.nationality_country_id}
                        fallbackText={profile.nationality}
                        className="text-gray-900"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Year Founded</label>
                      <p className={profile.year_founded ? 'text-gray-900' : 'text-gray-500 italic'}>
                        {profile.year_founded || 'Not specified'}
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Leagues</label>
                      {profile.womens_league_division || profile.mens_league_division ? (
                        <div className="text-gray-900 space-y-1">
                          {profile.womens_league_division ? <div>Women: {profile.womens_league_division}</div> : null}
                          {profile.mens_league_division ? <div>Men: {profile.mens_league_division}</div> : null}
                        </div>
                      ) : (
                        <p className="text-gray-500 italic">Not specified</p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Website</label>
                      {profile.website ? (
                        <a
                          href={profile.website.startsWith('http') ? profile.website : `https://${profile.website}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#8026FA] hover:text-[#6B20D4] underline"
                        >
                          {profile.website}
                        </a>
                      ) : (
                        <p className="text-gray-500 italic">Not specified</p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Contact Email</label>
                      {publicContact.shouldShow && publicContact.displayEmail ? (
                        <a
                          href={`mailto:${publicContact.displayEmail}`}
                          className="text-[#8026FA] hover:text-[#6B20D4] underline"
                        >
                          {publicContact.displayEmail}
                        </a>
                      ) : (
                        <p className="text-gray-500 italic">Not shared with other PLAYR members</p>
                      )}
                      {!readOnly && (
                        <p className="text-xs text-gray-500 mt-1">
                          {profile.contact_email_public
                            ? publicContact.source === 'contact'
                              ? 'Other PLAYR members see your contact email.'
                              : 'Add a contact email to be reachable.'
                            : savedContactEmail
                              ? 'Saved contact email is private.'
                              : 'No contact email saved; only private channels apply.'}
                        </p>
                      )}
                      {!readOnly && !profile.contact_email_public && savedContactEmail && (
                        <p className="text-xs text-gray-500 break-words">
                          Private contact email: <span className="text-gray-700 font-medium">{savedContactEmail}</span>
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="mt-8">
                    <label className="block text-sm font-medium text-gray-700 mb-2">About the Club</label>
                    <p className={profile.club_bio ? 'text-gray-700 leading-relaxed' : 'text-gray-500 italic'}>
                      {profile.club_bio || 'No description provided'}
                    </p>
                  </div>

                  <div className="mt-6">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Club History</label>
                    <p className={profile.club_history ? 'text-gray-700 leading-relaxed' : 'text-gray-500 italic'}>
                      {profile.club_history || 'No history provided'}
                    </p>
                  </div>
                </div>

                <section data-section="gallery" className="pt-6 border-t border-gray-200">
                  <ClubMediaTab clubId={profile.id} readOnly={readOnly} />
                </section>

                {/* Posts — shown inline on public profile below gallery */}
                {readOnly && (
                  <section className="space-y-3 pt-6 border-t border-gray-200">
                    <h2 className="text-2xl font-bold text-gray-900">Posts</h2>
                    <ProfilePostsTab profileId={profile.id} readOnly />
                  </section>
                )}

                {!readOnly && (
                  <div className="pt-6 border-t border-gray-200">
                    <button
                      onClick={() => setShowEditModal(true)}
                      className="px-6 py-3 bg-[#8026FA] text-white rounded-lg hover:bg-[#6B20D4] transition-colors font-medium"
                    >
                      Update Club Information
                    </button>
                  </div>
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

            {activeTab === 'members' && (
              <div className="animate-fade-in">
                <ClubMembersTab profileId={profile.id} />
              </div>
            )}
          </div>
        </div>
      </main>

      <EditProfileModal isOpen={showEditModal} onClose={() => setShowEditModal(false)} role="club" />

      {/* Sign In Prompt Modal */}
      <SignInPromptModal
        isOpen={showSignInPrompt}
        onClose={() => setShowSignInPrompt(false)}
        title="Sign in to message"
        message="Sign in or create a free PLAYR account to connect with this club."
      />
    </div>
  )
}
