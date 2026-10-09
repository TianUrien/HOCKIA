import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuthStore } from '@/lib/auth'
import { useNotificationStore } from '@/lib/notifications'
import { useUnreadMessages } from '@/hooks/useUnreadMessages'
import { useMyClubInvitations } from '@/hooks/useClubInvitations'
import {
  getFriendshipEdgeState,
  loadFriendshipEdges,
  subscribeFriendshipEdges,
} from '@/hooks/friendshipEdgeCache'
import {
  computeInboxSegmentDots,
  incomingPendingRequestIds,
  type InboxSegmentDots,
} from '@/lib/inboxSegmentDots'

/**
 * Inbox segment dots, shared by the Inbox segmented control and the tab-bar
 * Inbox dot so the two always agree. Reads stores the app already keeps:
 * the unread-messages store, the notification store and the shared
 * friendship-edge cache (one fetch per viewer, refreshed on every
 * accept / decline / cancel via invalidateFriendshipEdges).
 */
export function useInboxSegmentDots(): InboxSegmentDots {
  const { count: unreadMessages } = useUnreadMessages()
  const notifications = useNotificationStore((s) => s.notifications)
  const notificationsLoading = useNotificationStore((s) => s.loading)
  const notificationsUserId = useNotificationStore((s) => s.userId)
  const viewerId = useAuthStore((s) => s.profile?.id ?? undefined)
  const { invitations } = useMyClubInvitations()
  const clubInvitationKey = invitations.map((i) => i.clubMemberId).join(',')
  const [, forceRender] = useState(0)

  useEffect(() => {
    const unsubscribe = subscribeFriendshipEdges(() => forceRender((n) => n + 1))
    if (viewerId) void loadFriendshipEdges(viewerId)
    // The shared fetch may have resolved before the listener existed.
    forceRender((n) => n + 1)
    return unsubscribe
  }, [viewerId])

  // A new friend request arrives as a realtime notification; refetch the
  // edge cache then so the Requests dot appears without a reload (the dot
  // needs both: the pending edge AND its unread notification).
  const newestRequestAt = useMemo(
    () =>
      notifications.reduce(
        (latest, n) => (n.kind === 'friend_request_received' && n.createdAt > latest ? n.createdAt : latest),
        '',
      ),
    [notifications],
  )
  const requestBaseline = useRef<string | null>(null)
  useEffect(() => {
    if (!viewerId || notificationsLoading || !notificationsUserId) return
    if (requestBaseline.current !== null && newestRequestAt > requestBaseline.current) {
      void loadFriendshipEdges(viewerId, true)
    }
    requestBaseline.current = newestRequestAt
  }, [viewerId, notificationsLoading, notificationsUserId, newestRequestAt])

  const { edges } = getFriendshipEdgeState(viewerId)
  // Stable string key: the edge Map is mutated in place by the shared cache.
  const pendingRequestKey = incomingPendingRequestIds(edges ? edges.values() : [], viewerId).join(',')

  return useMemo(
    () =>
      computeInboxSegmentDots({
        unreadMessages,
        pendingRequestIds: pendingRequestKey ? pendingRequestKey.split(',') : [],
        clubInvitationIds: clubInvitationKey ? clubInvitationKey.split(',') : [],
        notifications,
      }),
    [unreadMessages, pendingRequestKey, clubInvitationKey, notifications],
  )
}
