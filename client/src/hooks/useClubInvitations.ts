import { useMemo } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/lib/auth'
import { useNotificationStore } from '@/lib/notifications'
import { fetchMyClubInvitations, type MyClubInvitation } from '@/lib/clubInvitations'
import { MY_CLUB_INVITATIONS_KEY } from '@/lib/clubInviteCopy'

const INVITEE_ROLES = new Set(['player', 'coach'])

/**
 * The viewer's pending squad invitations (Inbox › Requests and the Requests
 * dot). Only players and coaches can be invited, so nobody else fetches.
 * The query key carries the uncleared "invited you" notifications, so a new
 * invitation arriving in realtime — or one the club cancels — refetches the
 * list without a reload.
 */
export function useMyClubInvitations(): { invitations: MyClubInvitation[]; loading: boolean } {
  const viewerId = useAuthStore((s) => s.profile?.id ?? null)
  const role = useAuthStore((s) => s.profile?.role ?? null)
  const notifications = useNotificationStore((s) => s.notifications)
  const signature = useMemo(
    () =>
      notifications
        .filter((n) => n.kind === 'club_invitation_received' && !n.clearedAt)
        .map((n) => n.sourceEntityId ?? n.id)
        .sort()
        .join(','),
    [notifications],
  )
  const enabled = Boolean(viewerId) && INVITEE_ROLES.has(role ?? '')
  const query = useQuery({
    queryKey: [...MY_CLUB_INVITATIONS_KEY, viewerId, signature],
    enabled,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    queryFn: () => fetchMyClubInvitations(viewerId!),
  })
  return {
    invitations: enabled ? (query.data ?? []) : [],
    loading: enabled && query.isPending,
  }
}
