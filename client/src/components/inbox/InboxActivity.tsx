import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useNotificationStore } from '@/lib/notifications'
import { useToastStore } from '@/lib/toast'
import type { NotificationRecord } from '@/lib/api/notifications'
import { getNotificationConfig, resolveNotificationRoute } from '@/components/notifications/config'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { formatActivityAge } from '@/lib/inboxTime'
import { identityLine } from '@/lib/identity'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { cn } from '@/lib/utils'

/**
 * Inbox › Activity (Figma 100:531): profile views, club replies, expired
 * applications, references — one list, newest first, purple dot while
 * unread. Same store the notifications drawer reads (profile_notifications),
 * so nothing is fetched twice.
 */
export function InboxActivity() {
  const navigate = useNavigate()
  const addToast = useToastStore((s) => s.addToast)
  const notifications = useNotificationStore((s) => s.notifications)
  const loading = useNotificationStore((s) => s.loading)
  const unreadCount = useNotificationStore((s) => s.unreadCount)
  const markRead = useNotificationStore((s) => s.markRead)
  const markAllRead = useNotificationStore((s) => s.markAllRead)
  const respondToFriendRequest = useNotificationStore((s) => s.respondToFriendRequest)
  const pendingFriendshipId = useNotificationStore((s) => s.pendingFriendshipId)

  const rows = useMemo(
    () =>
      notifications
        .filter((n) => !n.clearedAt)
        .slice()
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [notifications],
  )

  const open = (notification: NotificationRecord) => {
    if (!notification.readAt) void markRead(notification.id)
    trackDbEvent('notification_click', 'notification', notification.id, { kind: notification.kind })
    const route = resolveNotificationRoute(notification)
    if (route) navigate(route)
  }

  const answerFriendRequest = async (notification: NotificationRecord, action: 'accept' | 'decline') => {
    const friendshipId = notification.sourceEntityId
    if (!friendshipId) return
    const ok = await respondToFriendRequest({ friendshipId, action })
    if (!ok) addToast('Could not update the request. Please try again.', 'error')
  }

  if (loading && rows.length === 0) {
    return (
      <div className="flex justify-center py-12 text-ink-3">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    )
  }

  return (
    <section aria-label="Activity">
      {unreadCount > 0 && (
        <div className="flex justify-end px-5 pb-1">
          <button type="button" onClick={() => void markAllRead()} className="text-secondary font-medium text-ink-2">
            Mark all as read
          </button>
        </div>
      )}
      {rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-row text-ink-2">Nothing new yet. Profile views, club replies and references land here.</p>
      ) : (
        <ul>
          {rows.map((notification) => {
            const config = getNotificationConfig(notification)
            const unread = !notification.readAt
            const actor = notification.actor
            const name = actor?.fullName || actor?.username || 'HOCKIA member'
            const description = config.getDescription?.(notification)
            const route = resolveNotificationRoute(notification)
            const isFriendRequest = notification.kind === 'friend_request_received'
            const busy = pendingFriendshipId === notification.sourceEntityId
            return (
              <li key={notification.id}>
                <div
                  role={route ? 'button' : undefined}
                  tabIndex={route ? 0 : undefined}
                  onClick={route ? () => open(notification) : undefined}
                  onKeyDown={
                    route
                      ? (event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            open(notification)
                          }
                        }
                      : undefined
                  }
                  className={cn('flex items-start gap-3 px-5 py-3 text-left', route && 'cursor-pointer transition-colors active:bg-surface-muted')}
                >
                  <EntityAvatar src={actor?.avatarUrl} name={name} role={actor?.role} size={44} />
                  <span className="min-w-0 flex-1">
                    <span className={cn('block text-row text-ink-1', unread ? 'font-semibold' : 'font-medium')}>{config.getTitle(notification)}</span>
                    {actor?.role && <span className="block text-secondary text-ink-2">{identityLine(actor.role)}</span>}
                    {description && <span className="block text-secondary text-ink-2">{description}</span>}
                    <span className="block pt-0.5 text-secondary text-ink-4">{formatActivityAge(notification.createdAt)}</span>
                    {isFriendRequest && (
                      <span className="mt-2 flex gap-1.5">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={(e) => { e.stopPropagation(); void answerFriendRequest(notification, 'accept') }}
                          className="flex h-[34px] items-center rounded-full bg-hockia-primary px-3.5 text-[14px] font-semibold text-white disabled:opacity-60"
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={(e) => { e.stopPropagation(); void answerFriendRequest(notification, 'decline') }}
                          className="flex h-[34px] items-center rounded-full bg-surface-grouped px-3.5 text-[14px] font-semibold text-ink-1 disabled:opacity-60"
                        >
                          Decline
                        </button>
                      </span>
                    )}
                  </span>
                  {unread && <span aria-label="Unread" className="mt-2 h-2 w-2 shrink-0 rounded-full bg-hockia-primary" />}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
