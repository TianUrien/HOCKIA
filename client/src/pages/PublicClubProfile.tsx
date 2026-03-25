import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { logger } from '../lib/logger'
import type { Profile } from '../lib/supabase'
import ClubDashboard from './ClubDashboard'
import { useAuthStore } from '../lib/auth'
import { trackDbEvent } from '../lib/trackDbEvent'
import { trackProfileView } from '../lib/analytics'

type PublicClubProfile = Partial<Profile> &
  Pick<
    Profile,
    | 'id'
    | 'role'
    | 'username'
    | 'full_name'
    | 'avatar_url'
    | 'base_location'
    | 'nationality'
    | 'nationality_country_id'
    | 'club_bio'
    | 'club_history'
    | 'website'
    | 'year_founded'
    | 'contact_email'
    | 'contact_email_public'
  > & {
    womens_league_division?: string | null
    mens_league_division?: string | null
  }

const PUBLIC_CLUB_FIELDS = [
  'id',
  'role',
  'username',
  'full_name',
  'avatar_url',
  'base_location',
  'nationality',
  'nationality_country_id',
  'club_bio',
  'club_history',
  'website',
  'year_founded',
  'womens_league_division',
  'mens_league_division',
  'contact_email',
  'contact_email_public',
  'social_links',
  'is_test_account'
].join(',')

export default function PublicClubProfile() {
  const { username, id } = useParams<{ username?: string; id?: string }>()
  const navigate = useNavigate()
  const { profile: currentUserProfile } = useAuthStore()
  const isCurrentUserTestAccount = currentUserProfile?.is_test_account ?? false
  const [profile, setProfile] = useState<PublicClubProfile | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const checkBlocked = async (myId: string, otherId: string): Promise<boolean> => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
            .select(PUBLIC_CLUB_FIELDS)
            .eq('role', 'club')
            .eq('username', username)
            .single()

          if (fetchError) {
            if (fetchError.code === 'PGRST116') {
              setError('Club profile not found.')
            } else {
              throw fetchError
            }
            return
          }

          const typed = data as unknown as PublicClubProfile

          // Check if this is a test profile and current user is not a test account
          if (typed.is_test_account && !isCurrentUserTestAccount) {
            setError('Club profile not found.')
            return
          }

          // Block check
          if (currentUserProfile && await checkBlocked(currentUserProfile.id, typed.id)) return

          setProfile(typed)
        } else if (id) {
          const { data, error: fetchError } = await supabase
            .from('profiles')
            .select(PUBLIC_CLUB_FIELDS)
            .eq('role', 'club')
            .eq('id', id)
            .single()

          if (fetchError) {
            if (fetchError.code === 'PGRST116') {
              setError('Club profile not found.')
            } else {
              throw fetchError
            }
            return
          }

          const typed = data as unknown as PublicClubProfile

          // Check if this is a test profile and current user is not a test account
          if (typed.is_test_account && !isCurrentUserTestAccount) {
            setError('Club profile not found.')
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
        logger.error('Error fetching club profile:', err)
        setError('Failed to load club profile. Please try again.')
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
    trackDbEvent('profile_view', 'profile', profile.id, { viewed_role: 'club', source: ref })
    trackProfileView('club', profile.id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-gray-300 border-t-purple-600 mb-4"></div>
          <p className="text-gray-600">Loading club profile...</p>
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
            {error || 'This club profile could not be found.'}
          </p>
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-2 px-6 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Go Back
          </button>
        </div>
      </div>
    )
  }

  return (
    <ClubDashboard
      profileData={{
        ...profile,
        email: '',
        contact_email_public: profile.contact_email_public ?? false,
        nationality_country_id: profile.nationality_country_id ?? null,
      }}
      readOnly={true}
      isOwnProfile={isOwnProfile}
    />
  )
}
