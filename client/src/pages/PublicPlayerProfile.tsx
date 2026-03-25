import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { logger } from '../lib/logger'
import type { Profile } from '../lib/supabase'
import PlayerDashboard, { type PlayerProfileShape } from './PlayerDashboard'
import CoachDashboard from './CoachDashboard'
import { useAuthStore } from '../lib/auth'
import { trackDbEvent } from '../lib/trackDbEvent'
import { trackProfileView } from '../lib/analytics'

type PublicProfileBase = Pick<
  Profile,
  | 'id'
  | 'role'
  | 'username'
  | 'full_name'
  | 'avatar_url'
  | 'base_location'
  | 'bio'
  | 'highlight_video_url'
  | 'highlight_visibility'
  | 'nationality'
  | 'nationality_country_id'
  | 'nationality2_country_id'
  | 'current_club'
  | 'gender'
  | 'date_of_birth'
  | 'position'
  | 'secondary_position'
  | 'contact_email'
  | 'contact_email_public'
  | 'open_to_play'
  | 'open_to_coach'
> & { is_test_account?: boolean }

type PublicPlayerProfileShape = PublicProfileBase & { role: 'player' }
type PublicCoachProfileShape = PublicProfileBase & { role: 'coach' }

type PublicProfile = PublicPlayerProfileShape | PublicCoachProfileShape

const PUBLIC_PROFILE_FIELDS = [
  'id',
  'role',
  'username',
  'full_name',
  'avatar_url',
  'base_location',
  'bio',
  'highlight_video_url',
  'highlight_visibility',
  'nationality',
  'nationality_country_id',
  'nationality2_country_id',
  'current_club',
  'current_world_club_id',
  'gender',
  'date_of_birth',
  'position',
  'secondary_position',
  'contact_email',
  'contact_email_public',
  'social_links',
  'is_test_account',
  'open_to_play',
  'open_to_coach',
  'coach_specialization',
  'coach_specialization_custom'
].join(',')

export default function PublicPlayerProfile() {
  const { username, id } = useParams<{ username?: string; id?: string }>()
  const navigate = useNavigate()
  const { profile: currentUserProfile } = useAuthStore()
  const isCurrentUserTestAccount = currentUserProfile?.is_test_account ?? false
  const [profile, setProfile] = useState<PublicProfile | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const checkBlocked = async (myId: string, otherId: string): Promise<boolean> => {
    try {
      const { data } = await (supabase as any).rpc('is_blocked_pair', { p_user_a: myId, p_user_b: otherId })
      if (data) {
        setError('This profile is not available.')
        return true
      }
    } catch { /* fail open */ }
    return false
  }

  useEffect(() => {
    const fetchProfile = async () => {
      setIsLoading(true)
      setError(null)

      try {
        // Fetch by username (preferred) or fallback to ID
        if (username) {
          const { data, error: fetchError } = await supabase
            .from('profiles')
            .select(PUBLIC_PROFILE_FIELDS)
            .in('role', ['player', 'coach']) // Support both players and coaches
            .eq('username', username)
            .single()

          if (fetchError) {
            if (fetchError.code === 'PGRST116') {
              setError('Profile not found.')
            } else {
              throw fetchError
            }
            return
          }

          const typed = data as unknown as PublicProfile

          // Check if this is a test profile and current user is not a test account
          if (typed.is_test_account && !isCurrentUserTestAccount) {
            setError('Profile not found.')
            return
          }

          // Block check
          if (currentUserProfile && await checkBlocked(currentUserProfile.id, typed.id)) return

          setProfile(typed)
        } else if (id) {
          const { data, error: fetchError } = await supabase
            .from('profiles')
            .select(PUBLIC_PROFILE_FIELDS)
            .in('role', ['player', 'coach']) // Support both players and coaches
            .eq('id', id)
            .single()

          if (fetchError) {
            if (fetchError.code === 'PGRST116') {
              setError('Profile not found.')
            } else {
              throw fetchError
            }
            return
          }

          const typed = data as unknown as PublicProfile

          // Check if this is a test profile and current user is not a test account
          if (typed.is_test_account && !isCurrentUserTestAccount) {
            setError('Profile not found.')
            return
          }

          // Block check
          if (currentUserProfile && await checkBlocked(currentUserProfile.id, typed.id)) return

          setProfile(typed)
        } else {
          setError('Invalid profile URL')
          return
        }
      } catch (err) {
        logger.error('Error fetching profile:', err)
        setError('Failed to load profile. Please try again.')
      } finally {
        setIsLoading(false)
      }
    }

    fetchProfile()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, id, isCurrentUserTestAccount, currentUserProfile?.id])

  // Track profile view (skip own profile)
  const isOwnProfile = currentUserProfile?.id === profile?.id
  useEffect(() => {
    if (!profile || isOwnProfile) return
    const ref = new URLSearchParams(window.location.search).get('ref') || 'direct'
    trackDbEvent('profile_view', 'profile', profile.id, { viewed_role: profile.role, source: ref })
    trackProfileView(profile.role, profile.id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-gray-300 border-t-blue-600 mb-4"></div>
          <p className="text-gray-600">Loading profile...</p>
        </div>
      </div>
    )
  }

  if (error || !profile) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md mx-auto px-4">
          <div className="text-6xl mb-4">🏑</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Profile Not Found</h2>
          <p className="text-gray-600 mb-6">
            {error || 'Profile not found.'}
          </p>
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Go Back
          </button>
        </div>
      </div>
    )
  }

  if (profile.role === 'coach') {
    return <CoachDashboard profileData={{ ...profile, email: '', contact_email_public: profile.contact_email_public ?? false }} readOnly={true} isOwnProfile={isOwnProfile} />
  }

  const playerProfileData: PlayerProfileShape = {
    ...profile,
    email: '',
    contact_email_public: profile.contact_email_public ?? false,
  }

  return <PlayerDashboard profileData={playerProfileData} readOnly={true} isOwnProfile={isOwnProfile} viewerRole={currentUserProfile?.role ?? null} />
}
