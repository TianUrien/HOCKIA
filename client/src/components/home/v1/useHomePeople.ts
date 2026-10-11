import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { PROFILES_SELECT } from '@/lib/communitySelect'
import type { Profile } from '@/components/community/PeopleListView'

/**
 * The people rows on Home (Figma 60:158 / H2 / H13). Every list goes through a
 * fenced RPC — hidden, blocked (either side), age-gated and, for club-facing
 * viewers, under-18 players never appear:
 *   new       → get_new_members (Community's own search, re-sorted newest first)
 *   available → community_search_members, players open to play (clubs, recruiting coaches)
 *   pymk      → get_people_you_may_know (friends of friends, then newest; end of feed)
 */
export type PeopleKind = 'new' | 'available' | 'pymk'

export interface PersonFace {
  id: string
  full_name: string | null
  avatar_url: string | null
  role: string
}

const LIMIT = 12

export function useHomePeople(kind: PeopleKind, enabled = true) {
  const viewerId = useAuthStore((s) => s.user?.id ?? null)
  return useQuery({
    queryKey: ['home-people', kind, viewerId],
    enabled: enabled && Boolean(viewerId),
    staleTime: 60_000,
    queryFn: async (): Promise<{ faces: PersonFace[]; profiles: Profile[] | null }> => {
      if (kind === 'new') {
        const { data, error } = await supabase.rpc('get_new_members', { p_limit: LIMIT })
        if (error) throw error
        const profiles = (Array.isArray(data) ? data : []) as unknown as Profile[]
        return { faces: profiles, profiles }
      }
      if (kind === 'available') {
        const { data, error } = await supabase.rpc('community_search_members', { p_role: 'player', p_availability_open: true, p_limit: LIMIT })
        if (error) throw error
        const profiles = (((data ?? {}) as { results?: Profile[] }).results ?? []).filter((p) => p.id !== viewerId)
        return { faces: profiles, profiles }
      }
      const { data, error } = await supabase.rpc('get_people_you_may_know', { p_limit: LIMIT })
      if (error) throw error
      return { faces: (data ?? []) as PersonFace[], profiles: null }
    },
  })
}

/** Full profile rows for a list of ids, in that order (deck from light rows). */
export async function fetchProfilesByIds(ids: string[]): Promise<Profile[]> {
  if (ids.length === 0) return []
  const { data, error } = await supabase.from('profiles').select(PROFILES_SELECT).in('id', ids)
  if (error) throw error
  const byId = new Map(((data ?? []) as unknown as Profile[]).map((p) => [p.id, p]))
  return ids.map((id) => byId.get(id)).filter((p): p is Profile => Boolean(p))
}
