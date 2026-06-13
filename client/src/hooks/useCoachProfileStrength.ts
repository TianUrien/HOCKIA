import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { requestCache } from '@/lib/requestCache'
import type { CoachProfileShape } from '@/pages/CoachDashboard'

export interface ProfileBucket {
  id: string
  label: string
  /** Description shown when incomplete */
  hint: string
  /** Honest, conservative line describing what completing this step unlocks for the user */
  unlockCopy: string
  /** Weight out of 100 */
  weight: number
  /** True when this bucket is fully completed */
  completed: boolean
  /** Optional action id the parent can handle (e.g. "add-bio", "open-gallery") */
  actionId?: string
  /** Label for the CTA button */
  actionLabel?: string
}

interface UseCoachProfileStrengthOptions {
  profile: CoachProfileShape | null
}

/**
 * Coach-specific profile strength calculation.
 *
 * 2d-bis: buckets mirror the canonical SQL formula (coach branch) EXACTLY so
 * the owner's dashboard % equals the public Community-card %. Ten buckets
 * summing to 100:
 *   nat+loc 10 · coaching focus 10 · photo 10 · bio 10 · current club 10 ·
 *   career history 15 · gallery 5 · friends 5 · references 15 · open-to-coach 10
 */
export function useCoachProfileStrength({ profile }: UseCoachProfileStrengthOptions) {
  const [galleryCount, setGalleryCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  const profileId = profile?.id ?? null

  // Read denormalized counts directly from the profile row (trigger-maintained).
  // Only gallery_photos still requires a query since it's not denormalized.
  const journeyCount: number = profile?.career_entry_count ?? 0
  const referenceCount: number = profile?.accepted_reference_count ?? 0
  const friendCount: number = profile?.accepted_friend_count ?? 0

  // Fetch gallery count (only remaining query needed). Deduped via
  // requestCache so multiple consumers on the same dashboard render
  // (e.g. MediaCard + this hook + the dashboard's tab-effect refresh)
  // share a single round trip. 30s TTL matches the Bento card batch
  // (8ee75aa) — auto-mounts within the window hit cache; refresh()
  // below busts the cache when the user explicitly returns from a
  // surface where they may have edited the gallery.
  const cacheKey = profileId ? `coach-strength-gallery-${profileId}` : null

  const fetchCounts = useCallback(async () => {
    if (!profileId || !cacheKey) {
      setGalleryCount(null)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const count = await requestCache.dedupe<number>(
        cacheKey,
        async () => {
          const galleryRes = await supabase
            .from('gallery_photos')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', profileId)
          return galleryRes.count ?? 0
        },
        30000,
      )
      setGalleryCount(count)
    } finally {
      setLoading(false)
    }
  }, [profileId, cacheKey])

  // refresh() needs two contracts at once:
  //   1) "I just edited" → bust the 30s cache, fetch fresh.
  //   2) Concurrent with the hook's auto-fetch on first mount → join
  //      the in-flight instead of racing it. The QA pass on aa52843
  //      caught the race: invalidate() also deletes the in-flight
  //      tracking, so two callers fired identical fetches.
  // Solution: only invalidate when there's no in-flight. The
  // in-flight entry IS the freshest data we can get; awaiting it via
  // dedupe() is correct.
  const refresh = useCallback(async () => {
    if (cacheKey && !requestCache.hasInflight(cacheKey)) {
      requestCache.invalidate(cacheKey)
    }
    await fetchCounts()
  }, [cacheKey, fetchCounts])

  useEffect(() => {
    void fetchCounts()
  }, [fetchCounts])

  // Canonical "nationality + base location" bucket (compute_profile_
  // completeness_pct, coach branch): (nationality_country_id OR nationality)
  // AND base_location. full_name / DOB / categories are NOT part of it.
  const isBasicInfoComplete = useCallback(() => {
    if (!profile) return false
    const { nationality, nationality_country_id, base_location } = profile
    const hasNationality = Boolean(nationality_country_id || nationality?.trim())
    return Boolean(hasNationality && base_location?.trim())
  }, [profile])

  // Check profile photo
  const hasProfilePhoto = useCallback(() => {
    if (!profile) return false
    return Boolean(profile.avatar_url?.trim())
  }, [profile])

  // Canonical "coaching focus" bucket: coaching_categories OR coach_specialization.
  const hasCoachingFocus = useCallback(() => {
    if (!profile) return false
    const cats = profile.coaching_categories
    return Boolean((Array.isArray(cats) && cats.length > 0) || profile.coach_specialization)
  }, [profile])

  // Check professional bio
  const hasProfessionalBio = useCallback(() => {
    if (!profile) return false
    return Boolean(profile.bio?.trim())
  }, [profile])

  // Build buckets — mirror the canonical SQL formula (coach branch) EXACTLY so
  // the owner % equals the public card % (2d-bis): nat+loc 10 · focus 10 ·
  // photo 10 · bio 10 · current club 10 · career 15 · gallery 5 · friends 5 ·
  // references 15 · open-to-coach 10 = 100.
  const buckets: ProfileBucket[] = useMemo(() => {
    const basicComplete = isBasicInfoComplete()
    const focusComplete = hasCoachingFocus()
    const photoComplete = hasProfilePhoto()
    const bioComplete = hasProfessionalBio()
    const journeyComplete = (journeyCount ?? 0) >= 1
    const galleryComplete = (galleryCount ?? 0) >= 1
    const referencesComplete = (referenceCount ?? 0) >= 1
    const friendsComplete = (friendCount ?? 0) >= 1

    return [
      {
        id: 'basic',
        label: 'Add your nationality and location',
        hint: 'Add your nationality and base location',
        unlockCopy: 'Clubs filter for coaches by location when they search.',
        weight: 10,
        completed: basicComplete,
        actionId: 'edit-profile',
        actionLabel: 'Edit Profile',
      },
      {
        id: 'specialization',
        label: 'Set your coaching focus',
        hint: 'Add your coaching specialization or the categories you coach',
        unlockCopy: 'Head coach, assistant, age groups — clubs search by coaching focus.',
        weight: 10,
        completed: focusComplete,
        actionId: 'edit-profile',
        actionLabel: 'Set Focus',
      },
      {
        id: 'photo',
        label: 'Profile Photo',
        hint: 'Upload a profile photo',
        unlockCopy: 'Helps clubs put a face to your name.',
        weight: 10,
        completed: photoComplete,
        actionId: 'edit-profile',
        actionLabel: 'Add Photo',
      },
      {
        id: 'bio',
        label: 'Professional Bio',
        hint: 'Add a bio about your coaching background',
        unlockCopy: 'Gives clubs a feel for your coaching style and experience.',
        weight: 10,
        completed: bioComplete,
        actionId: 'edit-profile',
        actionLabel: 'Add Bio',
      },
      {
        id: 'current-club',
        label: 'Add your current club',
        hint: 'Add the club or team you currently coach',
        unlockCopy: 'Shows clubs your current team and level.',
        weight: 10,
        completed: Boolean(profile?.current_club?.trim()),
        actionId: 'edit-profile',
        actionLabel: 'Add Club',
      },
      {
        id: 'journey',
        label: 'Career History',
        hint: 'Add at least one experience entry',
        unlockCopy: 'Shows where you have coached and the teams you have developed.',
        weight: 15,
        completed: journeyComplete,
        actionId: 'journey-tab',
        actionLabel: 'Add Experience',
      },
      {
        id: 'gallery',
        label: 'Media Gallery',
        hint: 'Upload at least one gallery photo',
        unlockCopy: 'Match photos, training sessions, moments from your career.',
        weight: 5,
        completed: galleryComplete,
        actionId: 'gallery-tab',
        actionLabel: 'Add Media',
      },
      {
        id: 'friends',
        label: 'Make your first connection',
        hint: 'Add a friend to start building your network',
        unlockCopy: 'Clubs can see the players and coaches you are connected with.',
        weight: 5,
        completed: friendsComplete,
        actionId: 'friends-tab',
        actionLabel: 'Add Connection',
      },
      {
        id: 'references',
        label: 'Get a trusted reference',
        hint: 'Ask a player or fellow coach to vouch for you',
        unlockCopy: 'Former players or clubs vouching for you builds trust fast.',
        weight: 15,
        completed: referencesComplete,
        actionId: 'friends-tab',
        actionLabel: 'Get Reference',
      },
      {
        id: 'availability',
        label: 'Mark yourself open to coach',
        hint: 'Let clubs know you are open to coaching opportunities',
        unlockCopy: 'Recruiters filter for "Open to Coach" — set it to appear in their searches.',
        weight: 10,
        completed: profile?.open_to_coach === true,
        actionId: 'profile-tab',
        actionLabel: 'Set Availability',
      },
    ]
  }, [isBasicInfoComplete, hasCoachingFocus, hasProfilePhoto, hasProfessionalBio, journeyCount, galleryCount, referenceCount, friendCount, profile?.current_club, profile?.open_to_coach])

  // Calculate total percentage
  const percentage = useMemo(() => {
    return buckets.reduce((acc, b) => acc + (b.completed ? b.weight : 0), 0)
  }, [buckets])

  return {
    /** Overall completion percentage (0-100) */
    percentage,
    /** Individual bucket states */
    buckets,
    /** True while fetching journey/gallery counts */
    loading,
    /** Force-fresh re-fetch — busts the dedupe cache first so callers
     *  who just mutated data (e.g. uploaded a gallery photo) see the
     *  truth, not a cached count. */
    refresh,
  }
}
