import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { queryClient } from '@/lib/queryClient'
import { qk } from '@/lib/queryKeys'

/**
 * Up to 5 photos per member for the Community preview and swipe deck, in the
 * order the profile screens use (gallery_photos for people, club_media for
 * clubs) — one `get_member_photos` call for many members, cached per member.
 *
 * The avatar is NOT included: the preview shows it first and these after it.
 * Members without gallery photos resolve to [] (the preview then hides the
 * progress bars). RLS on the photo tables keeps hidden profiles' photos out.
 */
const STALE_MS = 5 * 60 * 1000

type Row = { profile_id: string; url: string; ord: number }

async function fetchPhotos(ids: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>(ids.map((id) => [id, []]))
  if (ids.length === 0) return out
  const { data, error } = await supabase.rpc('get_member_photos', { p_profile_ids: ids, p_per_member: 5 })
  if (error) throw error
  for (const r of (data ?? []) as Row[]) out.get(r.profile_id)?.push(r.url)
  return out
}

/** Warm the cache for members about to be shown (the deck's next cards). */
export async function prefetchMemberPhotos(profileIds: string[]): Promise<void> {
  const missing = [...new Set(profileIds)].filter(
    (id) => queryClient.getQueryState(qk.memberPhotos(id))?.status !== 'success',
  )
  if (missing.length === 0) return
  try {
    const map = await fetchPhotos(missing.slice(0, 60))
    for (const [id, urls] of map) queryClient.setQueryData(qk.memberPhotos(id), urls)
  } catch {
    /* prefetch is best effort; the hook fetches on its own when shown */
  }
}

export function useMemberPhotos(profileId: string | null | undefined) {
  return useQuery({
    queryKey: qk.memberPhotos(profileId ?? 'none'),
    enabled: Boolean(profileId),
    staleTime: STALE_MS,
    queryFn: async () => (await fetchPhotos([profileId as string])).get(profileId as string) ?? [],
  })
}
