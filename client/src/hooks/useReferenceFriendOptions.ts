import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import type { ReferenceFriendOption } from '@/components/AddReferenceModal'

/**
 * Fetches a profile's accepted friendships and shapes them as
 * ReferenceFriendOption[] — the list TrustedReferencesSection needs for the
 * "Add Reference" picker.
 *
 * Mirrors the inline fetch FriendsTab does, so we can render the references
 * section on UmpireDashboard (and any other dashboard) without dragging the
 * whole FriendsTab component along.
 */
export function useReferenceFriendOptions(profileId: string | null) {
  const [friendOptions, setFriendOptions] = useState<ReferenceFriendOption[]>([])
  const [loading, setLoading] = useState<boolean>(Boolean(profileId))

  const fetch = useCallback(async () => {
    if (!profileId) {
      setFriendOptions([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const { data: edges, error: edgeError } = await supabase
        .from('profile_friend_edges')
        .select('friend_id, accepted_at')
        .eq('profile_id', profileId)
        .eq('status', 'accepted')

      if (edgeError) throw edgeError

      // Most-recent accepted_at wins per friend (the underlying view emits two
      // rows per friendship; both share the same accepted_at, but be defensive).
      const acceptedAtByFriend = new Map<string, string | null>()
      for (const edge of edges ?? []) {
        if (!edge.friend_id) continue
        const existing = acceptedAtByFriend.get(edge.friend_id)
        if (!existing || (edge.accepted_at && edge.accepted_at > existing)) {
          acceptedAtByFriend.set(edge.friend_id, edge.accepted_at ?? null)
        }
      }

      const friendIds = Array.from(acceptedAtByFriend.keys())

      if (friendIds.length === 0) {
        setFriendOptions([])
        return
      }

      const { data: profiles, error: profileError } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url, role, username, base_location, current_club')
        .in('id', friendIds)

      if (profileError) throw profileError

      const options: ReferenceFriendOption[] = (profiles ?? []).map((p) => ({
        id: p.id,
        fullName: p.full_name || p.username || 'Hockia Member',
        username: p.username,
        avatarUrl: p.avatar_url,
        role: p.role,
        baseLocation: p.base_location,
        currentClub: p.current_club ?? null,
        acceptedAt: acceptedAtByFriend.get(p.id) ?? null,
      }))

      setFriendOptions(options)
    } catch (err) {
      logger.error('[useReferenceFriendOptions] fetch failed:', err)
      setFriendOptions([])
    } finally {
      setLoading(false)
    }
  }, [profileId])

  useEffect(() => {
    void fetch()
  }, [fetch])

  return useMemo(
    () => ({ friendOptions, loading, refresh: fetch }),
    [friendOptions, loading, fetch]
  )
}
