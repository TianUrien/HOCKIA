import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import type { CoachProfileShape } from '@/pages/CoachDashboard'
import type { Profile } from '@/lib/supabase'

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
 * Buckets:
 * - Basic Info (15%): full_name, nationality, base_location, date_of_birth, gender
 * - Specialization (10%): coach_specialization selected
 * - Profile Photo (15%): avatar_url present
 * - Professional Bio (15%): bio field filled
 * - Experience/Journey (20%): at least 1 career_history entry
 * - Media Gallery (10%): at least 1 gallery_photos entry
 * - References (15%): at least 1 accepted reference
 */
export function useCoachProfileStrength({ profile }: UseCoachProfileStrengthOptions) {
  const [galleryCount, setGalleryCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  const profileId = profile?.id ?? null

  // Read denormalized counts directly from the profile row (trigger-maintained).
  // Only gallery_photos still requires a query since it's not denormalized.
  const journeyCount: number = profile?.career_entry_count ?? 0
  const referenceCount: number = profile?.accepted_reference_count ?? 0

  // Fetch gallery count (only remaining query needed)
  const fetchCounts = useCallback(async () => {
    if (!profileId) {
      setGalleryCount(null)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const galleryRes = await supabase
        .from('gallery_photos')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', profileId)
      setGalleryCount(galleryRes.count ?? 0)
    } finally {
      setLoading(false)
    }
  }, [profileId])

  useEffect(() => {
    void fetchCounts()
  }, [fetchCounts])

  // Check if all basic info fields are filled
  const isBasicInfoComplete = useCallback(() => {
    if (!profile) return false
    const { full_name, nationality, nationality_country_id, base_location, date_of_birth, gender } = profile
    // Accept either new country_id field OR legacy nationality text field
    const hasNationality = Boolean(nationality_country_id || nationality?.trim())
    return Boolean(
      full_name?.trim() &&
        hasNationality &&
        base_location?.trim() &&
        date_of_birth?.trim() &&
        gender?.trim()
    )
  }, [profile])

  // Check profile photo
  const hasProfilePhoto = useCallback(() => {
    if (!profile) return false
    return Boolean(profile.avatar_url?.trim())
  }, [profile])

  // Check specialization
  const hasSpecialization = useCallback(() => {
    if (!profile) return false
    return Boolean((profile as Partial<Profile>).coach_specialization)
  }, [profile])

  // Check professional bio
  const hasProfessionalBio = useCallback(() => {
    if (!profile) return false
    return Boolean(profile.bio?.trim())
  }, [profile])

  // Build buckets
  const buckets: ProfileBucket[] = useMemo(() => {
    const basicComplete = isBasicInfoComplete()
    const specializationComplete = hasSpecialization()
    const photoComplete = hasProfilePhoto()
    const bioComplete = hasProfessionalBio()
    const journeyComplete = (journeyCount ?? 0) >= 1
    const galleryComplete = (galleryCount ?? 0) >= 1
    const referencesComplete = (referenceCount ?? 0) >= 1

    return [
      {
        id: 'basic',
        label: 'Basic Info',
        hint: 'Complete name, nationality, location, DOB, and gender',
        unlockCopy: 'Clubs filter for coaches by nationality, location, and availability.',
        weight: 15,
        completed: basicComplete,
        actionId: 'edit-profile',
        actionLabel: 'Edit Profile',
      },
      {
        id: 'specialization',
        label: 'Specialization',
        hint: 'Select your coaching specialization',
        unlockCopy: 'Head coach, assistant, coaching staff — clubs search by specialization.',
        weight: 10,
        completed: specializationComplete,
        actionId: 'edit-profile',
        actionLabel: 'Set Specialization',
      },
      {
        id: 'photo',
        label: 'Profile Photo',
        hint: 'Upload a profile photo',
        unlockCopy: 'Helps clubs put a face to your name.',
        weight: 15,
        completed: photoComplete,
        actionId: 'edit-profile',
        actionLabel: 'Add Photo',
      },
      {
        id: 'bio',
        label: 'Professional Bio',
        hint: 'Add a bio about your coaching background',
        unlockCopy: 'Gives clubs a feel for your coaching style and experience.',
        weight: 15,
        completed: bioComplete,
        actionId: 'edit-profile',
        actionLabel: 'Add Bio',
      },
      {
        id: 'journey',
        label: 'Experience / Journey',
        hint: 'Add at least one experience entry',
        unlockCopy: 'Shows where you have coached and the teams you have developed.',
        weight: 20,
        completed: journeyComplete,
        actionId: 'journey-tab',
        actionLabel: 'Add Experience',
      },
      {
        id: 'gallery',
        label: 'Media Gallery',
        hint: 'Upload at least one gallery photo',
        unlockCopy: 'Match photos, training sessions, moments from your career.',
        weight: 10,
        completed: galleryComplete,
        actionId: 'gallery-tab',
        actionLabel: 'Add Media',
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
    ]
  }, [isBasicInfoComplete, hasSpecialization, hasProfilePhoto, hasProfessionalBio, journeyCount, galleryCount, referenceCount])

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
    /** Re-fetch counts (call after updates) */
    refresh: fetchCounts,
  }
}
