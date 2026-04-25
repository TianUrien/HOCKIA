/**
 * UmpireDashboard — Phase F1 (tabbed)
 *
 * Umpires are a full HOCKIA citizen: same tabbed architecture as Player /
 * Coach / Club / Brand, but every tab is translated to officiating semantics
 * instead of copy-pasted.
 *
 * Tabs:
 *   - Profile      — Certification & Level, Bio, Languages
 *   - Officiating  — UmpireAppointmentsSection (Phase C content)
 *   - Gallery      — MediaTab gallery (shared gallery_photos table)
 *   - Friends      — FriendsTab (includes TrustedReferencesSection inside,
 *                    so umpires' peer references live here too)
 *   - Comments     — CommentsTab
 *   - Posts        — ProfilePostsTab
 *
 * Hero card + empty-state CTA sit ABOVE the tabs so credentials pills and
 * the "add credentials" nudge stay visible on every tab. Matches the
 * NextStepCard-above-tabs pattern other role dashboards use.
 *
 * Phase F2 will convert the Officiating tab into a richer Journey (mixed
 * appointments + milestones + panel inductions + certifications) via an
 * entry_type extension on umpire_appointments.
 */

import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, MapPin, Calendar, Shield, Flag, Edit2, Eye, Languages as LanguagesIcon, Activity, MessageCircle } from 'lucide-react'
import Header from '@/components/Header'
import {
  Avatar,
  Button,
  CommentsTab,
  DashboardMenu,
  EditProfileModal,
  FriendsTab,
  FriendshipButton,
  PublicReferencesSection,
  PublicViewBanner,
  RoleBadge,
  ScrollableTabs,
  TierBadge,
  VerifiedBadge,
  DualNationalityDisplay,
} from '@/components'
import UmpireAppointmentsSection from '@/components/UmpireAppointmentsSection'
import ProfileActionMenu from '@/components/ProfileActionMenu'
import ProfilePostsTab from '@/components/ProfilePostsTab'
import MediaTab from '@/components/MediaTab'
import SignInPromptModal from '@/components/SignInPromptModal'
import { useAuthStore } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import type { Profile } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { useToastStore } from '@/lib/toast'
import { calculateAge, formatDateOfBirth } from '@/lib/utils'
import { calculateTier } from '@/lib/profileTier'
import { useUmpireProfileStrength } from '@/hooks/useUmpireProfileStrength'
import { getUmpireActivity } from '@/lib/umpireActivity'

export type UmpireProfileShape =
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
    | 'nationality2_country_id'
    | 'gender'
    | 'date_of_birth'
    | 'bio'
  >

interface UmpireDashboardProps {
  profileData?: UmpireProfileShape
  readOnly?: boolean
  /** True when an owner is viewing their own profile in readOnly "network
   * view" mode — renders the PublicViewBanner with a "Back to dashboard"
   * shortcut. Matches PlayerDashboard / CoachDashboard / ClubDashboard. */
  isOwnProfile?: boolean
}

type TabType = 'profile' | 'officiating' | 'gallery' | 'friends' | 'comments' | 'posts'

const TAB_IDS: TabType[] = ['profile', 'officiating', 'gallery', 'friends', 'comments', 'posts']

function isTabType(value: string | null): value is TabType {
  return !!value && (TAB_IDS as string[]).includes(value)
}

function specializationLabel(value: string | null | undefined): string | null {
  if (!value) return null
  if (value === 'both') return 'Outdoor & Indoor'
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export default function UmpireDashboard({
  profileData,
  readOnly = false,
  isOwnProfile = false,
}: UmpireDashboardProps) {
  const { user, profile: authProfile } = useAuthStore()
  const profile = (profileData ?? authProfile) as UmpireProfileShape | null
  const navigate = useNavigate()
  const { addToast } = useToastStore()
  const [searchParams, setSearchParams] = useSearchParams()
  const [showEditModal, setShowEditModal] = useState(false)
  const [sendingMessage, setSendingMessage] = useState(false)
  const [showSignInPrompt, setShowSignInPrompt] = useState(false)

  // Tab state, synced with ?tab= query param so notification deep-links
  // (e.g., .../dashboard/profile?tab=friends) land on the right tab.
  const tabParam = searchParams.get('tab')
  const [activeTab, setActiveTab] = useState<TabType>(() =>
    isTabType(tabParam) ? tabParam : 'profile'
  )

  useEffect(() => {
    if (isTabType(tabParam) && tabParam !== activeTab) {
      setActiveTab(tabParam)
    }
  }, [tabParam, activeTab])

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab)
    const next = new URLSearchParams(searchParams)
    next.set('tab', tab)
    setSearchParams(next, { replace: true })
  }

  const handleSendMessage = async () => {
    if (!user) {
      setShowSignInPrompt(true)
      return
    }
    if (!profile) return
    if (user.id === profile.id) {
      addToast('You cannot message yourself.', 'error')
      return
    }

    setSendingMessage(true)
    try {
      const { data: existingConv, error: fetchError } = await supabase
        .from('conversations')
        .select('id')
        .or(
          `and(participant_one_id.eq.${user.id},participant_two_id.eq.${profile.id}),and(participant_one_id.eq.${profile.id},participant_two_id.eq.${user.id})`
        )
        .maybeSingle()

      if (fetchError) throw fetchError

      if (existingConv?.id) {
        navigate(`/messages?conversation=${existingConv.id}`)
      } else {
        navigate(`/messages?new=${profile.id}`)
      }
    } catch (error) {
      logger.error('Error starting conversation:', error)
      addToast('Failed to start conversation. Please try again.', 'error')
    } finally {
      setSendingMessage(false)
    }
  }

  // Owner-view tier uses the precise credentials-weighted strength hook so the
  // badge is exact (not estimated from community-grid fallbacks). Weights match
  // `estimateMemberStrength(umpire)`, so community cards and dashboard agree.
  const { percentage } = useUmpireProfileStrength({ profile })
  const tier = profile ? calculateTier(percentage) : null

  useEffect(() => {
    document.title = profile?.full_name
      ? `${profile.full_name} — Umpire | HOCKIA`
      : 'Umpire | HOCKIA'
  }, [profile?.full_name])

  if (!profile) return null

  const initials = profile.full_name
    ? profile.full_name.split(' ').map(n => n[0]).join('').slice(0, 2)
    : '?'

  const age = profile.date_of_birth ? calculateAge(profile.date_of_birth) : null
  const dobDisplay = profile.date_of_birth ? formatDateOfBirth(profile.date_of_birth) : null
  const specLabel = specializationLabel(profile.officiating_specialization)
  const hasCertification =
    profile.umpire_level || profile.federation || profile.umpire_since || specLabel
  const hasLanguages = profile.languages && profile.languages.length > 0
  const hasBio = Boolean(profile.bio?.trim())

  const tabs: { id: TabType; label: string }[] = [
    { id: 'profile', label: 'Profile' },
    { id: 'officiating', label: 'Journey' },
    { id: 'gallery', label: 'Gallery' },
    { id: 'friends', label: 'Friends' },
    { id: 'comments', label: 'Comments' },
    { id: 'posts', label: 'Posts' },
  ]

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      {readOnly && isOwnProfile && <PublicViewBanner />}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 pt-24 pb-12">
        {readOnly && (
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900 mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
        )}

        {/* ── Hero card ── */}
        <div className="bg-white rounded-2xl shadow-sm p-5 md:p-8 animate-fade-in">
          <div className="flex flex-col md:flex-row md:items-center gap-5 md:gap-6">
            <Avatar
              src={profile.avatar_url}
              alt={profile.full_name ?? 'Umpire'}
              initials={initials}
              size="xl"
              enablePreview
              previewTitle={profile.full_name ?? undefined}
            />
            <div className="flex-1 min-w-0">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-1">
                <h1 className="text-3xl md:text-4xl font-bold text-gray-900 flex items-center gap-2 flex-wrap">
                  <span>{profile.full_name}</span>
                  <VerifiedBadge
                    verified={profile.is_verified}
                    verifiedAt={profile.verified_at ?? null}
                  />
                </h1>
                {!readOnly ? (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigate(`/umpires/id/${profile.id}?view=public`)}
                      className="gap-1.5 whitespace-nowrap text-xs sm:text-sm px-2.5 sm:px-4"
                      title="See how your profile looks to other HOCKIA members"
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
                ) : !isOwnProfile ? (
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
                    <ProfileActionMenu
                      targetId={profile.id}
                      targetName={profile.full_name ?? 'this umpire'}
                    />
                  </div>
                ) : null}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <RoleBadge role="umpire" />
                {!readOnly && tier && <TierBadge tier={tier} />}
                {profile.umpire_level && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800">
                    <Shield className="w-3 h-3" />
                    {profile.umpire_level}
                  </span>
                )}
                {profile.federation && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">
                    <Flag className="w-3 h-3" />
                    {profile.federation}
                  </span>
                )}
                {(() => {
                  const activity = getUmpireActivity(profile.last_officiated_at)
                  if (!activity) return null
                  const colorClass =
                    activity.state === 'active'
                      ? 'bg-emerald-50 text-emerald-800'
                      : activity.state === 'recent'
                        ? 'bg-gray-100 text-gray-700'
                        : 'bg-gray-50 text-gray-500'
                  return (
                    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${colorClass}`}>
                      <Activity className="w-3 h-3" />
                      {activity.label}
                    </span>
                  )
                })()}
              </div>

              <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-gray-600">
                {(profile.nationality_country_id || profile.nationality) && (
                  <span className="inline-flex items-center gap-1.5">
                    <DualNationalityDisplay
                      primaryCountryId={profile.nationality_country_id}
                      secondaryCountryId={profile.nationality2_country_id}
                      fallbackText={profile.nationality}
                      className="text-gray-600"
                    />
                  </span>
                )}
                {profile.base_location && (
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="w-4 h-4 text-gray-400" />
                    {profile.base_location}
                  </span>
                )}
                {dobDisplay && (
                  <span className="inline-flex items-center gap-1.5">
                    <Calendar className="w-4 h-4 text-gray-400" />
                    {dobDisplay}
                    {age !== null && <span className="text-gray-400">· {age}y</span>}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Always-visible empty-state CTA for owners missing credentials ── */}
        {!readOnly && !hasCertification && (
          <section className="mt-6 bg-gradient-to-br from-amber-50 to-yellow-50 border border-amber-200 rounded-2xl p-5 md:p-6">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                <Shield className="w-5 h-5 text-amber-700" />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-semibold text-gray-900 mb-1">
                  Add your officiating credentials
                </h3>
                <p className="text-sm text-gray-700 mb-3">
                  Your level and federation are what clubs and fellow umpires look for first.
                  Take a minute now — you can always refine it later.
                </p>
                <button
                  type="button"
                  onClick={() => setShowEditModal(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-[#8026FA] to-[#924CEC] text-white text-sm font-medium hover:opacity-90 transition-opacity"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  Add credentials
                </button>
              </div>
            </div>
          </section>
        )}

        {/* ── Tabs ── */}
        <div className="mt-6 bg-white rounded-2xl shadow-sm animate-slide-in-up">
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

          <div className="p-5 md:p-7">
            {activeTab === 'profile' && (
              <div className="space-y-10 animate-fade-in">
                {hasCertification ? (
                  <section>
                    <h2 className="text-2xl font-bold text-gray-900 mb-5 inline-flex items-center gap-2">
                      <Shield className="w-6 h-6 text-amber-700" />
                      Certification &amp; Level
                    </h2>
                    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                      {profile.umpire_level && (
                        <div>
                          <dt className="text-sm font-medium text-gray-500 mb-1">Level</dt>
                          <dd className="text-gray-900 font-medium">{profile.umpire_level}</dd>
                        </div>
                      )}
                      {profile.federation && (
                        <div>
                          <dt className="text-sm font-medium text-gray-500 mb-1">Federation</dt>
                          <dd className="text-gray-900 font-medium">{profile.federation}</dd>
                        </div>
                      )}
                      {profile.umpire_since && (
                        <div>
                          <dt className="text-sm font-medium text-gray-500 mb-1">Umpiring since</dt>
                          <dd className="text-gray-900 font-medium">{profile.umpire_since}</dd>
                        </div>
                      )}
                      {specLabel && (
                        <div>
                          <dt className="text-sm font-medium text-gray-500 mb-1">Specialization</dt>
                          <dd className="text-gray-900 font-medium">{specLabel}</dd>
                        </div>
                      )}
                    </dl>
                  </section>
                ) : (
                  <section className="text-sm text-gray-500">
                    No certification details yet.
                  </section>
                )}

                {/* Trusted References — visible on public/network view, since
                    credentials + peer vouching is the umpire's primary trust
                    spine. Matches Player's PublicReferencesSection placement. */}
                {readOnly && (
                  <PublicReferencesSection
                    profileId={profile.id}
                    profileName={profile.full_name ?? null}
                  />
                )}

                {hasBio && (
                  <section>
                    <h2 className="text-2xl font-bold text-gray-900 mb-4">About</h2>
                    <p className="text-gray-700 leading-relaxed whitespace-pre-line">{profile.bio}</p>
                  </section>
                )}

                {hasLanguages && (
                  <section>
                    <h2 className="text-2xl font-bold text-gray-900 mb-4 inline-flex items-center gap-2">
                      <LanguagesIcon className="w-6 h-6 text-gray-500" />
                      Languages
                    </h2>
                    <div className="flex flex-wrap gap-2">
                      {profile.languages!.map((lang) => (
                        <span
                          key={lang}
                          className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700"
                        >
                          {lang}
                        </span>
                      ))}
                    </div>
                  </section>
                )}

                {/* Gallery inline on public view — matches Player readOnly pattern. */}
                {readOnly && (
                  <section>
                    <MediaTab
                      profileId={profile.id}
                      readOnly
                      showVideo={false}
                      showGallery
                      isOwnProfile={isOwnProfile}
                      viewerRole="umpire"
                    />
                  </section>
                )}

                {/* Posts inline on public view — matches Player readOnly pattern. */}
                {readOnly && (
                  <section className="pt-6 border-t border-gray-200">
                    <h2 className="text-2xl font-bold text-gray-900 mb-4">Posts</h2>
                    <ProfilePostsTab profileId={profile.id} readOnly />
                  </section>
                )}
              </div>
            )}

            {activeTab === 'officiating' && (
              <div className="animate-fade-in">
                {/* UmpireAppointmentsSection already renders its own card styling
                    (mt-6 bg-white rounded-2xl shadow-sm). Wrapping here would
                    double the chrome, so we let it stand on its own. The
                    outer tab panel already provides the container. */}
                <UmpireAppointmentsSection
                  userId={profile.id}
                  readOnly={readOnly}
                  isOwnProfile={isOwnProfile}
                />
              </div>
            )}

            {activeTab === 'gallery' && (
              <div className="animate-fade-in">
                <MediaTab
                  profileId={profile.id}
                  readOnly={readOnly}
                  showVideo={false}
                  showGallery
                  isOwnProfile={isOwnProfile}
                  viewerRole="umpire"
                />
              </div>
            )}

            {activeTab === 'friends' && (
              <div className="animate-fade-in">
                <FriendsTab
                  profileId={profile.id}
                  readOnly={readOnly}
                  profileRole="umpire"
                />
              </div>
            )}

            {activeTab === 'comments' && (
              <div className="animate-fade-in">
                <CommentsTab profileId={profile.id} profileRole="umpire" />
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

      {!readOnly && (
        <EditProfileModal
          isOpen={showEditModal}
          onClose={() => setShowEditModal(false)}
          role="umpire"
        />
      )}

      <SignInPromptModal
        isOpen={showSignInPrompt}
        onClose={() => setShowSignInPrompt(false)}
        title="Sign in to message"
        message="Sign in or create a free HOCKIA account to connect with this umpire."
      />
    </div>
  )
}
