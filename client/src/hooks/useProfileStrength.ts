import { useMemo } from 'react'
import { useGalleryCount } from '@/hooks/useGalleryCount'
import { useProfileT } from '@/i18n/ns/profile'
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
 * Checks the canonical "nationality + base location" bucket for a player.
 * Mirrors compute_profile_completeness_pct: (nationality_country_id OR
 * nationality) AND base_location. Position is a SEPARATE canonical bucket.
 */
function isBasicInfoComplete(profile: Profile): boolean {
  // Accept either new country_id field OR legacy nationality text field
  const hasNationality = Boolean(profile.nationality_country_id || profile.nationality?.trim())
  const hasLocation = Boolean(profile.base_location?.trim())
  return hasNationality && hasLocation
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
 * 2d-bis: the buckets mirror the canonical SQL formula
 * (compute_profile_completeness_pct, player branch) EXACTLY, so the owner's
 * dashboard % equals the public Community-card %. Twelve weighted buckets
 * summing to 100:
 *   nat+loc 10 · position 5 · photo 10 · bio 5 · current club 5 ·
 *   highlight video 15 · full-match footage 10 · career history 10 ·
 *   gallery 5 · friends 5 · references 15 · open-to-play 5
 */
export function useProfileStrength(profile: Profile | null): ProfileStrengthResult {
  // Read denormalized counts directly from the profile row (trigger-maintained).
  // Only gallery_photos still requires a query since it's not denormalized —
  // useGalleryCount is the shared React Query fetch, so every dashboard
  // consumer (this hook, MediaCard once migrated) shares one round trip.
  const journeyCount: number = profile?.career_entry_count ?? 0
  const friendCount: number = profile?.accepted_friend_count ?? 0
  const referenceCount: number = profile?.accepted_reference_count ?? 0
  // full_game_video_count is denormalized on profiles, same trigger pattern
  // as the others — no extra query needed.
  const fullGameVideoCount: number = profile?.full_game_video_count ?? 0

  const t = useProfileT()
  const { count, loading, refresh } = useGalleryCount(profile?.id)
  const galleryCount = count ?? 0

  const buckets = useMemo<ProfileStrengthBucket[]>(() => {
    if (!profile) {
      return []
    }

    // Buckets mirror the canonical SQL formula (compute_profile_completeness_pct,
    // player branch) EXACTLY so the owner's dashboard % equals the public card %
    // (2d-bis). Weights: nat+loc 10 · position 5 · photo 10 · bio 5 · club 5 ·
    // highlight 15 · full-match 10 · gallery 5 · career 10 · friends 5 · refs 15
    // · open_to_play 5 = 100.
    return [
      {
        id: 'basic-info',
        label: t('useProfileStrength.basicInfo.label'),
        description: t('useProfileStrength.basicInfo.description'),
        unlockCopy: t('useProfileStrength.basicInfo.unlockCopy'),
        weight: 10,
        completed: isBasicInfoComplete(profile),
        action: { type: 'edit-profile' },
      },
      {
        id: 'position',
        label: t('useProfileStrength.position.label'),
        description: t('useProfileStrength.position.description'),
        unlockCopy: t('useProfileStrength.position.unlockCopy'),
        weight: 5,
        completed: Boolean(profile.position?.trim()),
        action: { type: 'edit-profile' },
      },
      {
        id: 'profile-photo',
        label: t('useProfileStrength.photo.label'),
        description: t('useProfileStrength.photo.description'),
        unlockCopy: t('useProfileStrength.photo.unlockCopy'),
        weight: 10,
        completed: hasProfilePhoto(profile),
        action: { type: 'edit-profile' },
      },
      {
        id: 'bio',
        label: t('useProfileStrength.bio.label'),
        noun: t('useProfileStrength.bio.noun'),
        description: t('useProfileStrength.bio.description'),
        unlockCopy: t('useProfileStrength.bio.unlockCopy'),
        weight: 5,
        completed: Boolean(profile.bio?.trim()),
        action: { type: 'edit-profile' },
      },
      {
        id: 'current-club',
        label: t('useProfileStrength.currentClub.label'),
        description: t('useProfileStrength.currentClub.description'),
        unlockCopy: t('useProfileStrength.currentClub.unlockCopy'),
        weight: 5,
        completed: Boolean(profile.current_club?.trim()),
        action: { type: 'edit-profile' },
      },
      {
        id: 'highlight-video',
        label: t('useProfileStrength.highlightVideo.label'),
        noun: t('useProfileStrength.highlightVideo.noun'),
        description: t('useProfileStrength.highlightVideo.description'),
        unlockCopy: t('useProfileStrength.highlightVideo.unlockCopy'),
        weight: 15,
        completed: hasHighlightVideo(profile),
        action: { type: 'add-video' },
      },
      {
        // Recruiters consistently rate full-match footage as the single
        // strongest signal of how a player actually performs over 60+ min
        // — beyond a curated reel. Action routes to the Media tab where
        // FullGameVideosSection lives (inside MediaTab).
        id: 'full-match-footage',
        label: t('useProfileStrength.fullMatch.label'),
        noun: t('useProfileStrength.fullMatch.noun'),
        description: t('useProfileStrength.fullMatch.description'),
        unlockCopy: t('useProfileStrength.fullMatch.unlockCopy'),
        weight: 10,
        completed: fullGameVideoCount > 0,
        action: { type: 'tab', tab: 'media' },
      },
      {
        id: 'journey',
        label: t('useProfileStrength.journey.label'),
        description: t('useProfileStrength.journey.description'),
        unlockCopy: t('useProfileStrength.journey.unlockCopy'),
        weight: 10,
        completed: journeyCount > 0,
        action: { type: 'tab', tab: 'journey' },
      },
      {
        id: 'media-gallery',
        label: t('useProfileStrength.gallery.label'),
        description: t('useProfileStrength.gallery.description'),
        unlockCopy: t('useProfileStrength.gallery.unlockCopy'),
        weight: 5,
        completed: galleryCount > 0,
        // Gallery lives in MediaTab now (was inline in the old Profile
        // tab before the Bento Grid restructure).
        action: { type: 'tab', tab: 'media' },
      },
      {
        id: 'friends',
        label: t('useProfileStrength.friends.label'),
        description: t('useProfileStrength.friends.description'),
        unlockCopy: t('useProfileStrength.friends.unlockCopy'),
        weight: 5,
        completed: friendCount > 0,
        action: { type: 'tab', tab: 'friends' },
      },
      {
        id: 'references',
        label: t('useProfileStrength.references.label'),
        // Plural noun reads naturally in "Profiles with trusted references
        // tend to..." — the imperative label would render as "Profiles with
        // get a trusted reference tend to..." which is ungrammatical.
        noun: t('useProfileStrength.references.noun'),
        description: t('useProfileStrength.references.description'),
        unlockCopy: t('useProfileStrength.references.unlockCopy'),
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
        label: t('useProfileStrength.availability.label'),
        description: t('useProfileStrength.availability.description'),
        unlockCopy: t('useProfileStrength.availability.unlockCopy'),
        weight: 5,
        completed: profile.open_to_play === true,
        action: { type: 'tab', tab: 'profile' },
      },
    ]
  }, [profile, journeyCount, galleryCount, friendCount, referenceCount, fullGameVideoCount, t])

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
