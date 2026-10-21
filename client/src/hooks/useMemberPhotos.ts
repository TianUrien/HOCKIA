import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { queryClient } from '@/lib/queryClient'
import { qk } from '@/lib/queryKeys'
import { createTickBatcher } from '@/lib/tickBatcher'

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
/** Members per get_member_photos call (same cap as the grid batch below). */
const BATCH_SIZE = 60

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

/** Cards that mount in the same tick (Home's role rail, the feed) share ONE get_member_photos call. */
const memberPhotosBatcher = createTickBatcher<string[]>(fetchPhotos, { max: BATCH_SIZE })

/** One member's photos, batched with every other member asked for in the same tick. */
export async function fetchMemberPhotosBatched(profileId: string): Promise<string[]> {
  return (await memberPhotosBatcher.load(profileId)) ?? []
}

export function useMemberPhotos(profileId: string | null | undefined) {
  return useQuery({
    queryKey: qk.memberPhotos(profileId ?? 'none'),
    enabled: Boolean(profileId),
    staleTime: STALE_MS,
    queryFn: () => fetchMemberPhotosBatched(profileId as string),
  })
}

const BATCH = 60

/**
 * Photos for a whole page of grid cards in one call per 60 members. Seeds the
 * per-member cache too, so the preview opens on photos already loaded.
 * `isPending(id)` is true while that member's photos are still loading (the
 * card then waits instead of flashing the avatar and swapping to the gallery
 * photo). Loading the next page keeps the photos already on screen.
 */
export function useMemberPhotosBatch(profileIds: string[]): { photos: Map<string, string[]>; isPending: (id: string) => boolean } {
  const key = useMemo(() => [...new Set(profileIds)].sort(), [profileIds])
  const { data, isFetching } = useQuery({
    queryKey: ['gallery', 'member-photos-batch', key],
    enabled: key.length > 0,
    staleTime: STALE_MS,
    placeholderData: (previous) => previous,
    queryFn: async () => {
      const out = new Map<string, string[]>()
      const cached = key.filter((id) => queryClient.getQueryState(qk.memberPhotos(id))?.status === 'success')
      for (const id of cached) out.set(id, queryClient.getQueryData<string[]>(qk.memberPhotos(id)) ?? [])
      const missing = key.filter((id) => !out.has(id))
      for (let i = 0; i < missing.length; i += BATCH) {
        try {
          const map = await fetchPhotos(missing.slice(i, i + BATCH))
          for (const [id, urls] of map) {
            out.set(id, urls)
            queryClient.setQueryData(qk.memberPhotos(id), urls)
          }
        } catch {
          /* a failed page falls back to avatars; the preview retries per member */
        }
      }
      return out
    },
  })
  const photos = data ?? EMPTY
  return { photos, isPending: (id: string) => isFetching && !photos.has(id) }
}

const EMPTY = new Map<string, string[]>()
