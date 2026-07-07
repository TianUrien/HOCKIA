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
import { requestCache } from '../lib/requestCache'
import { PUBLIC_PROFILE_TTL, publicProfileCacheKey, safeSeedPublicProfile, rememberBlockedPair } from '../lib/publicProfileCache'
import type { Profile } from '../lib/supabase'
import UmpireDashboard, { type UmpireProfileShape } from './UmpireDashboard'
import { useAuthStore } from '../lib/auth'
import { trackDbEvent } from '../lib/trackDbEvent'
import { trackProfileView, trackPublicProfileViewed } from '../lib/analytics'
import { usePublicProfileMeta } from '@/hooks/usePublicProfileMeta'
import PublicProfileFooterCTA from '@/components/profile/PublicProfileFooterCTA'

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
    | 'umpiring_categories'
  > & {
    is_test_account?: boolean
    // Server-computed age (get_profile_ages) — raw DOB is owner-only.
    server_age?: number | null
  }

// SELECT list moved to `client/src/lib/publicProfileFields.ts` (see note
// in PublicPlayerProfile.tsx for rationale).
import { PUBLIC_UMPIRE_FIELDS } from '@/lib/publicProfileFields'

export default function PublicUmpireProfile() {
  const { username, id } = useParams<{ username?: string; id?: string }>()
  const navigate = useNavigate()
  const { profile: currentUserProfile } = useAuthStore()
  const isCurrentUserTestAccount = currentUserProfile?.is_test_account ?? false
  // Staging shows test accounts to everyone for QA.
  const isStaging = import.meta.env.VITE_SUPABASE_URL?.includes('ivjkdaylalhsteyyclvl')

  // Cache key for the public umpire row. Computed up front so the FIRST render can
  // SEED from cache synchronously — otherwise a fresh mount (crossing routes) paints
  // one full-screen spinner frame before the effect's peek runs.
  const cacheKey = publicProfileCacheKey('public-umpire', { username, id })

  // Only seed the cached row when it's SAFE to paint for this viewer — test gate +
  // (for a logged-in viewer) a recent block check said not-blocked.
  const seededProfile = safeSeedPublicProfile<PublicUmpireShape>(cacheKey, {
    viewerId: currentUserProfile?.id,
    viewerIsTest: isCurrentUserTestAccount,
    isStaging,
  })
  const [profile, setProfile] = useState<PublicUmpireShape | null>(seededProfile)
  const [isLoading, setIsLoading] = useState(!seededProfile)
  const [error, setError] = useState<string | null>(null)

  // Pure: returns block status, sets no state (so a late check from a previous
  // profile can't stamp an error onto the one you navigated to).
  const checkBlocked = async (myId: string, otherId: string): Promise<boolean> => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any).rpc('is_blocked_pair', { p_user_a: myId, p_user_b: otherId })
      return !!data
    } catch { /* fail open */ return false }
  }

  useEffect(() => {
    let cancelled = false
    const fetchProfile = async () => {
      if (!cacheKey) {
        setError('Invalid profile URL')
        setIsLoading(false)
        return
      }

      // Warm-cache fast path — paint from cache ONLY when it's safe for this viewer
      // (test gate + cached-not-blocked); otherwise show the loader and gate below.
      const cached = safeSeedPublicProfile<PublicUmpireShape>(cacheKey, {
        viewerId: currentUserProfile?.id,
        viewerIsTest: isCurrentUserTestAccount,
        isStaging,
      })
      if (cached) {
        setProfile(cached)
        setIsLoading(false)
      } else {
        setIsLoading(true)
      }
      setError(null)

      try {
        // Viewer-independent umpire row, cached per umpire across navigations.
        // Not-found returns null (negative cache); transient errors throw, not cached.
        const typed = await requestCache.dedupe<PublicUmpireShape | null>(
          cacheKey,
          async () => {
            const base = supabase
              .from('profiles')
              .select(PUBLIC_UMPIRE_FIELDS)
              .eq('role', 'umpire')
            const { data, error: fetchError } = await (
              username ? base.eq('username', username) : base.eq('id', id!)
            ).single()
            if (fetchError) {
              if (fetchError.code === 'PGRST116') return null
              throw fetchError
            }
            // Age is server-computed (raw DOB is owner-only post age-gate).
            const profileId = (data as unknown as { id: string }).id
            const { data: ages } = await supabase.rpc('get_profile_ages', { p_ids: [profileId] })
            const serverAge = ages?.find((a) => a.profile_id === profileId)?.age ?? null
            return { ...(data as object), server_age: serverAge } as unknown as PublicUmpireShape
          },
          PUBLIC_PROFILE_TTL,
        )
        if (cancelled) return

        if (!typed) {
          setProfile(null)
          setError('Umpire profile not found.')
          return
        }
        if (typed.is_test_account && !isCurrentUserTestAccount && !isStaging) {
          setProfile(null)
          setError('Umpire profile not found.')
          return
        }
        // Block check (per viewer pair). Remember the result so the NEXT visit gates
        // the cache seed synchronously and never flashes a blocked profile.
        if (currentUserProfile) {
          const blocked = await checkBlocked(currentUserProfile.id, typed.id)
          if (cancelled) return
          rememberBlockedPair(currentUserProfile.id, typed.id, blocked)
          if (blocked) {
            setProfile(null)
            setError('This profile is not available.')
            return
          }
        }
        setProfile(typed)
      } catch (err) {
        if (cancelled) return
        logger.error('Error fetching umpire profile:', err)
        setError('Failed to load umpire profile. Please try again.')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    fetchProfile()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, id, isCurrentUserTestAccount, currentUserProfile?.id])

  // Track profile view (skip own profile)
  const isOwnProfile = currentUserProfile?.id === profile?.id
  useEffect(() => {
    if (!profile || isOwnProfile) return
    const ref = new URLSearchParams(window.location.search).get('ref') || 'direct'
    trackDbEvent('profile_view', 'profile', profile.id, { viewed_role: 'umpire', source: ref })
    void trackProfileView('umpire', profile.id)
    if (!currentUserProfile) trackPublicProfileViewed('umpire')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  usePublicProfileMeta({
    displayName: profile?.full_name ?? null,
    roleLabel: 'umpire',
    description: profile?.bio ?? null,
    canonicalUrl: profile
      ? `https://inhockia.com/umpires/${profile.username || `id/${profile.id}`}`
      : undefined,
  })

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
    <>
      <UmpireDashboard
        profileData={profile as UmpireProfileShape}
        readOnly={true}
        isOwnProfile={isOwnProfile}
      />
      <PublicProfileFooterCTA />
    </>
  )
}
