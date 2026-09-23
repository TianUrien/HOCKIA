import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import type { Database } from '@/lib/database.types'

/**
 * Every video on a profile (Figma Videos — all): highlights, full matches
 * and reels from player_videos — the kind filter is explicit because RLS is
 * kind-agnostic and Home video posts (kind='post') must never appear here —
 * plus the linked full games. RLS decides which rows a viewer gets; playback
 * of a recruiters-only video is refused server-side for anyone else.
 */
export type ProfileVideo = {
  id: string
  title: string
  kind: 'highlight' | 'full_match' | 'reel'
  visibility: string | null
  durationSeconds: number | null
}
export type ProfileFullGameLink = Database['public']['Tables']['player_full_game_videos']['Row']

export function useProfileVideos(profileId: string | null | undefined) {
  const [videos, setVideos] = useState<ProfileVideo[]>([])
  const [links, setLinks] = useState<ProfileFullGameLink[]>([])
  const [loading, setLoading] = useState(Boolean(profileId))
  const [nonce, setNonce] = useState(0)
  const reload = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    if (!profileId) { setLoading(false); return }
    let cancelled = false
    setLoading(true)
    void (async () => {
      const [v, l] = await Promise.all([
        supabase
          .from('player_videos')
          .select('id, title, kind, visibility, status, duration_seconds, created_at, display_order')
          .eq('user_id', profileId)
          .in('kind', ['highlight', 'full_match', 'reel'])
          .order('display_order', { ascending: false })
          .order('created_at', { ascending: false }),
        supabase.from('player_full_game_videos').select('*').eq('user_id', profileId).order('match_date', { ascending: false, nullsFirst: false }),
      ])
      if (cancelled) return
      if (v.error) logger.error('[useProfileVideos] videos failed', v.error)
      if (l.error) logger.error('[useProfileVideos] links failed', l.error)
      setVideos(((v.data ?? []) as Array<{ id: string; title: string; kind: string; visibility: string | null; status: string | null; duration_seconds: number | null }>)
        .filter((row) => row.status === 'ready' || row.status === null)
        .map((row) => ({ id: row.id, title: row.title, kind: row.kind as ProfileVideo['kind'], visibility: row.visibility, durationSeconds: row.duration_seconds })))
      setLinks((l.data ?? []) as ProfileFullGameLink[])
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [profileId, nonce])

  return { videos, links, loading, reload }
}
