import { useCallback, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { qk } from '@/lib/queryKeys'

/**
 * Shared gallery_photos count for a profile, on React Query.
 *
 * First migrated slice of the requestCache → React Query move (roadmap #2).
 * The three strength hooks (player/coach/umpire) each carried a copy of this
 * fetch under three different cache keys — one key here means dashboard
 * consumers finally do share a single round trip.
 *
 * Semantics preserved from the requestCache version:
 *  - 30s freshness window: remounts within it serve cache, no refetch.
 *  - Concurrent mounts share one in-flight fetch (RQ dedupes natively).
 *  - refresh() is dual-contract (the aa52843 race): when idle it forces a
 *    fresh network call even inside the freshness window ("I just edited my
 *    gallery"); when a fetch is already in flight it JOINS that fetch
 *    instead of racing it. `refetch({ cancelRefetch: false })` is exactly
 *    that pair of behaviours.
 */
export function useGalleryCount(profileId: string | null | undefined) {
  const id = profileId ?? null
  const { data, isPending, refetch, error } = useQuery({
    queryKey: qk.galleryCount(id),
    enabled: !!id,
    staleTime: 30_000,
    queryFn: async () => {
      const res = await supabase
        .from('gallery_photos')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', id as string)
      if (res.error) throw res.error
      return res.count ?? 0
    },
  })

  useEffect(() => {
    if (error) logger.error('Error fetching gallery count:', error)
  }, [error])

  const refresh = useCallback(async () => {
    // refetch() bypasses `enabled` in RQ v5 — never fetch for a null id.
    if (!id) return
    await refetch({ cancelRefetch: false })
  }, [id, refetch])

  return {
    /** null until the first response arrives (or when there's no profile). */
    count: data ?? null,
    /** true only while a profile id exists and no data has arrived yet. */
    loading: !!id && isPending,
    refresh,
  }
}
