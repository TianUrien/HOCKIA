import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { getImageUrl } from '@/lib/imageUrl'
import { extractCrestColor } from '@/lib/crestColor'

/**
 * Crest colour per club for the Community club cards (Cover=Crest).
 *
 * 1. Stored colours: one read of club_crest_colors for the clubs on screen.
 * 2. Missing or stale (the club changed its crest since): worked out on the
 *    phone from the crest image, cached for the session. When the viewer IS
 *    that club, the result is saved so nobody has to compute it again.
 * 3. Nothing usable → null, and the card keeps the brand purple.
 */
type Club = { id: string; avatar_url: string | null }

const computed = new Map<string, string | null>()

/** Save a club's own crest colour (crest upload, or self-heal on view). */
export async function saveOwnCrestColor(profileId: string, crestUrl: string, color: string): Promise<void> {
  const { error } = await supabase
    .from('club_crest_colors')
    .upsert({ profile_id: profileId, crest_url: crestUrl, color, updated_at: new Date().toISOString() })
  if (error) logger.debug('[useClubCrestColors] save failed', error)
}

/** After a crest upload: pick the colour from the file itself (no network) and save it. */
export function rememberCrestColor(profileId: string, crestUrl: string, file: Blob): void {
  void extractCrestColor(file).then((color) => {
    computed.set(crestUrl, color)
    if (color) void saveOwnCrestColor(profileId, crestUrl, color)
  })
}

export function useClubCrestColors(clubs: Club[]): Map<string, string | null> {
  const viewerId = useAuthStore((s) => s.user?.id ?? null)
  const withCrest = useMemo(() => clubs.filter((c) => c.avatar_url), [clubs])
  const ids = useMemo(() => withCrest.map((c) => c.id).sort(), [withCrest])

  const { data: stored } = useQuery({
    queryKey: ['club-crest-colors', ids],
    enabled: ids.length > 0,
    staleTime: 10 * 60_000,
    placeholderData: (previous) => previous,
    queryFn: async () => {
      const { data, error } = await supabase.from('club_crest_colors').select('profile_id, crest_url, color').in('profile_id', ids)
      if (error) {
        logger.debug('[useClubCrestColors] read failed', error)
        return new Map<string, { url: string; color: string }>()
      }
      return new Map((data ?? []).map((r) => [r.profile_id, { url: r.crest_url, color: r.color }]))
    },
  })

  const [, bump] = useState(0)
  useEffect(() => {
    if (!stored) return
    let cancelled = false
    const todo = withCrest.filter((c) => stored.get(c.id)?.url !== c.avatar_url && !computed.has(c.avatar_url as string))
    if (todo.length === 0) return
    void (async () => {
      for (const club of todo) {
        const url = club.avatar_url as string
        const color = await extractCrestColor(getImageUrl(url, 'avatar-md') ?? url)
        computed.set(url, color)
        if (color && viewerId === club.id) void saveOwnCrestColor(club.id, url, color)
        if (!cancelled) bump((n) => n + 1)
      }
    })()
    return () => { cancelled = true }
  }, [stored, withCrest, viewerId])

  const out = new Map<string, string | null>()
  for (const c of withCrest) {
    const row = stored?.get(c.id)
    out.set(c.id, row && row.url === c.avatar_url ? row.color : computed.get(c.avatar_url as string) ?? null)
  }
  return out
}
