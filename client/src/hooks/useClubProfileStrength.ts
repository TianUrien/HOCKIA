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
  // 2d-bis canonical inputs — optional so a looser ClubProfileShape (where
  // these are optional/absent) stays assignable.
  contact_email_public?: boolean | null
  bio?: string | null
  post_count?: number | null
  accepted_friend_count?: number | null
}

interface UseClubProfileStrengthOptions {
  profile: ClubProfile | null
}

/**
 * Club-specific profile strength calculation.
 *
 * 2d-bis: buckets mirror the canonical SQL formula (club branch) EXACTLY so
 * the owner's dashboard % equals the public Community-card %. Nine buckets
 * summing to 100:
 *   logo 15 · about (club_bio/bio) 20 · location 10 · country 5 ·
 *   year founded 10 · contact/website 10 · media 15 · posts 10 · friends 5
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

  // Check club logo
  const hasClubLogo = useCallback(() => {
    if (!profile) return false
    return Boolean(profile.avatar_url?.trim())
  }, [profile])

  // Canonical "about" bucket: club_bio OR bio.
  const hasClubBio = useCallback(() => {
    if (!profile) return false
    return Boolean(profile.club_bio?.trim() || profile.bio?.trim())
  }, [profile])

  // Build buckets — mirror the canonical SQL formula (club branch) EXACTLY so
  // the owner % equals the public card % (2d-bis). The old single "basic 35"
  // is split into the four canonical buckets (location 10 · country 5 · year 10
  // · contact 10), and posts + friends are added.
  const buckets: ProfileStrengthBucket[] = useMemo(() => {
    const logoComplete = hasClubLogo()
    const bioComplete = hasClubBio()
    const galleryComplete = (galleryCount ?? 0) >= 1
    // Canonical contact bucket: contact_email counts only when public; else website.
    const hasContact = Boolean(
      (profile?.contact_email?.trim() && profile?.contact_email_public === true) ||
        profile?.website?.trim(),
    )

    return [
      {
        id: 'logo',
        label: 'Club Logo',
        hint: 'Upload your club logo',
        unlockCopy: 'A recognisable logo makes your club stand out in searches.',
        weight: 15,
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
        id: 'location',
        label: 'Add your city',
        hint: 'Set the club\'s base location',
        unlockCopy: 'Players filter by location when looking for a club.',
        weight: 10,
        completed: Boolean(profile?.base_location?.trim()),
        actionId: 'edit-profile',
        actionLabel: 'Add Location',
      },
      {
        id: 'country',
        label: 'Add your country',
        hint: 'Set the club\'s country',
        unlockCopy: 'Helps players in your country find you.',
        weight: 5,
        completed: Boolean(profile?.nationality_country_id),
        actionId: 'edit-profile',
        actionLabel: 'Add Country',
      },
      {
        id: 'year-founded',
        label: 'Add the year founded',
        hint: 'When was the club established?',
        unlockCopy: 'Adds credibility and history to your profile.',
        weight: 10,
        completed: Boolean(profile?.year_founded),
        actionId: 'edit-profile',
        actionLabel: 'Add Year',
      },
      {
        id: 'contact',
        label: 'Add a contact method',
        hint: 'Add a public contact email or a website',
        unlockCopy: 'Lets players and recruiters reach out about opportunities.',
        weight: 10,
        completed: hasContact,
        actionId: 'edit-profile',
        actionLabel: 'Add Contact',
      },
      {
        id: 'gallery',
        label: 'Photo Gallery',
        hint: 'Upload at least one photo to your gallery',
        unlockCopy: 'Show your ground, training sessions, and match days.',
        weight: 15,
        completed: galleryComplete,
        actionId: 'gallery-section',
        actionLabel: 'Add Photos',
      },
      {
        id: 'posts',
        label: 'Share your first post',
        hint: 'Post an update to your club feed',
        unlockCopy: 'An active club feed shows players you are alive and recruiting.',
        weight: 10,
        completed: (profile?.post_count ?? 0) > 0,
        actionId: 'edit-profile',
        actionLabel: 'Create Post',
      },
      {
        id: 'friends',
        label: 'Make your first connection',
        hint: 'Connect with players or coaches',
        unlockCopy: 'Builds your club network on HOCKIA.',
        weight: 5,
        completed: (profile?.accepted_friend_count ?? 0) > 0,
        actionId: 'edit-profile',
        actionLabel: 'Add Connection',
      },
    ]
  }, [hasClubLogo, hasClubBio, galleryCount, profile?.base_location, profile?.nationality_country_id, profile?.year_founded, profile?.contact_email, profile?.contact_email_public, profile?.website, profile?.post_count, profile?.accepted_friend_count])

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
