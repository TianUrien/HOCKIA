import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { CrestPalette } from '@/lib/crestPalette'
import { useClubCrestPalettes, useWorldClubCrestPalettes } from '@/hooks/useClubCrestColors'

export interface OwnerCrest {
  /** The crest the publisher's roles wear: the club's own, or the directory club a coach recruits for. */
  crestUrl: string | null
  palette: CrestPalette | null
  clubName: string | null
}

type Owner = { id: string; role?: string | null; avatar_url?: string | null; full_name?: string | null; current_world_club_id?: string | null; current_club?: string | null } | null | undefined

/**
 * The publisher's crest + palette for generated covers on the recruiter
 * screens (O4 preview, O5 role cards, O6 applicants header, O8 first run).
 * A club = its own crest; a coach who recruits = the directory club they
 * recruit for (their face is never a cover). No crest → Hockia violet.
 */
export function useOwnerCrest(owner: Owner): OwnerCrest {
  const isCoach = owner?.role === 'coach'
  const worldClubId = isCoach ? owner?.current_world_club_id ?? null : null
  const { data: worldClub } = useQuery({
    queryKey: ['world-club-crest', worldClubId],
    enabled: !!worldClubId,
    staleTime: 10 * 60_000,
    retry: false,
    queryFn: async (): Promise<{ club_name: string | null; avatar_url: string | null } | null> => {
      const { data, error } = await supabase.from('world_clubs').select('club_name, avatar_url').eq('id', worldClubId as string).maybeSingle()
      return error ? null : (data as { club_name: string | null; avatar_url: string | null } | null)
    },
  })
  const clubs = useMemo(() => (owner && !isCoach ? [{ id: owner.id, avatar_url: owner.avatar_url ?? null }] : []), [owner, isCoach])
  const worldClubs = useMemo(() => (worldClubId ? [{ id: worldClubId, avatar_url: worldClub?.avatar_url ?? null }] : []), [worldClubId, worldClub?.avatar_url])
  const profilePalettes = useClubCrestPalettes(clubs)
  const worldPalettes = useWorldClubCrestPalettes(worldClubs)
  if (!owner) return { crestUrl: null, palette: null, clubName: null }
  if (isCoach) {
    return { crestUrl: worldClub?.avatar_url ?? null, palette: worldClubId ? worldPalettes.get(worldClubId) ?? null : null, clubName: worldClub?.club_name ?? owner.current_club ?? null }
  }
  return { crestUrl: owner.avatar_url ?? null, palette: profilePalettes.get(owner.id) ?? null, clubName: owner.full_name ?? null }
}
