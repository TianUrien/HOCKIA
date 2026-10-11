import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import type { CommonFriend } from '@/hooks/useFriendsInCommon'

/**
 * The viewer's friends whose current club is this world club — the club
 * preview's "Friends here" fact and "3 of your friends play here" (Figma
 * Community P11). Needs the club's world-club link: without one the fact is
 * hidden (spec), so the hook stays idle. Own friend edges (RLS: own rows),
 * then one profiles read for the friends at that club.
 */
export function useFriendsAtClub(worldClubId: string | null | undefined) {
  const viewerId = useAuthStore((s) => s.user?.id ?? null)
  const { data, isLoading } = useQuery({
    queryKey: ['friends-at-club', viewerId, worldClubId],
    enabled: Boolean(viewerId && worldClubId),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<CommonFriend[]> => {
      const { data: edges, error } = await supabase
        .from('profile_friend_edges')
        .select('friend_id')
        .eq('profile_id', viewerId as string)
        .eq('status', 'accepted')
      if (error) throw error
      const ids = (edges ?? []).map((e) => e.friend_id).filter((id): id is string => Boolean(id))
      if (ids.length === 0) return []
      const { data: rows, error: rowsError } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url, role')
        .in('id', ids.slice(0, 500))
        .eq('current_world_club_id', worldClubId as string)
      if (rowsError) throw rowsError
      return (rows ?? []).map((r) => ({ id: r.id, fullName: r.full_name, avatarUrl: r.avatar_url, role: r.role }))
    },
  })
  return { people: data ?? [], loading: Boolean(viewerId && worldClubId) && isLoading, linked: Boolean(worldClubId) }
}
