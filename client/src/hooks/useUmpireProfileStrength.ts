import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { requestCache } from '@/lib/requestCache'
import type { UmpireProfileShape } from '@/pages/UmpireDashboard'

export interface ProfileBucket {
  id: string
  label: string
  /** Description shown when incomplete */
  hint: string
  /** Honest, conservative line describing what completing this step unlocks */
  unlockCopy: string
  /** Weight out of the per-role total. Normalized to a 0–100 percentage. */
  weight: number
  /** True when this bucket is fully completed */
  completed: boolean
  /** Optional action id the parent can handle */
  actionId?: string
  /** Label for the CTA button */
  actionLabel?: string
}

interface UseUmpireProfileStrengthOptions {
  profile: UmpireProfileShape | null
}

/**
 * Umpire-specific profile strength calculation.
 *
 * 2d-bis: buckets mirror the canonical SQL formula (umpire branch) EXACTLY so
 * the owner's dashboard % equals the public Community-card %. Twelve buckets
 * summing to 100 (no normalization — raw sum):
 *   nat+loc 10 · level/categories 10 · federation 5 · specialization 5 ·
 *   photo 10 · bio 10 · career 10 · gallery 5 · friends 5 · references 15 ·
 *   available-for-appointments 5 · appointments 10
 *
 * (Was a /110 credentials-led formula with languages + years-officiating, which
 * the canonical formula doesn't score — dropped here to keep one number.)
 */
export function useUmpireProfileStrength({ profile }: UseUmpireProfileStrengthOptions) {
  const [galleryCount, setGalleryCount] = useState<number>(0)
  const [loading, setLoading] = useState<boolean>(Boolean(profile?.id))

  const profileId = profile?.id ?? null
  // Deduped via requestCache so MediaCard + this hook + the dashboard's
  // tab-effect refresh share one round trip. 30s TTL matches the Bento
  // card batch (8ee75aa). refresh() below busts the cache for explicit
  // post-upload calls.
  const cacheKey = profileId ? `umpire-strength-gallery-${profileId}` : null

  const fetchGalleryCount = useCallback(async () => {
    if (!profileId || !cacheKey) {
      setGalleryCount(0)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const count = await requestCache.dedupe<number>(
        cacheKey,
        async () => {
          const { count: c, error } = await supabase
            .from('gallery_photos')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', profileId)
          if (error) throw error
          return c ?? 0
        },
        30000,
      )
      setGalleryCount(count)
    } catch (error) {
      logger.error('[useUmpireProfileStrength] gallery count failed:', error)
      setGalleryCount(0)
    } finally {
      setLoading(false)
    }
  }, [profileId, cacheKey])

  // Force-fresh — bust the 30s cache so post-upload calls don't get
  // the cached value. Skip the invalidate when a fetch is already
  // in-flight (invalidate also nukes in-flight tracking, which raced
  // the hook's auto-fetch on first mount and produced duplicate
  // requests — QA caught the same race on the coach hook in aa52843).
  const refresh = useCallback(async () => {
    if (cacheKey && !requestCache.hasInflight(cacheKey)) {
      requestCache.invalidate(cacheKey)
    }
    await fetchGalleryCount()
  }, [cacheKey, fetchGalleryCount])

  useEffect(() => {
    void fetchGalleryCount()
  }, [fetchGalleryCount])

  // Buckets mirror the canonical SQL formula (umpire branch) EXACTLY so the
  // owner % equals the public card % (2d-bis): nat+loc 10 · level/categories 10
  // · federation 5 · specialization 5 · photo 10 · bio 10 · career 10 ·
  // gallery 5 · friends 5 · references 15 · available 5 · appointments 10 = 100.
  const buckets: ProfileBucket[] = useMemo(() => {
    const hasNationality = Boolean(profile?.nationality_country_id || profile?.nationality?.trim())
    const basic = hasNationality && Boolean(profile?.base_location?.trim())
    const levelOrCategories =
      Boolean(profile?.umpire_level?.trim()) || ((profile?.umpiring_categories?.length ?? 0) > 0)
    const federation = Boolean(profile?.federation?.trim())
    const specialization = Boolean(profile?.officiating_specialization?.trim())
    const photo = Boolean(profile?.avatar_url?.trim())
    const bio = Boolean(profile?.bio?.trim())
    const career = (profile?.career_entry_count ?? 0) >= 1
    const gallery = galleryCount >= 1
    const friends = (profile?.accepted_friend_count ?? 0) >= 1
    const references = (profile?.accepted_reference_count ?? 0) >= 1
    const available = profile?.available_for_appointments === true
    const appointments = (profile?.umpire_appointment_count ?? 0) >= 1

    return [
      {
        id: 'basic',
        label: 'Add your nationality and location',
        hint: 'Add your nationality and base location.',
        unlockCopy: 'Assigners and clubs filter by location.',
        weight: 10,
        completed: basic,
        actionId: 'edit-profile',
        actionLabel: 'Edit Profile',
      },
      {
        id: 'umpire-level',
        label: 'Umpire Level',
        hint: 'Add your certification level or the categories you officiate.',
        unlockCopy: 'Level is the first thing clubs and fellow umpires look for.',
        weight: 10,
        completed: levelOrCategories,
        actionId: 'edit-profile',
        actionLabel: 'Add Level',
      },
      {
        id: 'federation',
        label: 'Federation',
        hint: 'Add the governing body you officiate under.',
        unlockCopy: 'Shows which national or international body certified you.',
        weight: 5,
        completed: federation,
        actionId: 'edit-profile',
        actionLabel: 'Add Federation',
      },
      {
        id: 'specialization',
        label: 'Specialization',
        hint: 'Pick outdoor, indoor, or both.',
        unlockCopy: 'Helps match you with the right appointments and tournaments.',
        weight: 5,
        completed: specialization,
        actionId: 'edit-profile',
        actionLabel: 'Set Specialization',
      },
      {
        id: 'photo',
        label: 'Profile Photo',
        hint: 'Upload a profile photo.',
        unlockCopy: 'Helps put a face to your name.',
        weight: 10,
        completed: photo,
        actionId: 'edit-profile',
        actionLabel: 'Add Photo',
      },
      {
        id: 'bio',
        label: 'Bio',
        hint: 'Add a short bio about your officiating background.',
        unlockCopy: 'A few lines of context beyond the badges.',
        weight: 10,
        completed: bio,
        actionId: 'edit-profile',
        actionLabel: 'Add Bio',
      },
      {
        id: 'career',
        label: 'Career History',
        hint: 'Add a career milestone, certification, or panel.',
        unlockCopy: 'Concrete history is a strong credibility signal beyond the badge.',
        weight: 10,
        completed: career,
        actionId: 'officiating-tab',
        actionLabel: 'Add Entry',
      },
      {
        id: 'gallery',
        label: 'Gallery',
        hint: 'Upload at least one photo from an event you\u2019ve officiated.',
        unlockCopy: 'Match photos, venues, or team-with-fellow-officials moments.',
        weight: 5,
        completed: gallery,
        actionId: 'gallery-tab',
        actionLabel: 'Add Photo',
      },
      {
        id: 'friends',
        label: 'Make your first connection',
        hint: 'Connect with fellow officials, coaches, or clubs.',
        unlockCopy: 'Builds your officiating network on HOCKIA.',
        weight: 5,
        completed: friends,
        actionId: 'friends-tab',
        actionLabel: 'Add Connection',
      },
      {
        id: 'references',
        label: 'Peer References',
        hint: 'Get at least one trusted reference from a coach, fellow umpire, or club.',
        unlockCopy: 'A peer vouching for you builds trust faster than any credential alone.',
        weight: 15,
        completed: references,
        actionId: 'friends-tab',
        actionLabel: 'Get Reference',
      },
      {
        id: 'availability',
        label: 'Mark yourself available',
        hint: 'Turn on "Available for appointments".',
        unlockCopy: 'Clubs and federations filter for available umpires — set it to appear.',
        weight: 5,
        completed: available,
        actionId: 'profile-tab',
        actionLabel: 'Set Availability',
      },
      {
        id: 'appointments',
        label: 'Officiating Appointments',
        hint: 'Log at least one match you have officiated.',
        unlockCopy: 'A real appointment record is the strongest officiating signal.',
        weight: 10,
        completed: appointments,
        actionId: 'officiating-tab',
        actionLabel: 'Add Appointment',
      },
    ]
  }, [profile, galleryCount])

  /** Raw 0–100 percentage — the canonical buckets sum to 100, so no
   *  normalization, and it matches the server profile_completeness_pct. */
  const percentage = useMemo(() => {
    return buckets.reduce((acc, b) => acc + (b.completed ? b.weight : 0), 0)
  }, [buckets])

  return {
    /** Overall completion percentage (0-100) */
    percentage,
    /** Individual bucket states */
    buckets,
    /** True while fetching gallery count. */
    loading,
    /** Force-fresh re-fetch — busts the dedupe cache before fetching
     *  so explicit post-upload calls don't get the 30s-cached value. */
    refresh,
  }
}
