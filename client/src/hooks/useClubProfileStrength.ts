import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import type { Profile } from '@/lib/supabase'

export interface ProfileStrengthBucket {
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
  /** Optional action id the parent can handle (e.g. "edit-profile", "gallery-tab") */
  actionId?: string
  /** Label for the CTA button */
  actionLabel?: string
}

type ClubProfile = Pick<
  Profile,
  | 'id'
  | 'nationality'
  | 'nationality_country_id'
  | 'base_location'
  | 'year_founded'
  | 'website'
  | 'contact_email'
  | 'avatar_url'
  | 'club_bio'
> & {
  womens_league_division?: string | null
  mens_league_division?: string | null
}

interface UseClubProfileStrengthOptions {
  profile: ClubProfile | null
}

/**
 * Club-specific profile strength calculation.
 *
 * Buckets (v1 - no vacancies or players/friends):
 * - Basic Info (35%): nationality, base_location, year_founded, women/men league (optional), website OR contact_email
 * - Club Logo (25%): avatar_url present
 * - Club Bio (20%): club_bio field filled
 * - Photo Gallery (20%): at least 1 club_media entry
 */
export function useClubProfileStrength({ profile }: UseClubProfileStrengthOptions) {
  const [galleryCount, setGalleryCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  const profileId = profile?.id ?? null

  // Fetch gallery count
  const fetchCounts = useCallback(async () => {
    if (!profileId) {
      setGalleryCount(null)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      // Club uses club_media table, not gallery_photos
      const { count } = await supabase
        .from('club_media')
        .select('id', { count: 'exact', head: true })
        .eq('club_id', profileId)

      setGalleryCount(count ?? 0)
    } finally {
      setLoading(false)
    }
  }, [profileId])

  useEffect(() => {
    void fetchCounts()
  }, [fetchCounts])

  /**
   * Basic Info is complete when:
   * - nationality (country) is filled
   * - base_location (city) is filled
   * - year_founded is filled
    * - women/men league divisions are optional
   * - website OR contact_email (at least one) exists
   */
  const isBasicInfoComplete = useCallback(() => {
    if (!profile) return false
    const { nationality, nationality_country_id, base_location, year_founded, website, contact_email } = profile

    // Accept either new country_id field OR legacy nationality text field
    const hasCountry = Boolean(nationality_country_id || nationality?.trim())
    const hasCity = Boolean(base_location?.trim())
    const hasYearFounded = Boolean(year_founded)
    const hasContactMethod = Boolean(website?.trim() || contact_email?.trim())

    // All required fields must be present
    return hasCountry && hasCity && hasYearFounded && hasContactMethod
  }, [profile])

  // Check club logo
  const hasClubLogo = useCallback(() => {
    if (!profile) return false
    return Boolean(profile.avatar_url?.trim())
  }, [profile])

  // Check club bio
  const hasClubBio = useCallback(() => {
    if (!profile) return false
    return Boolean(profile.club_bio?.trim())
  }, [profile])

  // Build buckets
  const buckets: ProfileStrengthBucket[] = useMemo(() => {
    const basicComplete = isBasicInfoComplete()
    const logoComplete = hasClubLogo()
    const bioComplete = hasClubBio()
    const galleryComplete = (galleryCount ?? 0) >= 1

    return [
      {
        id: 'basic',
        label: 'Basic Info',
        hint: 'Complete country, city, year founded, and add website or contact email',
        unlockCopy: 'Players filter by country, city, and league when looking for opportunities.',
        weight: 35,
        completed: basicComplete,
        actionId: 'edit-profile',
        actionLabel: 'Edit Profile',
      },
      {
        id: 'logo',
        label: 'Club Logo',
        hint: 'Upload your club logo',
        unlockCopy: 'A recognisable logo makes your club stand out in searches.',
        weight: 25,
        completed: logoComplete,
        actionId: 'edit-profile',
        actionLabel: 'Add Logo',
      },
      {
        id: 'about',
        label: 'About the Club',
        hint: 'Add a description about your club',
        unlockCopy: 'Players understand your story and what the club stands for.',
        weight: 20,
        completed: bioComplete,
        actionId: 'edit-profile',
        actionLabel: 'Add Description',
      },
      {
        id: 'gallery',
        label: 'Photo Gallery',
        hint: 'Upload at least one photo to your gallery',
        unlockCopy: 'Show your ground, training sessions, and match days.',
        weight: 20,
        completed: galleryComplete,
        actionId: 'gallery-section',
        actionLabel: 'Add Photos',
      },
    ]
  }, [isBasicInfoComplete, hasClubLogo, hasClubBio, galleryCount])

  // Calculate total percentage
  const percentage = useMemo(() => {
    return buckets.reduce((acc, b) => acc + (b.completed ? b.weight : 0), 0)
  }, [buckets])

  return {
    /** Overall completion percentage (0-100) */
    percentage,
    /** Individual bucket states */
    buckets,
    /** True while fetching gallery count */
    loading,
    /** Re-fetch counts (call after updates) */
    refresh: fetchCounts,
  }
}
