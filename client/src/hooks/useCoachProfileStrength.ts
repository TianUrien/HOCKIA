import { useCallback, useMemo } from 'react'
import { useGalleryCount } from '@/hooks/useGalleryCount'
import { useProfileT } from '@/i18n/ns/profile'
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
  const t = useProfileT()
  const profileId = profile?.id ?? null

  // Gallery count is the only remaining query — shared React Query fetch
  // (useGalleryCount): one round trip per dashboard, refresh() joins any
  // in-flight fetch instead of racing it (the aa52843 contract).
  const { count: galleryCount, loading, refresh } = useGalleryCount(profileId)

  // Read denormalized counts directly from the profile row (trigger-maintained).
  // Only gallery_photos still requires a query since it's not denormalized.
  const journeyCount: number = profile?.career_entry_count ?? 0
  const referenceCount: number = profile?.accepted_reference_count ?? 0
  const friendCount: number = profile?.accepted_friend_count ?? 0

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
        label: t('useCoachProfileStrength.basic.label'),
        hint: t('useCoachProfileStrength.basic.hint'),
        unlockCopy: t('useCoachProfileStrength.basic.unlockCopy'),
        weight: 10,
        completed: basicComplete,
        actionId: 'edit-profile',
        actionLabel: t('useCoachProfileStrength.basic.actionLabel'),
      },
      {
        id: 'specialization',
        label: t('useCoachProfileStrength.focus.label'),
        hint: t('useCoachProfileStrength.focus.hint'),
        unlockCopy: t('useCoachProfileStrength.focus.unlockCopy'),
        weight: 10,
        completed: focusComplete,
        actionId: 'edit-profile',
        actionLabel: t('useCoachProfileStrength.focus.actionLabel'),
      },
      {
        id: 'photo',
        label: t('useCoachProfileStrength.photo.label'),
        hint: t('useCoachProfileStrength.photo.hint'),
        unlockCopy: t('useCoachProfileStrength.photo.unlockCopy'),
        weight: 10,
        completed: photoComplete,
        actionId: 'edit-profile',
        actionLabel: t('useCoachProfileStrength.photo.actionLabel'),
      },
      {
        id: 'bio',
        label: t('useCoachProfileStrength.bio.label'),
        hint: t('useCoachProfileStrength.bio.hint'),
        unlockCopy: t('useCoachProfileStrength.bio.unlockCopy'),
        weight: 10,
        completed: bioComplete,
        actionId: 'edit-profile',
        actionLabel: t('useCoachProfileStrength.bio.actionLabel'),
      },
      {
        id: 'current-club',
        label: t('useCoachProfileStrength.currentClub.label'),
        hint: t('useCoachProfileStrength.currentClub.hint'),
        unlockCopy: t('useCoachProfileStrength.currentClub.unlockCopy'),
        weight: 10,
        completed: Boolean(profile?.current_club?.trim()),
        actionId: 'edit-profile',
        actionLabel: t('useCoachProfileStrength.currentClub.actionLabel'),
      },
      {
        id: 'journey',
        label: t('useCoachProfileStrength.journey.label'),
        hint: t('useCoachProfileStrength.journey.hint'),
        unlockCopy: t('useCoachProfileStrength.journey.unlockCopy'),
        weight: 15,
        completed: journeyComplete,
        actionId: 'journey-tab',
        actionLabel: t('useCoachProfileStrength.journey.actionLabel'),
      },
      {
        id: 'gallery',
        label: t('useCoachProfileStrength.gallery.label'),
        hint: t('useCoachProfileStrength.gallery.hint'),
        unlockCopy: t('useCoachProfileStrength.gallery.unlockCopy'),
        weight: 5,
        completed: galleryComplete,
        actionId: 'gallery-tab',
        actionLabel: t('useCoachProfileStrength.gallery.actionLabel'),
      },
      {
        id: 'friends',
        label: t('useCoachProfileStrength.friends.label'),
        hint: t('useCoachProfileStrength.friends.hint'),
        unlockCopy: t('useCoachProfileStrength.friends.unlockCopy'),
        weight: 5,
        completed: friendsComplete,
        actionId: 'friends-tab',
        actionLabel: t('useCoachProfileStrength.friends.actionLabel'),
      },
      {
        id: 'references',
        label: t('useCoachProfileStrength.references.label'),
        hint: t('useCoachProfileStrength.references.hint'),
        unlockCopy: t('useCoachProfileStrength.references.unlockCopy'),
        weight: 15,
        completed: referencesComplete,
        actionId: 'friends-tab',
        actionLabel: t('useCoachProfileStrength.references.actionLabel'),
      },
      {
        id: 'availability',
        label: t('useCoachProfileStrength.availability.label'),
        hint: t('useCoachProfileStrength.availability.hint'),
        unlockCopy: t('useCoachProfileStrength.availability.unlockCopy'),
        weight: 10,
        completed: profile?.open_to_coach === true,
        actionId: 'profile-tab',
        actionLabel: t('useCoachProfileStrength.availability.actionLabel'),
      },
    ]
  }, [isBasicInfoComplete, hasCoachingFocus, hasProfilePhoto, hasProfessionalBio, journeyCount, galleryCount, referenceCount, friendCount, profile?.current_club, profile?.open_to_coach, t])

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
