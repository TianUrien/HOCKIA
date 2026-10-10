import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { qk } from '@/lib/queryKeys'

/**
 * The full set of photos behind a Home "Added N new photos" card. The card
 * only carries up to 4 sample URLs; the rollup is keyed by (uploader, UTC
 * day of gallery_photos.created_at), so the set is that member's gallery
 * photos created that day, oldest first — the same order the samples use.
 * Fetched only once the viewer opens (`enabled`).
 */
export function useActivityPhotos(uploaderId: string, day: string, enabled: boolean) {
  return useQuery({
    queryKey: qk.activityPhotos(uploaderId, day),
    enabled: enabled && Boolean(uploaderId) && /^\d{4}-\d{2}-\d{2}$/.test(day),
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<string[]> => {
      const start = `${day}T00:00:00Z`
      const end = new Date(Date.parse(start) + 24 * 60 * 60 * 1000).toISOString()
      const { data, error } = await supabase
        .from('gallery_photos')
        .select('photo_url, created_at')
        .eq('user_id', uploaderId)
        .gte('created_at', start)
        .lt('created_at', end)
        .order('created_at', { ascending: true })
      if (error) throw error
      return (data ?? []).map((r) => r.photo_url).filter((u): u is string => Boolean(u))
    },
  })
}
