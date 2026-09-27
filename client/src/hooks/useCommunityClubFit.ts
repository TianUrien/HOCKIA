import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { reportSupabaseError } from '@/lib/sentryHelpers'
import type { FitState } from '@/lib/clubRecruiting'
import type { ClubViewFit } from '@/lib/communityClubView'

/**
 * Fit + highlight counts for the players on Community in club view (Figma
 * D1.17; DEV NOTE 355:905). Fit = get_club_fit_batch for the active recruiting
 * context (compute_club_fit, cached in club_fit_cache) — the same source as
 * Find players, so the chip reads the same on both screens. Disabled for
 * anyone who is not a recruiting viewer (the caller gates it) and when the
 * context has no fit target.
 */
const CHUNK = 100

export interface CommunityClubFit {
  fit: Map<string, ClubViewFit>
  highlights: Map<string, number>
}

const EMPTY: CommunityClubFit = { fit: new Map(), highlights: new Map() }

export function useCommunityClubFit(playerIds: string[], contextId: string | null, enabled: boolean) {
  const ids = [...new Set(playerIds)].sort()
  const query = useQuery({
    queryKey: ['community-club-fit', contextId, ids.join(',')],
    enabled: enabled && ids.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<CommunityClubFit> => {
      const chunks: string[][] = []
      for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK))
      const [fitRes, videoRes] = await Promise.all([
        contextId
          ? Promise.all(chunks.map((c) => supabase.rpc('get_club_fit_batch', { p_player_ids: c, p_context_id: contextId })))
          : Promise.resolve([]),
        Promise.all(chunks.map((c) => supabase.from('player_videos').select('user_id').in('user_id', c).eq('kind', 'highlight').eq('status', 'ready'))),
      ])
      const out: CommunityClubFit = { fit: new Map(), highlights: new Map() }
      for (const r of fitRes) {
        if (r.error) { reportSupabaseError('useCommunityClubFit.fit', r.error); continue }
        for (const row of (r.data ?? []) as { player_id: string; state: string; score: number | string }[]) {
          out.fit.set(row.player_id, { state: row.state as FitState, score: Number(row.score) })
        }
      }
      for (const r of videoRes) {
        for (const v of (r.data ?? []) as { user_id: string }[]) out.highlights.set(v.user_id, (out.highlights.get(v.user_id) ?? 0) + 1)
      }
      return out
    },
  })
  return { ...(query.data ?? EMPTY), loading: query.isLoading && enabled && ids.length > 0 }
}
