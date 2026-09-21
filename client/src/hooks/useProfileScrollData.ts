import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import type { Database } from '@/lib/database.types'
import type { UserPostFeedItem } from '@/types/homeFeed'

/**
 * Data for the phone profile long scroll (Figma 03 Player › Profile own /
 * public). One hook, one round of parallel reads, plain state — the
 * dashboard test tree has no QueryClient, and each section shows only a
 * preview (the number in the stats strip opens the complete collection).
 *
 * Every read is fenced by the same RLS the full tabs use: a visitor who
 * may not see recruiters-only full matches simply gets no rows.
 */

export type ScrollVideo = {
  id: string
  title: string
  kind: 'highlight' | 'full_match' | 'reel'
  visibility: string | null
  status: string | null
  durationSeconds: number | null
}

export type ScrollFullGameLink = Database['public']['Tables']['player_full_game_videos']['Row']

export type ScrollCareerEntry = {
  id: string
  entryType: string | null
  clubName: string
  positionRole: string | null
  divisionLeague: string | null
  locationCity: string | null
  locationCountry: string | null
  startDate: string | null
  endDate: string | null
  years: string | null
  representedLevel: string | null
  representedCountryId: number | null
  worldClub: { id: string; club_name: string; avatar_url: string | null; flag: string | null } | null
}

export type ScrollPhoto = { id: string; url: string; caption: string | null }

export type ProfileScrollData = {
  loading: boolean
  highlights: ScrollVideo[]
  fullMatches: ScrollVideo[]
  fullGameLinks: ScrollFullGameLink[]
  reels: ScrollVideo[]
  career: ScrollCareerEntry[]
  photos: ScrollPhoto[]
  photoCount: number
  posts: UserPostFeedItem[]
  postCount: number
  refresh: () => void
}

const EMPTY: Omit<ProfileScrollData, 'loading' | 'refresh'> = {
  highlights: [], fullMatches: [], fullGameLinks: [], reels: [], career: [], photos: [], photoCount: 0, posts: [], postCount: 0,
}

type CareerRow = Database['public']['Tables']['career_history']['Row'] & {
  world_club: { id: string; club_name: string; avatar_url: string | null; country: { flag_emoji: string | null } | null } | null
}

export function useProfileScrollData(profileId: string | null | undefined, enabled = true): ProfileScrollData {
  const [data, setData] = useState(EMPTY)
  const [loading, setLoading] = useState(Boolean(profileId) && enabled)
  const [nonce, setNonce] = useState(0)
  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    if (!profileId || !enabled) return
    let cancelled = false
    setLoading(true)
    void (async () => {
      const [videos, links, career, photos, photoCount, posts] = await Promise.all([
        supabase
          .from('player_videos')
          .select('id, title, kind, visibility, status, duration_seconds, created_at, display_order')
          .eq('user_id', profileId)
          .in('kind', ['highlight', 'full_match', 'reel'])
          .order('display_order', { ascending: false })
          .order('created_at', { ascending: false }),
        supabase
          .from('player_full_game_videos')
          .select('*')
          .eq('user_id', profileId)
          .order('match_date', { ascending: false, nullsFirst: false })
          .limit(6),
        supabase
          .from('career_history')
          .select('*, world_club:world_clubs!career_history_world_club_id_fkey(id, club_name, avatar_url, country:countries(flag_emoji))')
          .eq('user_id', profileId)
          .order('start_date', { ascending: false, nullsFirst: false })
          .order('display_order', { ascending: false })
          .limit(4),
        supabase
          .from('gallery_photos')
          .select('id, photo_url, caption')
          .eq('user_id', profileId)
          .order('order_index', { ascending: true })
          .limit(3),
        supabase.from('gallery_photos').select('id', { count: 'exact', head: true }).eq('user_id', profileId),
        supabase.rpc('get_profile_posts', { p_profile_id: profileId, p_limit: 6, p_offset: 0 }),
      ])
      if (cancelled) return
      for (const r of [videos, links, career, photos, photoCount, posts]) {
        if (r && 'error' in r && r.error) logger.debug('[useProfileScrollData] read failed', r.error)
      }
      const allVideos = ((videos.data ?? []) as Array<{ id: string; title: string; kind: string; visibility: string | null; status: string | null; duration_seconds: number | null }>)
        .filter((v) => v.status === 'ready' || v.status === null)
        .map<ScrollVideo>((v) => ({ id: v.id, title: v.title, kind: v.kind as ScrollVideo['kind'], visibility: v.visibility, status: v.status, durationSeconds: v.duration_seconds }))
      const careerRows = (career.data ?? []) as unknown as CareerRow[]
      const postsPayload = (posts.data ?? null) as { items?: UserPostFeedItem[]; total?: number } | null
      setData({
        highlights: allVideos.filter((v) => v.kind === 'highlight'),
        fullMatches: allVideos.filter((v) => v.kind === 'full_match'),
        fullGameLinks: (links.data ?? []) as ScrollFullGameLink[],
        reels: allVideos.filter((v) => v.kind === 'reel'),
        career: careerRows.map((r) => ({
          id: r.id,
          entryType: r.entry_type,
          clubName: r.club_name,
          positionRole: r.position_role,
          divisionLeague: r.division_league,
          locationCity: r.location_city,
          locationCountry: r.location_country,
          startDate: r.start_date,
          endDate: r.end_date,
          years: r.years,
          representedLevel: r.represented_level,
          representedCountryId: r.represented_country_id,
          worldClub: r.world_club ? { id: r.world_club.id, club_name: r.world_club.club_name, avatar_url: r.world_club.avatar_url, flag: r.world_club.country?.flag_emoji ?? null } : null,
        })),
        photos: ((photos.data ?? []) as Array<{ id: string; photo_url: string; caption: string | null }>).map((p) => ({ id: p.id, url: p.photo_url, caption: p.caption })),
        photoCount: photoCount.count ?? 0,
        posts: Array.isArray(postsPayload?.items) ? postsPayload!.items : [],
        postCount: postsPayload?.total ?? 0,
      })
      setLoading(false)
    })().catch((err) => {
      logger.debug('[useProfileScrollData] failed', err)
      if (!cancelled) setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [profileId, enabled, nonce])

  return { ...data, loading, refresh }
}
