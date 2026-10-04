import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useNotificationStore } from '@/lib/notifications'
import { useToastStore } from '@/lib/toast'
import type { NotificationRecord } from '@/lib/api/notifications'
import { getNotificationConfig, resolveNotificationRoute } from '@/components/notifications/config'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { ActivityIconCircle, ActivityRow } from '@/components/ui/ActivityRow'
import { buttonClassName } from '@/components/ui/buttonClasses'
import { formatActivityAge } from '@/lib/inboxTime'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { friendRequestToastType } from '@/lib/friendshipErrors'
import { useRespondToClubInvite } from '@/hooks/useRespondToClubInvite'

/**
 * Inbox › Activity (Figma 100:531): profile views, club replies, expired
 * applications, references — one list, newest first. Rows are List item /
 * Activity (ui/ActivityRow): avatar 40 (or a brand-soft icon circle for a
 * system event), the sentence, the time under it, a chevron only when the
 * row leads somewhere, and a purple dot while unread. Same store the notifications drawer reads (profile_notifications),
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
  const clubInvite = useRespondToClubInvite()

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
    const result = await respondToFriendRequest({ friendshipId, action })
    if (result !== true) { const msg = typeof result === 'string' ? result : 'Could not update the request. Please try again.'; addToast(msg, friendRequestToastType(msg)) }
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
          <button type="button" onClick={() => void markAllRead()} className="flex h-9 items-center text-secondary font-semibold text-hockia-primary">
            Mark all as read
          </button>
        </div>
      )}
      {rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-row text-ink-2">Nothing new yet. Profile views, club replies and references land here.</p>
      ) : (
        <ul>
          {rows.map((notification, index) => {
            const config = getNotificationConfig(notification)
            const unread = !notification.readAt
            const actor = notification.actor
            const name = actor?.fullName || actor?.username || 'HOCKIA member'
            const description = config.getDescription?.(notification)
            const route = resolveNotificationRoute(notification)
            const isFriendRequest = notification.kind === 'friend_request_received'
            // Squad invitations answer inline too (same buttons as a friend
            // request); the row itself still opens the club profile.
            const isClubInvite = notification.kind === 'club_invitation_received' && Boolean(notification.sourceEntityId)
            const busy = isClubInvite
              ? clubInvite.pendingId === notification.sourceEntityId
              : pendingFriendshipId === notification.sourceEntityId
            const answer = (action: 'accept' | 'decline') => {
              if (isClubInvite) void clubInvite.respond(notification.sourceEntityId!, action)
              else void answerFriendRequest(notification, action)
            }
            return (
              <li key={notification.id}>
                <ActivityRow
                  className={index === rows.length - 1 ? 'is-last' : undefined}
                  leading={
                    actor
                      ? <EntityAvatar src={actor.avatarUrl} name={name} role={actor.role} size={40} />
                      : <ActivityIconCircle icon={config.icon} />
                  }
                  text={config.getTitle(notification)}
                  detail={description}
                  when={formatActivityAge(notification.createdAt)}
                  onOpen={route ? () => open(notification) : undefined}
                  unread={unread}
                >
                  {(isFriendRequest || isClubInvite) && (
                    <span className="mt-2 flex gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={(e) => { e.stopPropagation(); answer('accept') }}
                        className={buttonClassName({ variant: 'primary', size: 'small', radius: 'rounded-full' })}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={(e) => { e.stopPropagation(); answer('decline') }}
                        className={buttonClassName({ variant: 'secondary', size: 'small', radius: 'rounded-full' })}
                      >
                        Decline
                      </button>
                    </span>
                  )}
                </ActivityRow>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
