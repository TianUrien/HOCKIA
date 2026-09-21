import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { invalidateFriendshipEdges } from '@/hooks/friendshipEdgeCache'
import type { Database } from '@/lib/database.types'

type FriendEdge = Database['public']['Views']['profile_friend_edges']['Row']
type FriendStatus = Database['public']['Enums']['friendship_status']

export interface FriendRequestPerson {
  id: string
  full_name: string | null
  username: string | null
  avatar_url: string | null
  role: string | null
  position: string | null
  current_club: string | null
}

export interface FriendRequest {
  /** profile_friendships.id — what accept / decline / cancel update. */
  friendshipId: string
  person: FriendRequestPerson | null
  createdAt: string | null
}

export type FriendRequestAction = 'accept' | 'decline' | 'cancel'

const ACTION_STATUS: Record<FriendRequestAction, FriendStatus> = {
  accept: 'accepted',
  decline: 'rejected',
  cancel: 'cancelled',
}

/**
 * Pending friend requests for the signed-in member, split into received and
 * sent (Figma Inbox — Requests). Same tables FriendsTab uses
 * (profile_friend_edges view + profile_friendships updates); the Inbox just
 * gives them a first-class screen.
 */
export function useFriendRequests() {
  const profileId = useAuthStore((s) => s.profile?.id ?? null)
  const refreshAuthProfile = useAuthStore((s) => s.refreshProfile)
  const addToast = useToastStore((s) => s.addToast)
  const [incoming, setIncoming] = useState<FriendRequest[]>([])
  const [outgoing, setOutgoing] = useState<FriendRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [pendingId, setPendingId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!profileId) {
      setIncoming([])
      setOutgoing([])
      setLoading(false)
      return
    }
    try {
      const { data: edges, error } = await supabase
        .from('profile_friend_edges')
        .select('*')
        .eq('profile_id', profileId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
      if (error) throw error

      const rows = (edges ?? []) as FriendEdge[]
      const ids = Array.from(new Set(rows.map((e) => e.friend_id).filter((id): id is string => Boolean(id))))
      const people = new Map<string, FriendRequestPerson>()
      if (ids.length > 0) {
        const { data: profiles, error: profileError } = await supabase
          .from('profiles')
          .select('id, full_name, username, avatar_url, role, position, current_club')
          .in('id', ids)
        if (profileError) throw profileError
        for (const p of profiles ?? []) people.set(p.id, p as FriendRequestPerson)
      }

      const toRequest = (edge: FriendEdge): FriendRequest | null =>
        edge.id
          ? {
              friendshipId: edge.id,
              person: edge.friend_id ? people.get(edge.friend_id) ?? null : null,
              createdAt: edge.created_at,
            }
          : null

      setIncoming(rows.filter((e) => e.requester_id !== profileId).map(toRequest).filter((r): r is FriendRequest => r !== null))
      setOutgoing(rows.filter((e) => e.requester_id === profileId).map(toRequest).filter((r): r is FriendRequest => r !== null))
    } catch (err) {
      logger.error('[useFriendRequests] load failed', err)
    } finally {
      setLoading(false)
    }
  }, [profileId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const respond = useCallback(
    async (friendshipId: string, action: FriendRequestAction): Promise<boolean> => {
      setPendingId(friendshipId)
      try {
        const { error } = await supabase
          .from('profile_friendships')
          .update({ status: ACTION_STATUS[action] })
          .eq('id', friendshipId)
        if (error) throw error
        invalidateFriendshipEdges()
        if (action === 'accept') void refreshAuthProfile()
        await refresh()
        return true
      } catch (err) {
        logger.error('[useFriendRequests] update failed', err)
        addToast('Could not update the request. Please try again.', 'error')
        return false
      } finally {
        setPendingId(null)
      }
    },
    [addToast, refresh, refreshAuthProfile],
  )

  return { incoming, outgoing, loading, pendingId, respond, refresh }
}
