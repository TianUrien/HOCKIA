import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { logger } from '../lib/logger'
import { requestCache } from '../lib/requestCache'
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
  | 'date_of_birth'
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
}

type PublicPlayerProfileShape = PublicProfileBase & { role: 'player' }
type PublicCoachProfileShape = PublicProfileBase & { role: 'coach' }

type PublicProfile = PublicPlayerProfileShape | PublicCoachProfileShape

// SELECT list moved to `client/src/lib/publicProfileFields.ts` so a
// regression test can import the constant without dragging the .tsx page
// into the test bundle (and to satisfy the react-refresh lint rule).
import { PUBLIC_PROFILE_FIELDS } from '@/lib/publicProfileFields'

// Cache the public profile row across navigation so revisiting a profile renders
// instantly from memory instead of a full-screen spinner + refetch. Keyed per
// profile (the row is viewer-independent); the per-viewer test/block gating still
// runs each visit. 2-min TTL — profiles change rarely, and the owner edits via
// their own dashboard, not this public page.
const PUBLIC_PROFILE_TTL = 120_000

export default function PublicPlayerProfile() {
  const { username, id } = useParams<{ username?: string; id?: string }>()
  const navigate = useNavigate()
  const { profile: currentUserProfile } = useAuthStore()
  const isCurrentUserTestAccount = currentUserProfile?.is_test_account ?? false
  // Staging shows test accounts to everyone for QA.
  const isStaging = import.meta.env.VITE_SUPABASE_URL?.includes('ivjkdaylalhsteyyclvl')
  const [profile, setProfile] = useState<PublicProfile | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Tab title resolves to the player/coach name once loaded; falls back
  // to a neutral "Player" / "Coach" while the fetch resolves so the tab
  // doesn't flash the static index.html title.
  const profileRoleLabel = profile?.role === 'coach' ? 'Coach' : 'Player'
  useDocumentTitle(profile?.full_name ? `${profile.full_name} • ${profileRoleLabel}` : profileRoleLabel)

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
    const cacheKey = username
      ? `public-profile-uname-${username}`
      : id
        ? `public-profile-id-${id}`
        : null

    const fetchProfile = async () => {
      if (!cacheKey) {
        setError('Invalid profile URL')
        setIsLoading(false)
        return
      }

      // Warm-cache fast path: render the previously-fetched row instantly so a
      // revisit doesn't flash a full-screen spinner. The per-viewer gating
      // (test/block) below still runs; it just no longer gates first paint.
      const cached = requestCache.peek<PublicProfile>(cacheKey)
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
            return data as unknown as PublicProfile
          },
          PUBLIC_PROFILE_TTL,
        )

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

        // Block check (per viewer pair) — checkBlocked sets the error itself.
        if (currentUserProfile && await checkBlocked(currentUserProfile.id, typed.id)) {
          setProfile(null)
          return
        }

        setProfile(typed)
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
