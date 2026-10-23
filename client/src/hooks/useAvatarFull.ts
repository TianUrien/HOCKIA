import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { queryClient } from '@/lib/queryClient'
import { qk } from '@/lib/queryKeys'
import { logger } from '@/lib/logger'

/**
 * The full-shape profile photo for full-screen views (profiles.avatar_full_url,
 * migration 20261023120000). null = none, so the deck uses the square avatar.
 * A direct profiles read: row RLS keeps hidden profiles hidden. A failed read
 * (e.g. a database without the column) is null, never an error on screen.
 */
const STALE_MS = 5 * 60 * 1000

async function fetchFull(ids: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>(ids.map((id) => [id, null]))
  if (ids.length === 0) return out
  const { data, error } = await supabase.from('profiles').select('id, avatar_full_url').in('id', ids)
  if (error) { logger.debug('[useAvatarFull] read failed', error.message); return out }
  for (const row of (data ?? []) as { id: string; avatar_full_url: string | null }[]) out.set(row.id, row.avatar_full_url ?? null)
  return out
}

export function useAvatarFull(profileId: string | null | undefined) {
  return useQuery({
    queryKey: qk.avatarFull(profileId ?? 'none'),
    enabled: Boolean(profileId),
    staleTime: STALE_MS,
    queryFn: async () => (await fetchFull([profileId as string])).get(profileId as string) ?? null,
  })
}

/** Read the members not cached yet in one query and seed each one's cache. */
export async function prefetchAvatarFull(profileIds: string[]): Promise<void> {
  const missing = [...new Set(profileIds)].filter((id) => queryClient.getQueryState(qk.avatarFull(id))?.status !== 'success')
  if (missing.length === 0) return
  const map = await fetchFull(missing)
  for (const [id, url] of map) queryClient.setQueryData(qk.avatarFull(id), url)
}

/** The cached full photo, if it has been read. */
export function cachedAvatarFull(profileId: string): string | null | undefined {
  return queryClient.getQueryData<string | null>(qk.avatarFull(profileId))
}
