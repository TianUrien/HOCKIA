import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
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
 * Credentials still lead the weighting, but Phase C (officiating journey),
 * Phase E (peer references), and Phase F1 (gallery) now contribute — so the
 * percentage reflects the full-citizen umpire experience, not just badges.
 *
 * Weights (sum to 110 — normalized to 0–100 via percentage = score/total*100):
 * - Umpire Level       (20): umpire_level
 * - Federation         (15): federation
 * - Specialization     (10): officiating_specialization
 * - Profile Photo      (10): avatar_url
 * - Bio                (10): bio
 * - Languages          (10): >=1 language
 * - Gallery            (10): >=1 gallery_photos row (requires a query)
 * - Years Officiating   (5): umpire_since
 * - Officiating Journey (10): >=1 umpire_appointments row
 * - Peer References    (10): >=1 accepted profile_references row
 *
 * Community-grid estimator (lib/profileTier.ts estimateMemberStrength) stays
 * at 100 without gallery because it runs on fields cheaply denormalized on
 * the profile row — a gallery count isn't. The resulting tier mismatch
 * between owner dashboard and community card is <=1 band in practice
 * (normalization absorbs most of it), matches the pre-existing player
 * pattern.
 */
export function useUmpireProfileStrength({ profile }: UseUmpireProfileStrengthOptions) {
  const [galleryCount, setGalleryCount] = useState<number>(0)
  const [loading, setLoading] = useState<boolean>(Boolean(profile?.id))

  const profileId = profile?.id ?? null

  const fetchGalleryCount = useCallback(async () => {
    if (!profileId) {
      setGalleryCount(0)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const { count, error } = await supabase
        .from('gallery_photos')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', profileId)

      if (error) {
        logger.error('[useUmpireProfileStrength] gallery count failed:', error)
        setGalleryCount(0)
      } else {
        setGalleryCount(count ?? 0)
      }
    } finally {
      setLoading(false)
    }
  }, [profileId])

  useEffect(() => {
    void fetchGalleryCount()
  }, [fetchGalleryCount])

  const buckets: ProfileBucket[] = useMemo(() => {
    const level = Boolean(profile?.umpire_level?.trim())
    const federation = Boolean(profile?.federation?.trim())
    const specialization = Boolean(profile?.officiating_specialization?.trim())
    const photo = Boolean(profile?.avatar_url?.trim())
    const bio = Boolean(profile?.bio?.trim())
    const languages = (profile?.languages?.length ?? 0) >= 1
    const gallery = galleryCount >= 1
    const years = (profile?.umpire_since ?? 0) > 0
    const appointments = (profile?.umpire_appointment_count ?? 0) >= 1
    const references = (profile?.accepted_reference_count ?? 0) >= 1

    return [
      {
        id: 'umpire-level',
        label: 'Umpire Level',
        hint: 'Add your certification level (e.g. FIH International, National).',
        unlockCopy: 'Level is the first thing clubs and fellow umpires look for.',
        weight: 20,
        completed: level,
        actionId: 'edit-profile',
        actionLabel: 'Add Level',
      },
      {
        id: 'federation',
        label: 'Federation',
        hint: 'Add the governing body you officiate under.',
        unlockCopy: 'Shows which national or international body certified you.',
        weight: 15,
        completed: federation,
        actionId: 'edit-profile',
        actionLabel: 'Add Federation',
      },
      {
        id: 'specialization',
        label: 'Specialization',
        hint: 'Pick outdoor, indoor, or both.',
        unlockCopy: 'Helps match you with the right appointments and tournaments.',
        weight: 10,
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
        id: 'languages',
        label: 'Languages',
        hint: 'Add at least one language you officiate in.',
        unlockCopy: 'Matters for international tournaments and mixed-language panels.',
        weight: 10,
        completed: languages,
        actionId: 'edit-profile',
        actionLabel: 'Add Languages',
      },
      {
        id: 'gallery',
        label: 'Gallery',
        hint: 'Upload at least one photo from an event you\u2019ve officiated.',
        unlockCopy: 'Match photos, venues, or team-with-fellow-officials moments.',
        weight: 10,
        completed: gallery,
        actionId: 'gallery-tab',
        actionLabel: 'Add Photo',
      },
      {
        id: 'umpire-since',
        label: 'Years Officiating',
        hint: 'Add the year you first became certified.',
        unlockCopy: 'Experience is a fast trust signal for assigners.',
        weight: 5,
        completed: years,
        actionId: 'edit-profile',
        actionLabel: 'Add Start Year',
      },
      {
        id: 'appointments',
        label: 'Officiating Journey',
        hint: 'Log at least one appointment, milestone, certification, or panel.',
        unlockCopy: 'Concrete history is the strongest credibility signal beyond the badge.',
        weight: 10,
        completed: appointments,
        actionId: 'officiating-tab',
        actionLabel: 'Add Entry',
      },
      {
        id: 'references',
        label: 'Peer References',
        hint: 'Get at least one trusted reference from a coach, fellow umpire, or club.',
        unlockCopy: 'A peer vouching for you builds trust faster than any credential alone.',
        weight: 10,
        completed: references,
        actionId: 'friends-tab',
        actionLabel: 'Get Reference',
      },
    ]
  }, [profile, galleryCount])

  /** Normalized 0–100 percentage across all buckets, so a fully-complete
   * umpire scores exactly 100 regardless of the bucket total changing. */
  const percentage = useMemo(() => {
    const total = buckets.reduce((acc, b) => acc + b.weight, 0)
    if (total === 0) return 0
    const score = buckets.reduce((acc, b) => acc + (b.completed ? b.weight : 0), 0)
    return Math.round((score / total) * 100)
  }, [buckets])

  return {
    /** Overall completion percentage (0-100) */
    percentage,
    /** Individual bucket states */
    buckets,
    /** True while fetching gallery count. */
    loading,
    /** Re-fetch counts (call after updates). */
    refresh: fetchGalleryCount,
  }
}
