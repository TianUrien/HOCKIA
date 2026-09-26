import { useMemo } from 'react'
import { useNotificationStore } from '@/lib/notifications'
import { useUnreadMessages } from '@/hooks/useUnreadMessages'
import { computeInboxSegmentDots, type InboxSegmentDots } from '@/lib/inboxSegmentDots'

/** Inbox segment dots from the stores the app already keeps (no new query). */
export function useInboxSegmentDots(incomingRequests: number): InboxSegmentDots {
  const { count: unreadMessages } = useUnreadMessages()
  const notifications = useNotificationStore((s) => s.notifications)
  return useMemo(
    () => computeInboxSegmentDots({ unreadMessages, incomingRequests, notifications }),
    [unreadMessages, incomingRequests, notifications],
  )
}
