/**
 * PublicUmpireProfile
 *
 * Read-only public view for umpire profiles. Mirrors PublicClubProfile's
 * shape (single role, no ambiguous player/coach fallthrough). Fetches
 * with an explicit `role = 'umpire'` filter so player/coach rows can't
 * bleed in if a URL collision ever occurs.
 */

import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { logger } from '../lib/logger'
import type { Profile } from '../lib/supabase'
import UmpireDashboard, { type UmpireProfileShape } from './UmpireDashboard'
import { useAuthStore } from '../lib/auth'
import { trackDbEvent } from '../lib/trackDbEvent'
import { trackProfileView } from '../lib/analytics'

type PublicUmpireShape = Partial<Profile> &
  Pick<
    Profile,
    | 'id'
    | 'role'
    | 'username'
    | 'full_name'
    | 'avatar_url'
    | 'base_location'
    | 'bio'
    | 'nationality'
    | 'nationality_country_id'
    | 'nationality2_country_id'
    | 'gender'
    | 'date_of_birth'
  > & { is_test_account?: boolean }

const PUBLIC_UMPIRE_FIELDS = [
  'id',
  'role',
  'username',
  'full_name',
  'avatar_url',
  'base_location',
  'bio',
  'nationality',
  'nationality_country_id',
  'nationality2_country_id',
  'gender',
  'date_of_birth',
  'social_links',
  'is_test_account',
  'is_verified',
  'verified_at',
  'umpire_level',
  'federation',
  'umpire_since',
  'officiating_specialization',
  'languages',
  'last_officiated_at',
  'umpire_appointment_count',
  'accepted_reference_count',
].join(',')

export default function PublicUmpireProfile() {
  const { username, id } = useParams<{ username?: string; id?: string }>()
  const navigate = useNavigate()
  const { profile: currentUserProfile } = useAuthStore()
  const isCurrentUserTestAccount = currentUserProfile?.is_test_account ?? false
  const [profile, setProfile] = useState<PublicUmpireShape | null>(null)
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
        if (username) {
          const { data, error: fetchError } = await supabase
            .from('profiles')
            .select(PUBLIC_UMPIRE_FIELDS)
            .eq('role', 'umpire')
            .eq('username', username)
            .single()

          if (fetchError) {
            if (fetchError.code === 'PGRST116') {
              setError('Umpire profile not found.')
            } else {
              throw fetchError
            }
            return
          }

          const typed = data as unknown as PublicUmpireShape
          if (typed.is_test_account && !isCurrentUserTestAccount) {
            setError('Umpire profile not found.')
            return
          }
          if (currentUserProfile && await checkBlocked(currentUserProfile.id, typed.id)) return
          setProfile(typed)
        } else if (id) {
          const { data, error: fetchError } = await supabase
            .from('profiles')
            .select(PUBLIC_UMPIRE_FIELDS)
            .eq('role', 'umpire')
            .eq('id', id)
            .single()

          if (fetchError) {
            if (fetchError.code === 'PGRST116') {
              setError('Umpire profile not found.')
            } else {
              throw fetchError
            }
            return
          }

          const typed = data as unknown as PublicUmpireShape
          if (typed.is_test_account && !isCurrentUserTestAccount) {
            setError('Umpire profile not found.')
            return
          }
          if (currentUserProfile && await checkBlocked(currentUserProfile.id, typed.id)) return
          setProfile(typed)
        } else {
          setError('Invalid profile URL')
          return
        }
      } catch (err) {
        logger.error('Error fetching umpire profile:', err)
        setError('Failed to load umpire profile. Please try again.')
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
    trackDbEvent('profile_view', 'profile', profile.id, { viewed_role: 'umpire', source: ref })
    trackProfileView('umpire', profile.id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-gray-300 border-t-amber-600 mb-4"></div>
          <p className="text-gray-600">Loading umpire profile...</p>
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
            {error || 'This umpire profile could not be found.'}
          </p>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-2 px-6 py-3 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Go Back
          </button>
        </div>
      </div>
    )
  }

  // Pass the umpire-specific columns through via the cast — UmpireDashboard
  // narrow-casts them again internally. Safe: we fetched them above and the
  // dashboard treats missing fields as "not set" rather than crashing.
  return (
    <UmpireDashboard
      profileData={profile as UmpireProfileShape}
      readOnly={true}
      isOwnProfile={isOwnProfile}
    />
  )
}
