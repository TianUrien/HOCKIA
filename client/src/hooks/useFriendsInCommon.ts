import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { useAuthStore } from '@/lib/auth'

/**
 * "In common" — the friends the viewer shares with another member (Figma
 * Member preview row + Friends — public). Never faked: it is the real
 * intersection of two fenced reads.
 *
 *   mine   → profile_friend_edges (RLS: the viewer's own accepted edges)
 *   theirs → get_profile_connections (members-only, block- and
 *            hidden-profile-fenced; the same list Friends — public shows)
 *
 * Signed-out viewers and the viewer's own profile resolve to nothing.
 * One module cache per viewer·member pair feeds both surfaces.
 */
export type CommonFriend = { id: string; fullName: string | null; avatarUrl: string | null; role: string | null }
type Result = { people: CommonFriend[]; count: number }

const cache = new Map<string, Result>()
const inflight = new Map<string, Promise<Result>>()
const PAGE = 100
const MAX_PAGES = 5

async function load(viewerId: string, memberId: string): Promise<Result> {
  const { data: edges, error: edgeError } = await supabase
    .from('profile_friend_edges')
    .select('friend_id')
    .eq('profile_id', viewerId)
    .eq('status', 'accepted')
  if (edgeError) throw edgeError
  const mine = new Set((edges ?? []).map((e) => e.friend_id).filter((id): id is string => Boolean(id)))
  if (mine.size === 0) return { people: [], count: 0 }

  const people: CommonFriend[] = []
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, error } = await supabase.rpc('get_profile_connections', { p_profile_id: memberId, p_limit: PAGE, p_offset: page * PAGE })
    if (error) throw error
    const rows = data ?? []
    for (const r of rows) {
      if (mine.has(r.id)) people.push({ id: r.id, fullName: r.full_name, avatarUrl: r.avatar_url, role: r.role })
    }
    const total = rows[0]?.total_count ?? 0
    if (rows.length < PAGE || (page + 1) * PAGE >= total) break
  }
  return { people, count: people.length }
}

export function clearFriendsInCommonCache() {
  cache.clear()
}

export function useFriendsInCommon(memberId: string | null | undefined) {
  const viewerId = useAuthStore((s) => s.user?.id ?? null)
  const key = viewerId && memberId && viewerId !== memberId ? `${viewerId}:${memberId}` : null
  const [result, setResult] = useState<Result | null>(() => (key ? cache.get(key) ?? null : null))

  useEffect(() => {
    if (!key || !viewerId || !memberId) { setResult(null); return }
    const hit = cache.get(key)
    if (hit) { setResult(hit); return }
    let cancelled = false
    let run = inflight.get(key)
    if (!run) {
      run = load(viewerId, memberId).finally(() => inflight.delete(key))
      inflight.set(key, run)
    }
    run.then((r) => { cache.set(key, r); if (!cancelled) setResult(r) }).catch((err) => {
      logger.debug('[useFriendsInCommon] failed', err)
      if (!cancelled) setResult(null)
    })
    return () => { cancelled = true }
  }, [key, viewerId, memberId])

  return { people: result?.people ?? [], count: result?.count ?? 0, loading: Boolean(key) && result === null }
}

/** "3 friends · Ana, Luis" — names are first names, at most two. */
export function inCommonLabel(people: CommonFriend[]): string | null {
  if (people.length === 0) return null
  const names = people.slice(0, 2).map((p) => p.fullName?.trim().split(/\s+/)[0]).filter(Boolean).join(', ')
  const head = people.length === 1 ? '1 friend' : `${people.length} friends`
  return names ? `${head} · ${names}` : head
}
