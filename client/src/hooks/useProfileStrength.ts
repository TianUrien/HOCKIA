import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { requestCache } from '@/lib/requestCache'
import type { Profile } from '@/lib/supabase'

export type ProfileStrengthBucket = {
  id: string
  /** Imperative CTA label, e.g. "Get a trusted reference". Used by
   *  NextStepCard's "Next step" heading. */
  label: string
  /** Optional noun-phrase form of the bucket name, e.g. "trusted references"
   *  for the references bucket. Used by ProfileHealthCard's comparative
   *  copy where the imperative `label` would read awkwardly
   *  ("Profiles with get a trusted reference tend to..."). Only the
   *  high-recruiter-signal buckets need to provide this; others fall
   *  back to label.toLowerCase() in the comparative line. */
  noun?: string
  description: string
  /** Honest, conservative line describing what completing this step unlocks for the user */
  unlockCopy: string
  weight: number
  completed: boolean
  /** Navigation target when clicking this item (tab name or action) */
  action: ProfileStrengthAction
}

export type ProfileStrengthAction =
  | { type: 'edit-profile' }
  | { type: 'tab'; tab: string }
  | { type: 'add-video' }

export type ProfileStrengthResult = {
  /** Overall completion percentage (0-100) */
  percentage: number
  /** Individual bucket completion status */
  buckets: ProfileStrengthBucket[]
  /** Whether the data is still loading */
  loading: boolean
  /** Refresh the profile strength calculation */
  refresh: () => Promise<void>
}

/**
 * Checks if the basic info bucket is complete for a player.
 * Requires: nationality (or nationality_country_id), base_location, and at least one position.
 */
function isBasicInfoComplete(profile: Profile): boolean {
  // Accept either new country_id field OR legacy nationality text field
  const hasNationality = Boolean(profile.nationality_country_id || profile.nationality?.trim())
  const hasLocation = Boolean(profile.base_location?.trim())
  const hasPosition = Boolean(profile.position?.trim())
  return hasNationality && hasLocation && hasPosition
}

/**
 * Checks if the profile has a photo.
 */
function hasProfilePhoto(profile: Profile): boolean {
  return Boolean(profile.avatar_url?.trim())
}

/**
 * Checks if the profile has a highlight video.
 */
function hasHighlightVideo(profile: Profile): boolean {
  return Boolean(profile.highlight_video_url?.trim())
}

/**
 * Hook to calculate profile strength/completion for Player profiles.
 *
 * The strength is calculated from 9 weighted buckets, biased toward
 * recruitment-grade content (highlight + full-match video, references,
 * availability) over identity basics:
 *
 * - Basic Info (10%): nationality, base_location, position
 * - Profile Photo (10%): avatar_url
 * - Highlight Video (20%): highlight_video_url
 * - Full Match Footage (15%): at least one player_full_game_videos row
 * - Journey (10%): at least one career_history entry
 * - Media Gallery (5%): at least one gallery_photos entry
 *   (was 10%, reduced 2026-05-08 to make room for Availability — gallery
 *   is lower-impact than the other buckets as a recruiter signal)
 * - Friends (10%): at least one accepted friend connection
 * - References (15%): at least one approved reference
 * - Availability (5%): open_to_play === true
 *   (added 2026-05-08 — recruiters filter directly on this boolean. A
 *   player marked Open is actively recruitable; one not marked might
 *   not even be visible to a "show me available defenders" query.
 *   Lower weight than content buckets because it's a single toggle.)
 *
 * Total = 100%.
 */
export function useProfileStrength(profile: Profile | null): ProfileStrengthResult {
  const [loading, setLoading] = useState(true)
  const [galleryCount, setGalleryCount] = useState<number>(0)

  // Read denormalized counts directly from the profile row (trigger-maintained).
  // Only gallery_photos still requires a query since it's not denormalized.
  const journeyCount: number = profile?.career_entry_count ?? 0
  const friendCount: number = profile?.accepted_friend_count ?? 0
  const referenceCount: number = profile?.accepted_reference_count ?? 0
  // full_game_video_count is denormalized on profiles, same trigger pattern
  // as the others — no extra query needed.
  const fullGameVideoCount: number = profile?.full_game_video_count ?? 0

  // Gallery count is the only remaining query (everything else lives
  // on the profile row). Deduped via requestCache so MediaCard + this
  // hook + the dashboard's tab-effect refresh share one round trip.
  // 30s TTL matches the Bento card batch (8ee75aa). refresh() below
  // busts the cache for explicit "I just edited" calls.
  const profileId = profile?.id ?? null
  const cacheKey = profileId ? `player-strength-gallery-${profileId}` : null

  const fetchCounts = useCallback(async () => {
    if (!profileId || !cacheKey) {
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
          if (galleryRes.error) throw galleryRes.error
          return galleryRes.count ?? 0
        },
        30000,
      )
      setGalleryCount(count)
    } catch (error) {
      logger.error('Error fetching profile strength data:', error)
    } finally {
      setLoading(false)
    }
  }, [profileId, cacheKey])

  // Force-fresh re-fetch — busts the cache first so explicit refresh()
  // calls (e.g. after an upload modal closes) skip the 30s window and
  // hit the DB directly.
  const refresh = useCallback(async () => {
    if (cacheKey) requestCache.invalidate(cacheKey)
    await fetchCounts()
  }, [cacheKey, fetchCounts])

  useEffect(() => {
    void fetchCounts()
  }, [fetchCounts])

  const buckets = useMemo<ProfileStrengthBucket[]>(() => {
    if (!profile) {
      return []
    }

    return [
      {
        id: 'basic-info',
        label: 'Basic info completed',
        description: 'Add your nationality, location, and playing position',
        unlockCopy: 'Clubs filter by position and location when they search for players.',
        weight: 10,
        completed: isBasicInfoComplete(profile),
        action: { type: 'edit-profile' },
      },
      {
        id: 'profile-photo',
        label: 'Add a profile photo',
        description: 'Help clubs recognize you with a profile picture',
        unlockCopy: 'Helps clubs put a face to your name.',
        weight: 10,
        completed: hasProfilePhoto(profile),
        action: { type: 'edit-profile' },
      },
      {
        id: 'highlight-video',
        label: 'Add your highlight video',
        noun: 'a highlight video',
        description: 'Show clubs what you can do on the pitch',
        unlockCopy: 'Clubs see how you play, not just read about it.',
        weight: 20,
        completed: hasHighlightVideo(profile),
        action: { type: 'add-video' },
      },
      {
        // Recruiters consistently rate full-match footage as the single
        // strongest signal of how a player actually performs over 60+ min
        // — beyond a curated reel. Action routes to the Media tab where
        // FullGameVideosSection lives (inside MediaTab).
        id: 'full-match-footage',
        label: 'Upload full match footage',
        noun: 'full match footage',
        description: 'Add at least one full game video so recruiters can see you play across a whole match',
        unlockCopy: 'Recruiters value full match footage above curated reels — it shows your work over a real game.',
        weight: 15,
        completed: fullGameVideoCount > 0,
        action: { type: 'tab', tab: 'media' },
      },
      {
        id: 'journey',
        label: 'Share a moment in your Journey',
        description: 'Add your career history, milestones, or achievements',
        unlockCopy: 'Shows where you have played and what you have achieved.',
        weight: 10,
        completed: journeyCount > 0,
        action: { type: 'tab', tab: 'journey' },
      },
      {
        id: 'media-gallery',
        label: 'Add a photo or video to your Gallery',
        description: 'Build your visual portfolio for clubs to see',
        unlockCopy: 'A visual portfolio beyond a single highlight clip.',
        weight: 5,
        completed: galleryCount > 0,
        // Gallery lives in MediaTab now (was inline in the old Profile
        // tab before the Bento Grid restructure).
        action: { type: 'tab', tab: 'media' },
      },
      {
        id: 'friends',
        label: 'Make your first connection',
        description: 'Add a friend to start building your trusted circle',
        unlockCopy: 'Coaches and clubs can see the teammates you play with.',
        weight: 10,
        completed: friendCount > 0,
        action: { type: 'tab', tab: 'friends' },
      },
      {
        id: 'references',
        label: 'Get a trusted reference',
        // Plural noun reads naturally in "Profiles with trusted references
        // tend to..." — the imperative label would render as "Profiles with
        // get a trusted reference tend to..." which is ungrammatical.
        noun: 'trusted references',
        description: 'Ask a coach or teammate to vouch for you',
        unlockCopy: 'A coach or teammate vouching for you carries weight with clubs.',
        weight: 15,
        completed: referenceCount > 0,
        // Routes to the dedicated References tab. Previously pointed to
        // Friends tab (where references used to render inline), but that
        // surface was split out — Friends tab now hides references and
        // shows only the per-friend "Ask to vouch" buttons, while
        // ReferencesTab owns the full management surface.
        action: { type: 'tab', tab: 'references' },
      },
      {
        // Open-to-Play is the single most-filtered boolean for recruiter
        // searches. A player not marked Open may never appear in a
        // "show me available defenders" query at all. Lighter weight (5%)
        // than content buckets because it's a single toggle, but earning
        // a visible bucket nudges the player to set it explicitly instead
        // of leaving it as the default false. Action routes to the
        // Profile tab where AvailabilityToggleStrip lives.
        id: 'availability',
        label: 'Mark yourself open to opportunities',
        description: 'Let clubs and coaches know you\'re open to play',
        unlockCopy: 'Recruiters filter for "Open to Play" — without it, you may not appear in their searches.',
        weight: 5,
        completed: profile.open_to_play === true,
        action: { type: 'tab', tab: 'profile' },
      },
    ]
  }, [profile, journeyCount, galleryCount, friendCount, referenceCount, fullGameVideoCount])

  const percentage = useMemo(() => {
    if (buckets.length === 0) return 0
    return buckets.reduce((acc, bucket) => acc + (bucket.completed ? bucket.weight : 0), 0)
  }, [buckets])

  return {
    percentage,
    buckets,
    loading,
    refresh,
  }
}
