/**
 * useFullGameVideos — owner + visitor data hook for player_full_game_videos.
 *
 * Owner mode (when targetUserId === auth.user.id): fetches all rows the
 * RLS SELECT policy allows for the caller. For owners that's every row;
 * for visitors that's public + (recruiters when caller is club/coach).
 *
 * Sort: match_date DESC NULLS LAST, created_at DESC. Most recent matches
 * first. v1 doesn't expose owner-curated reordering — the display_order
 * column is reserved for that future iteration.
 *
 * Optimistic updates on add / update / delete so the list feels snappy
 * without waiting for a refetch round-trip. Errors revert and surface a
 * toast. The shape mirrors useReferenceFriendOptions / useTrustedReferences.
 */
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import type { Database } from '@/lib/database.types'

export type FullGameVideo = Database['public']['Tables']['player_full_game_videos']['Row']
export type FullGameVideoInsert = Database['public']['Tables']['player_full_game_videos']['Insert']
export type FullGameVideoUpdate = Database['public']['Tables']['player_full_game_videos']['Update']

export type FullGameVideoVisibility = 'public' | 'recruiters'

interface UseFullGameVideosResult {
  videos: FullGameVideo[]
  isLoading: boolean
  error: string | null
  refetch: () => Promise<void>
  addVideo: (input: Omit<FullGameVideoInsert, 'user_id' | 'id' | 'created_at' | 'updated_at'>) => Promise<FullGameVideo | null>
  updateVideo: (id: string, patch: FullGameVideoUpdate) => Promise<boolean>
  deleteVideo: (id: string) => Promise<boolean>
}

export function useFullGameVideos(targetUserId: string | null | undefined): UseFullGameVideosResult {
  const [videos, setVideos] = useState<FullGameVideo[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refetch = useCallback(async () => {
    if (!targetUserId) {
      setVideos([])
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)
    try {
      const { data, error: queryError } = await supabase
        .from('player_full_game_videos')
        .select('*')
        .eq('user_id', targetUserId)
        // Sort: most recent match first, NULLs last for missing dates,
        // then created_at as the tiebreak.
        .order('match_date', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })

      if (queryError) throw queryError
      setVideos(Array.isArray(data) ? data : [])
    } catch (err) {
      const message =
        err && typeof err === 'object' && 'message' in err && typeof err.message === 'string'
          ? err.message
          : 'Failed to load full game videos'
      logger.error('[useFullGameVideos] fetch failed', err)
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }, [targetUserId])

  useEffect(() => {
    void refetch()
  }, [refetch])

  const addVideo = useCallback(
    async (input: Omit<FullGameVideoInsert, 'user_id' | 'id' | 'created_at' | 'updated_at'>) => {
      if (!targetUserId) return null
      try {
        const { data, error: insertError } = await supabase
          .from('player_full_game_videos')
          .insert({ ...input, user_id: targetUserId })
          .select('*')
          .single()
        if (insertError) throw insertError
        if (!data) return null
        // Optimistic prepend in display order; the next refetch reconciles.
        setVideos((prev) => sortVideos([data, ...prev]))
        return data
      } catch (err) {
        logger.error('[useFullGameVideos] addVideo failed', err)
        return null
      }
    },
    [targetUserId],
  )

  const updateVideo = useCallback(async (id: string, patch: FullGameVideoUpdate) => {
    try {
      const { data, error: updateError } = await supabase
        .from('player_full_game_videos')
        .update(patch)
        .eq('id', id)
        .select('*')
        .single()
      if (updateError) throw updateError
      if (!data) return false
      setVideos((prev) => sortVideos(prev.map((v) => (v.id === id ? data : v))))
      return true
    } catch (err) {
      logger.error('[useFullGameVideos] updateVideo failed', err)
      return false
    }
  }, [])

  const deleteVideo = useCallback(async (id: string) => {
    // Optimistic remove; restore on failure.
    let snapshot: FullGameVideo[] = []
    setVideos((prev) => {
      snapshot = prev
      return prev.filter((v) => v.id !== id)
    })
    try {
      const { error: deleteError } = await supabase
        .from('player_full_game_videos')
        .delete()
        .eq('id', id)
      if (deleteError) throw deleteError
      return true
    } catch (err) {
      logger.error('[useFullGameVideos] deleteVideo failed', err)
      setVideos(snapshot)
      return false
    }
  }, [])

  return { videos, isLoading, error, refetch, addVideo, updateVideo, deleteVideo }
}

function sortVideos(list: FullGameVideo[]): FullGameVideo[] {
  return [...list].sort((a, b) => {
    // match_date DESC NULLS LAST
    const aDate = a.match_date ? Date.parse(a.match_date) : null
    const bDate = b.match_date ? Date.parse(b.match_date) : null
    if (aDate === null && bDate !== null) return 1
    if (aDate !== null && bDate === null) return -1
    if (aDate !== null && bDate !== null && aDate !== bDate) return bDate - aDate
    // created_at DESC tiebreak
    return Date.parse(b.created_at) - Date.parse(a.created_at)
  })
}
