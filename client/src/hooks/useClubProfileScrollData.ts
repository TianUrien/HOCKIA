import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import type { UserPostFeedItem } from '@/types/homeFeed'

/**
 * Data for the phone Club profile (Figma 04 Club › Club profile — own /
 * public, 337:372 / 337:588). One hook, one round of parallel reads, plain
 * state — the same shape as useProfileScrollData for players. Every read is
 * fenced by the RLS the desktop tabs already rely on: club_media and open
 * opportunities are public, members come from get_club_members, and the
 * week's profile views are the owner's own stats RPC (never read for a
 * visitor — the public profile shows no counts of that kind).
 */

export type ClubCoverPhoto = { id: string; url: string; caption: string | null }

export type ClubMember = {
  id: string
  fullName: string
  avatarUrl: string | null
  role: string
  position: string | null
  currentClub: string | null
}

export type ClubOpenRole = {
  id: string
  title: string
  position: string | null
  gender: string | null
  opportunityType: string | null
  startDate: string | null
  durationText: string | null
}

export type ClubWorldLink = {
  id: string
  clubName: string
  crestUrl: string | null
  menLeague: { id: number; name: string; band: number | null } | null
  womenLeague: { id: number; name: string; band: number | null } | null
}

export type ClubProfileScrollData = {
  loading: boolean
  photos: ClubCoverPhoto[]
  members: ClubMember[]
  memberCount: number
  openRoles: ClubOpenRole[]
  posts: UserPostFeedItem[]
  postCount: number
  worldClub: ClubWorldLink | null
  /** Owner only: profile_view events in the last 7 days. Null for visitors. */
  viewsThisWeek: number | null
  refresh: () => void
}

const EMPTY: Omit<ClubProfileScrollData, 'loading' | 'refresh'> = {
  photos: [], members: [], memberCount: 0, openRoles: [], posts: [], postCount: 0, worldClub: null, viewsThisWeek: null,
}

const TTL = 60_000
const cache = new Map<string, { at: number; data: typeof EMPTY }>()

export function clearClubProfileScrollCache(clubId: string) {
  cache.delete(`${clubId}:0`)
  cache.delete(`${clubId}:1`)
}

type LeagueRow = { id: number; name: string; level_band_global: number | null }

export function useClubProfileScrollData(clubId: string | null | undefined, worldClubId: string | null | undefined, owner: boolean): ClubProfileScrollData {
  const key = clubId ? `${clubId}:${owner ? 1 : 0}` : null
  const fresh = (k: string | null) => {
    const hit = k ? cache.get(k) : undefined
    return hit && Date.now() - hit.at < TTL ? hit.data : null
  }
  const [data, setData] = useState(() => fresh(key) ?? EMPTY)
  const [loading, setLoading] = useState(Boolean(key) && !fresh(key))
  const [nonce, setNonce] = useState(0)
  const refresh = useCallback(() => {
    if (key) cache.delete(key)
    setNonce((n) => n + 1)
  }, [key])

  useEffect(() => {
    if (!clubId || !key) return
    const hit = cache.get(key)
    if (hit && Date.now() - hit.at < TTL) { setData(hit.data); setLoading(false); return }
    let cancelled = false
    setLoading(true)
    void (async () => {
      const [photos, members, roles, posts, worldClub, views] = await Promise.all([
        supabase
          .from('club_media')
          .select('id, file_url, caption')
          .eq('club_id', clubId)
          .order('is_featured', { ascending: false })
          .order('order_index', { ascending: true })
          .limit(6),
        supabase.rpc('get_club_members', { p_profile_id: clubId, p_limit: 12, p_offset: 0 }),
        supabase
          .from('opportunities')
          .select('id, title, position, gender, opportunity_type, start_date, duration_text, created_at')
          .eq('club_id', clubId)
          .eq('status', 'open')
          .order('created_at', { ascending: false })
          .limit(20),
        supabase.rpc('get_profile_posts', { p_profile_id: clubId, p_limit: 6, p_offset: 0 }),
        worldClubId
          ? supabase.from('world_clubs').select('id, club_name, avatar_url, men_league_id, women_league_id').eq('id', worldClubId).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        owner ? supabase.rpc('get_my_profile_view_stats', { p_days: 7 }) : Promise.resolve({ data: null, error: null }),
      ])
      if (cancelled) return
      for (const r of [photos, members, roles, posts, worldClub, views]) {
        if (r && 'error' in r && r.error) logger.debug('[useClubProfileScrollData] read failed', r.error)
      }

      // League names + bands for the linked world club — one small read.
      const wc = worldClub.data as { id: string; club_name: string; avatar_url: string | null; men_league_id: number | null; women_league_id: number | null } | null
      let leagues: LeagueRow[] = []
      const leagueIds = wc ? [wc.men_league_id, wc.women_league_id].filter((id): id is number => typeof id === 'number') : []
      if (leagueIds.length) {
        const { data: rows } = await supabase.from('world_leagues').select('id, name, level_band_global').in('id', leagueIds)
        if (cancelled) return
        leagues = (rows ?? []) as LeagueRow[]
      }
      const league = (id: number | null) => {
        const row = id === null ? null : leagues.find((l) => l.id === id) ?? null
        return row ? { id: row.id, name: row.name, band: row.level_band_global } : null
      }

      const memberRows = (members.data ?? []) as Array<{ id: string; full_name: string; avatar_url: string | null; role: string; position: string | null; current_club: string | null; total_count: number; is_test_account: boolean }>
      const postsPayload = (posts.data ?? null) as { items?: UserPostFeedItem[]; total?: number } | null
      const stats = (views.data ?? null) as { success?: boolean; total_views?: number } | null
      const next = {
        photos: ((photos.data ?? []) as Array<{ id: string; file_url: string; caption: string | null }>).map((p) => ({ id: p.id, url: p.file_url, caption: p.caption })),
        members: memberRows.map((m) => ({ id: m.id, fullName: m.full_name, avatarUrl: m.avatar_url, role: m.role, position: m.position, currentClub: m.current_club })),
        memberCount: memberRows[0]?.total_count ?? 0,
        openRoles: ((roles.data ?? []) as Array<{ id: string; title: string; position: string | null; gender: string | null; opportunity_type: string | null; start_date: string | null; duration_text: string | null }>).map((r) => ({
          id: r.id, title: r.title, position: r.position, gender: r.gender, opportunityType: r.opportunity_type, startDate: r.start_date, durationText: r.duration_text,
        })),
        posts: Array.isArray(postsPayload?.items) ? postsPayload!.items : [],
        postCount: postsPayload?.total ?? 0,
        worldClub: wc ? { id: wc.id, clubName: wc.club_name, crestUrl: wc.avatar_url, menLeague: league(wc.men_league_id), womenLeague: league(wc.women_league_id) } : null,
        viewsThisWeek: owner ? (stats?.success ? stats.total_views ?? 0 : 0) : null,
      }
      cache.set(key, { at: Date.now(), data: next })
      setData(next)
      setLoading(false)
    })().catch((err) => {
      logger.debug('[useClubProfileScrollData] failed', err)
      if (!cancelled) setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [clubId, worldClubId, owner, key, nonce])

  return { ...data, loading, refresh }
}
