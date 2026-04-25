import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { pickFreshnessNudge, type FreshnessNudge } from '@/lib/profileFreshness'

type FreshnessRole = 'player' | 'coach' | 'club' | 'brand' | 'umpire'

interface UseProfileFreshnessOptions {
  role: FreshnessRole
  /**
   * Owner of the sections. For player/coach/club this is the profile id;
   * for brand, pass the brand row's `profile_id` (career_history etc. still
   * belong to the profile). Pass null/undefined to disable fetching.
   */
  profileId: string | null | undefined
  /** Brand id — required for brand role to query brand_posts / brand_products. */
  brandId?: string | null
  /**
   * `profiles.updated_at` — used as a rough last-bio-edit signal for coaches.
   * It flips on *any* field change, which is good enough for a 180-day bio
   * refresh nudge (much more precise than no signal at all).
   */
  profileUpdatedAt?: string | null
}

interface UseProfileFreshnessResult {
  /** The single priority nudge, or null when every section is fresh. */
  nudge: FreshnessNudge | null
  /** True while timestamps are being fetched. */
  loading: boolean
  /** Refetch (call after the owner completes the nudge's CTA). */
  refresh: () => Promise<void>
}

/**
 * Queries per-section `MAX(created_at/updated_at)` for the signed-in owner's
 * profile, then delegates to the pure `pickFreshnessNudge()` to choose which
 * — if any — nudge to show. Each query is `limit(1)` by the relevant sort
 * order, which is cheap under existing RLS (one row per section).
 *
 * Only call this from a dashboard in owner mode — there's no value in
 * showing freshness nudges on someone else's profile.
 */
export function useProfileFreshness({
  role,
  profileId,
  brandId,
  profileUpdatedAt,
}: UseProfileFreshnessOptions): UseProfileFreshnessResult {
  const [lastJourneyAt, setLastJourneyAt] = useState<string | null>(null)
  const [lastGalleryAt, setLastGalleryAt] = useState<string | null>(null)
  const [lastPostAt, setLastPostAt] = useState<string | null>(null)
  const [lastProductAt, setLastProductAt] = useState<string | null>(null)
  const [lastMediaAt, setLastMediaAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchSignals = useCallback(async () => {
    if (!profileId) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const tasks: Promise<void>[] = []

      // Journey — relevant for player, coach, club
      if (role === 'player' || role === 'coach' || role === 'club') {
        tasks.push(
          (async () => {
            const { data } = await supabase
              .from('career_history')
              .select('updated_at')
              .eq('user_id', profileId)
              .order('updated_at', { ascending: false })
              .limit(1)
              .maybeSingle()
            setLastJourneyAt((data?.updated_at as string | undefined) ?? null)
          })()
        )
      }

      // Gallery photos — player / coach
      if (role === 'player' || role === 'coach') {
        tasks.push(
          (async () => {
            const { data } = await supabase
              .from('gallery_photos')
              .select('created_at')
              .eq('user_id', profileId)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle()
            setLastGalleryAt((data?.created_at as string | undefined) ?? null)
          })()
        )
      }

      // Club media
      if (role === 'club') {
        tasks.push(
          (async () => {
            const { data } = await supabase
              .from('club_media')
              .select('created_at')
              .eq('club_id', profileId)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle()
            setLastMediaAt((data?.created_at as string | undefined) ?? null)
          })()
        )
      }

      // Brand posts + products
      if (role === 'brand' && brandId) {
        tasks.push(
          (async () => {
            const { data } = await supabase
              .from('brand_posts')
              .select('created_at')
              .eq('brand_id', brandId)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle()
            setLastPostAt((data?.created_at as string | undefined) ?? null)
          })()
        )
        tasks.push(
          (async () => {
            const { data } = await supabase
              .from('brand_products')
              .select('updated_at')
              .eq('brand_id', brandId)
              .order('updated_at', { ascending: false })
              .limit(1)
              .maybeSingle()
            setLastProductAt((data?.updated_at as string | undefined) ?? null)
          })()
        )
      }

      await Promise.all(tasks)
    } catch (err) {
      logger.error('[useProfileFreshness] fetch failed', err)
    } finally {
      setLoading(false)
    }
  }, [role, profileId, brandId])

  useEffect(() => {
    void fetchSignals()
  }, [fetchSignals])

  const nudge = useMemo<FreshnessNudge | null>(() => {
    if (loading) return null
    return pickFreshnessNudge(role, {
      lastJourneyAt,
      lastGalleryAt,
      lastBioAt: role === 'coach' ? profileUpdatedAt ?? null : null,
      lastPostAt,
      lastProductAt,
      lastMediaAt,
    })
  }, [
    loading,
    role,
    lastJourneyAt,
    lastGalleryAt,
    profileUpdatedAt,
    lastPostAt,
    lastProductAt,
    lastMediaAt,
  ])

  return { nudge, loading, refresh: fetchSignals }
}
