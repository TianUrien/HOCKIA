import { useEffect } from 'react'
import { useUnreadMessages } from '@/hooks/useUnreadMessages'
import { useOpportunityNotifications } from '@/hooks/useOpportunityNotifications'
import { useAuthStore } from '@/lib/auth'
import { useNotificationStore } from '@/lib/notifications'
import { setAppBadge } from '@/lib/nativeUi'

/**
 * NotificationBridge mounts once within the app shell so notification stores
 * stay initialized even when the header or bottom navigation are hidden.
 */
export default function NotificationBridge() {
  useUnreadMessages()
  useOpportunityNotifications()
  const userId = useAuthStore((state) => state.user?.id ?? null)
  const initializeNotifications = useNotificationStore((state) => state.initialize)
  const unreadCount = useNotificationStore((state) => state.unreadCount)

  useEffect(() => {
    void initializeNotifications(userId)
  }, [initializeNotifications, userId])

  // Keep the native app-icon badge in sync with the unread-notification count so
  // it clears when the user reads them (no more stuck hardcoded "1"). The store
  // refreshes on app foreground, so re-opening after reading clears the badge.
  // No-op on web; logged out → clear.
  useEffect(() => {
    void setAppBadge(userId ? unreadCount : 0)
  }, [userId, unreadCount])

  return null
}
