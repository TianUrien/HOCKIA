import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { getImageUrl } from '@/lib/imageUrl'
import { extractCrestColors, type CrestColors } from '@/lib/crestColor'
import { isCurrentPalette, type CrestPalette } from '@/lib/crestPalette'

/**
 * Crest colour + palette per club (Community club cards, home role covers,
 * Opportunities v2 generated covers). ONE extractor (lib/crestPalette.ts)
 * gives both from one canvas pass.
 *
 * 1. Stored: one read of club_crest_colors for the clubs on screen.
 * 2. Missing, stale (the club changed its crest) or palette older than the
 *    extractor: worked out on the phone from the crest image, cached for the
 *    session. When the viewer IS that club, the result is saved so nobody has
 *    to compute it again — and only then (write guard), so a view never
 *    rewrites a row that is already current.
 * 3. Nothing usable → null: cards keep the brand purple, covers the Hockia
 *    violet fallback (coverBackground(null)).
 */
type Club = { id: string; avatar_url: string | null }
type Stored = { url: string; color: string; palette: CrestPalette | null }

const computed = new Map<string, CrestColors | null>()

/** Save a club's own crest colour + palette (crest upload, or self-heal on view). */
export async function saveOwnCrestColor(profileId: string, crestUrl: string, colors: CrestColors): Promise<void> {
  const { error } = await supabase
    .from('club_crest_colors')
    .upsert({ profile_id: profileId, crest_url: crestUrl, color: colors.color, palette: colors.palette, updated_at: new Date().toISOString() })
  if (error) logger.debug('[useClubCrestColors] save failed', error)
}

/** After a crest upload: pick the colours from the file itself (no network) and save them. */
export function rememberCrestColor(profileId: string, crestUrl: string, file: Blob): void {
  void extractCrestColors(file).then((colors) => {
    computed.set(crestUrl, colors)
    if (colors) void saveOwnCrestColor(profileId, crestUrl, colors)
  })
}

function needsCompute(row: Stored | undefined, crestUrl: string): boolean {
  return !row || row.url !== crestUrl || !isCurrentPalette(row.palette)
}

function useCrestColorRows(clubs: Club[]): { withCrest: Club[]; stored: Map<string, Stored> | undefined; viewerId: string | null } {
  const viewerId = useAuthStore((s) => s.user?.id ?? null)
  const withCrest = useMemo(() => clubs.filter((c) => c.avatar_url), [clubs])
  const ids = useMemo(() => withCrest.map((c) => c.id).sort(), [withCrest])

  const { data: stored } = useQuery({
    queryKey: ['club-crest-colors', ids],
    enabled: ids.length > 0,
    staleTime: 10 * 60_000,
    placeholderData: (previous) => previous,
    queryFn: async () => {
      const { data, error } = await supabase.from('club_crest_colors').select('profile_id, crest_url, color, palette').in('profile_id', ids)
      if (error) {
        logger.debug('[useClubCrestColors] read failed', error)
        return new Map<string, Stored>()
      }
      return new Map((data ?? []).map((r) => [r.profile_id, { url: r.crest_url, color: r.color, palette: isCurrentPalette(r.palette) ? r.palette : null }]))
    },
  })

  const [, bump] = useState(0)
  useEffect(() => {
    if (!stored) return
    let cancelled = false
    const todo = withCrest.filter((c) => needsCompute(stored.get(c.id), c.avatar_url as string) && !computed.has(c.avatar_url as string))
    if (todo.length === 0) return
    void (async () => {
      for (const club of todo) {
        const url = club.avatar_url as string
        const colors = await extractCrestColors(getImageUrl(url, 'avatar-md') ?? url)
        computed.set(url, colors)
        if (colors && viewerId === club.id) void saveOwnCrestColor(club.id, url, colors)
        if (!cancelled) bump((n) => n + 1)
      }
    })()
    return () => { cancelled = true }
  }, [stored, withCrest, viewerId])

  return { withCrest, stored, viewerId }
}

export function useClubCrestColors(clubs: Club[]): Map<string, string | null> {
  const { withCrest, stored } = useCrestColorRows(clubs)
  const out = new Map<string, string | null>()
  for (const c of withCrest) {
    const row = stored?.get(c.id)
    out.set(c.id, row && row.url === c.avatar_url ? row.color : computed.get(c.avatar_url as string)?.color ?? null)
  }
  return out
}

/** Same rows, the palette side: null when none is usable (→ coverBackground(null)). */
export function useClubCrestPalettes(clubs: Club[]): Map<string, CrestPalette | null> {
  const { withCrest, stored } = useCrestColorRows(clubs)
  const out = new Map<string, CrestPalette | null>()
  for (const c of withCrest) {
    const row = stored?.get(c.id)
    out.set(c.id, row && row.url === c.avatar_url && row.palette ? row.palette : computed.get(c.avatar_url as string)?.palette ?? null)
  }
  return out
}
