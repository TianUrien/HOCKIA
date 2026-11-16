import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import type { Profile } from '@/lib/supabase'
import { useWorldT } from '@/i18n/ns/world'

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
  const t = useWorldT()
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
        label: t('club.strength.logo.label'),
        hint: t('club.strength.logo.hint'),
        unlockCopy: t('club.strength.logo.unlock'),
        weight: 15,
        completed: logoComplete,
        actionId: 'edit-profile',
        actionLabel: t('club.strength.logo.action'),
      },
      {
        id: 'about',
        label: t('club.strength.about.label'),
        hint: t('club.strength.about.hint'),
        unlockCopy: t('club.strength.about.unlock'),
        weight: 20,
        completed: bioComplete,
        actionId: 'edit-profile',
        actionLabel: t('club.strength.about.action'),
      },
      {
        id: 'location',
        label: t('club.strength.location.label'),
        hint: t('club.strength.location.hint'),
        unlockCopy: t('club.strength.location.unlock'),
        weight: 10,
        completed: Boolean(profile?.base_location?.trim()),
        actionId: 'edit-profile',
        actionLabel: t('club.strength.location.action'),
      },
      {
        id: 'country',
        label: t('club.strength.country.label'),
        hint: t('club.strength.country.hint'),
        unlockCopy: t('club.strength.country.unlock'),
        weight: 5,
        completed: Boolean(profile?.nationality_country_id),
        actionId: 'edit-profile',
        actionLabel: t('club.strength.country.action'),
      },
      {
        id: 'year-founded',
        label: t('club.strength.yearFounded.label'),
        hint: t('club.strength.yearFounded.hint'),
        unlockCopy: t('club.strength.yearFounded.unlock'),
        weight: 10,
        completed: Boolean(profile?.year_founded),
        actionId: 'edit-profile',
        actionLabel: t('club.strength.yearFounded.action'),
      },
      {
        id: 'contact',
        label: t('club.strength.contact.label'),
        hint: t('club.strength.contact.hint'),
        unlockCopy: t('club.strength.contact.unlock'),
        weight: 10,
        completed: hasContact,
        actionId: 'edit-profile',
        actionLabel: t('club.strength.contact.action'),
      },
      {
        id: 'gallery',
        label: t('club.strength.gallery.label'),
        hint: t('club.strength.gallery.hint'),
        unlockCopy: t('club.strength.gallery.unlock'),
        weight: 15,
        completed: galleryComplete,
        actionId: 'gallery-section',
        actionLabel: t('club.strength.gallery.action'),
      },
      {
        id: 'posts',
        label: t('club.strength.posts.label'),
        hint: t('club.strength.posts.hint'),
        unlockCopy: t('club.strength.posts.unlock'),
        weight: 10,
        completed: (profile?.post_count ?? 0) > 0,
        actionId: 'edit-profile',
        actionLabel: t('club.strength.posts.action'),
      },
      {
        id: 'friends',
        label: t('club.strength.friends.label'),
        hint: t('club.strength.friends.hint'),
        unlockCopy: t('club.strength.friends.unlock'),
        weight: 5,
        completed: (profile?.accepted_friend_count ?? 0) > 0,
        actionId: 'edit-profile',
        actionLabel: t('club.strength.friends.action'),
      },
    ]
  }, [t, hasClubLogo, hasClubBio, galleryCount, profile?.base_location, profile?.nationality_country_id, profile?.year_founded, profile?.contact_email, profile?.contact_email_public, profile?.website, profile?.post_count, profile?.accepted_friend_count])

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
