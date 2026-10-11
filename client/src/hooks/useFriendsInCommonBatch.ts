import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { queryClient } from '@/lib/queryClient'
import type { CommonFriend } from '@/hooks/useFriendsInCommon'

/**
 * Friends in common for the Community preview and swipe deck: up to three
 * friends (for the avatars) and the total ("3 friends in common"), from
 * get_friends_in_common — one call for a whole page of members instead of a
 * friend-list walk per member. Fenced like the friend lists (blocks, hidden
 * profiles, test accounts). The Friends screen keeps the full list
 * (hooks/useFriendsInCommon).
 */
export type InCommonSummary = { people: CommonFriend[]; count: number }

const STALE_MS = 5 * 60_000
const BATCH = 60
const key = (viewerId: string | null, memberId: string) => ['friends-in-common', viewerId ?? 'anon', memberId] as const

type Row = { member_id: string; friend_id: string; full_name: string | null; avatar_url: string | null; role: string | null; total: number }

async function fetchSummaries(memberIds: string[]): Promise<Map<string, InCommonSummary>> {
  const out = new Map<string, InCommonSummary>(memberIds.map((id) => [id, { people: [], count: 0 }]))
  for (let i = 0; i < memberIds.length; i += BATCH) {
    const { data, error } = await supabase.rpc('get_friends_in_common', { p_member_ids: memberIds.slice(i, i + BATCH) })
    if (error) throw error
    for (const r of (data ?? []) as Row[]) {
      const entry = out.get(r.member_id)
      if (!entry) continue
      entry.people.push({ id: r.friend_id, fullName: r.full_name, avatarUrl: r.avatar_url, role: r.role })
      entry.count = Number(r.total)
    }
  }
  return out
}

/** Warm the summaries for members about to be shown (grid page, deck neighbours). */
export async function prefetchFriendsInCommon(memberIds: string[]): Promise<void> {
  const viewerId = useAuthStore.getState().user?.id ?? null
  if (!viewerId) return
  const missing = [...new Set(memberIds)].filter((id) => id !== viewerId && queryClient.getQueryState(key(viewerId, id))?.status !== 'success')
  if (missing.length === 0) return
  try {
    const map = await fetchSummaries(missing)
    for (const [id, summary] of map) queryClient.setQueryData(key(viewerId, id), summary)
  } catch (err) {
    logger.debug('[useFriendsInCommonBatch] prefetch failed', err)
  }
}

export function useFriendsInCommonSummary(memberId: string | null | undefined): InCommonSummary & { loading: boolean } {
  const viewerId = useAuthStore((s) => s.user?.id ?? null)
  const enabled = Boolean(viewerId && memberId && memberId !== viewerId)
  const { data, isLoading } = useQuery({
    queryKey: key(viewerId, memberId ?? 'none'),
    enabled,
    staleTime: STALE_MS,
    queryFn: async () => (await fetchSummaries([memberId as string])).get(memberId as string) ?? { people: [], count: 0 },
  })
  return { people: data?.people ?? [], count: data?.count ?? 0, loading: enabled && isLoading }
}
