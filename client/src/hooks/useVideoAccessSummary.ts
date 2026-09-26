import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { qk } from '@/lib/queryKeys'

export type VideoAccessSummary = {
  /** Full matches (uploaded + linked) this viewer cannot see. 0 for the owner and recruiters. */
  lockedFullMatches: number
  /** Recruiters-only highlights this viewer cannot see. */
  lockedHighlights: number
}

/**
 * RLS hides recruiters-only rows entirely, so without this a player or a
 * non-recruiting coach would see no trace of a player's full matches. The
 * RPC returns counts only (never ids, titles or links) so the UI can draw
 * "Clubs and coaches only" locked tiles in their place.
 */
export function useVideoAccessSummary(profileId: string | null | undefined, opts?: { enabled?: boolean }) {
  const viewerId = useAuthStore((s) => s.user?.id ?? null)
  const id = profileId ?? null
  const enabled = !!id && id !== viewerId && (opts?.enabled ?? true)
  const { data, error } = useQuery({
    queryKey: qk.videoAccessSummary(id, viewerId),
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<VideoAccessSummary> => {
      const { data: raw, error: rpcError } = await supabase.rpc('get_video_access_summary', { p_profile_id: id as string })
      if (rpcError) throw rpcError
      const obj = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>
      const n = (v: unknown) => (typeof v === 'number' && v > 0 ? Math.floor(v) : 0)
      return { lockedFullMatches: n(obj.locked_full_matches), lockedHighlights: n(obj.locked_highlights) }
    },
  })

  useEffect(() => {
    if (error) logger.error('[useVideoAccessSummary] failed', error)
  }, [error])

  return {
    lockedFullMatches: enabled ? data?.lockedFullMatches ?? 0 : 0,
    lockedHighlights: enabled ? data?.lockedHighlights ?? 0 : 0,
  }
}
