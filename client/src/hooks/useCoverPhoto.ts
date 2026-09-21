import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'

// Module cache: the cover is read once per profile per session; the gallery
// manager clears it when the order or the photos change.
const cache = new Map<string, string | null>()

export function clearCoverPhotoCache(profileId: string) {
  cache.delete(profileId)
}

/**
 * Cover photo for the profile screen (Figma Profile v2/v3 "cover"). profiles
 * has no cover column, so the cover is the member's first gallery photo —
 * the one they ordered first. Null → the screen paints its own gradient.
 */
export function useCoverPhoto(profileId: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(() => (profileId ? cache.get(profileId) ?? null : null))

  useEffect(() => {
    if (!profileId) return
    if (cache.has(profileId)) {
      setUrl(cache.get(profileId) ?? null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const { data, error } = await supabase
          .from('gallery_photos')
          .select('photo_url')
          .eq('user_id', profileId)
          .order('order_index', { ascending: true })
          .limit(1)
        if (error) throw error
        const first = data?.[0]?.photo_url ?? null
        cache.set(profileId, first)
        if (!cancelled) setUrl(first)
      } catch (err) {
        logger.debug('[useCoverPhoto] failed', err)
        if (!cancelled) setUrl(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [profileId])

  return url
}
