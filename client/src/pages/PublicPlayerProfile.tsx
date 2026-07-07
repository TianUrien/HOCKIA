import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { logger } from '../lib/logger'
import { requestCache } from '../lib/requestCache'
import { PUBLIC_PROFILE_TTL, publicProfileCacheKey, safeSeedPublicProfile, rememberBlockedPair } from '../lib/publicProfileCache'
import type { Profile } from '../lib/supabase'
import PlayerDashboard, { type PlayerProfileShape } from './PlayerDashboard'
import CoachDashboard from './CoachDashboard'
import { useAuthStore } from '../lib/auth'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'
import { trackDbEvent } from '../lib/trackDbEvent'
import { trackProfileView, trackPublicProfileViewed } from '../lib/analytics'
import { usePublicProfileMeta } from '@/hooks/usePublicProfileMeta'
import PublicProfileFooterCTA from '@/components/profile/PublicProfileFooterCTA'

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
  | 'playing_category'
  | 'coaching_categories'
  | 'position'
  | 'secondary_position'
  | 'specialist_skills'
  | 'contact_email'
  | 'contact_email_public'
  | 'open_to_play'
  | 'open_to_coach'
  | 'last_active_at'
  | 'accepted_reference_count'
  | 'career_entry_count'
> & {
  is_test_account?: boolean
  is_verified?: boolean | null
  verified_at?: string | null
  // Server-computed age (get_profile_ages) — raw DOB is owner-only.
  server_age?: number | null
}

type PublicPlayerProfileShape = PublicProfileBase & { role: 'player' }
type PublicCoachProfileShape = PublicProfileBase & { role: 'coach' }

type PublicProfile = PublicPlayerProfileShape | PublicCoachProfileShape

// SELECT list moved to `client/src/lib/publicProfileFields.ts` so a
// regression test can import the constant without dragging the .tsx page
// into the test bundle (and to satisfy the react-refresh lint rule).
import { PUBLIC_PROFILE_FIELDS } from '@/lib/publicProfileFields'

export default function PublicPlayerProfile() {
  const { username, id } = useParams<{ username?: string; id?: string }>()
  const navigate = useNavigate()
  const { profile: currentUserProfile } = useAuthStore()
  const isCurrentUserTestAccount = currentUserProfile?.is_test_account ?? false
  // Staging shows test accounts to everyone for QA.
  const isStaging = import.meta.env.VITE_SUPABASE_URL?.includes('ivjkdaylalhsteyyclvl')

  // Cache key for the public profile row. Computed up front so the FIRST render can
  // SEED from cache synchronously — otherwise a fresh mount (e.g. tapping "View
  // Profile" from the Community preview, which crosses routes) paints one full-screen
  // spinner frame before the effect's peek runs.
  const cacheKey = publicProfileCacheKey('public-profile', { username, id })

  // Only seed the cached row when it's SAFE to paint for this viewer — the test gate
  // passes and (for a logged-in viewer) a recent block check said not-blocked — so a
  // blocked/hidden profile never flashes before the async gate runs.
  const seededProfile = safeSeedPublicProfile<PublicProfile>(cacheKey, {
    viewerId: currentUserProfile?.id,
    viewerIsTest: isCurrentUserTestAccount,
    isStaging,
  })
  const [profile, setProfile] = useState<PublicProfile | null>(seededProfile)
  const [isLoading, setIsLoading] = useState(!seededProfile)
  const [error, setError] = useState<string | null>(null)

  // Tab title resolves to the player/coach name once loaded; falls back
  // to a neutral "Player" / "Coach" while the fetch resolves so the tab
  // doesn't flash the static index.html title.
  const profileRoleLabel = profile?.role === 'coach' ? 'Coach' : 'Player'
  useDocumentTitle(profile?.full_name ? `${profile.full_name} • ${profileRoleLabel}` : profileRoleLabel)

  // Pure: returns the block status, sets no state (so a late-resolving check from a
  // previous profile can't stamp an error onto the profile you navigated to).
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
      // (test gate + cached-not-blocked); otherwise show the loader and let the async
      // gate below decide, so a blocked/hidden profile never flashes.
      const cached = safeSeedPublicProfile<PublicProfile>(cacheKey, {
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
        // The profiles row is viewer-independent, so it's cached per-profile and
        // shared across navigations. Not-found is returned as null (cheap negative
        // cache); transient errors throw and are NOT cached.
        const typed = await requestCache.dedupe<PublicProfile | null>(
          cacheKey,
          async () => {
            const base = supabase
              .from('profiles')
              .select(PUBLIC_PROFILE_FIELDS)
              .in('role', ['player', 'coach']) // Support both players and coaches
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
            return { ...(data as object), server_age: serverAge } as unknown as PublicProfile
          },
          PUBLIC_PROFILE_TTL,
        )
        if (cancelled) return

        if (!typed) {
          setProfile(null)
          setError('Profile not found.')
          return
        }

        // Test-profile gating (per viewer)
        if (typed.is_test_account && !isCurrentUserTestAccount && !isStaging) {
          setProfile(null)
          setError('Profile not found.')
          return
        }

        // Block check (per viewer pair). Remember the result so the NEXT visit can
        // gate the cache seed synchronously and never flash a blocked profile.
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
        logger.error('Error fetching profile:', err)
        setError('Failed to load profile. Please try again.')
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
    trackDbEvent('profile_view', 'profile', profile.id, { viewed_role: profile.role, source: ref })
    void trackProfileView(profile.role, profile.id)
    // Anon-only counterpart — fires for external/share-link visitors so we
    // can measure the share funnel without logging identifying info.
    if (!currentUserProfile) trackPublicProfileViewed(profile.role)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  // Per-profile <title> + OG meta description for WhatsApp/Slack/iMessage previews.
  // Per-profile OG image deferred to v2 — link previews still use the site default.
  usePublicProfileMeta({
    displayName: profile?.full_name ?? null,
    roleLabel: profile?.role ?? 'player',
    description: profile?.bio ?? null,
    canonicalUrl: profile
      ? `https://inhockia.com/${profile.role === 'coach' ? 'coaches' : 'players'}/${profile.username || `id/${profile.id}`}`
      : undefined,
  })

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

  // Coerce nullable verification fields to the stricter shape the dashboard
  // components expect (boolean | undefined, not boolean | null). Same trick
  // for both player and coach paths below.
  const verifiedBoolean = profile.is_verified ?? undefined
  const verifiedAtString = profile.verified_at ?? undefined

  if (profile.role === 'coach') {
    return (
      <>
        <CoachDashboard
          profileData={{
            ...profile,
            email: '',
            contact_email_public: profile.contact_email_public ?? false,
            is_verified: verifiedBoolean,
            verified_at: verifiedAtString,
          }}
          readOnly={true}
          isOwnProfile={isOwnProfile}
        />
        <PublicProfileFooterCTA />
      </>
    )
  }

  const playerProfileData: PlayerProfileShape = {
    ...profile,
    email: '',
    contact_email_public: profile.contact_email_public ?? false,
    is_verified: verifiedBoolean,
    verified_at: verifiedAtString,
  }

  return (
    <>
      <PlayerDashboard profileData={playerProfileData} readOnly={true} isOwnProfile={isOwnProfile} viewerRole={currentUserProfile?.role ?? null} />
      <PublicProfileFooterCTA />
    </>
  )
}
