import { useEffect, useMemo } from 'react'
import { useNotificationStore } from '@/lib/notifications'
import { unseenRequestNotificationIds } from '@/lib/inboxSegmentDots'

/**
 * Inbox › Requests: opening the segment marks the requests it SHOWS as seen
 * (founder spec 2026-10-09 — a red dot means "something new", not "something
 * pending"). The requests stay pending and listed; only their notification
 * rows get read_at, through the same mark_notification_read RPC the Activity
 * list uses, so the seen state is server-side (reloads, other devices) and
 * the Requests dot, the matching Activity rows and the tab-bar Inbox dot all
 * clear together when nothing else is unread.
 *
 * Only requests on screen are marked: one that arrives after the list was
 * loaded keeps its dot until the list shows it.
 */
export function useMarkInboxRequestsSeen(
  active: boolean,
  shownRequestIds: ReadonlyArray<string>,
  shownClubInvitationIds: ReadonlyArray<string>,
): void {
  const notifications = useNotificationStore((s) => s.notifications)
  const markRead = useNotificationStore((s) => s.markRead)
  const requestKey = shownRequestIds.join(',')
  const invitationKey = shownClubInvitationIds.join(',')

  const unseen = useMemo(
    () =>
      active
        ? unseenRequestNotificationIds({
            pendingRequestIds: requestKey ? requestKey.split(',') : [],
            clubInvitationIds: invitationKey ? invitationKey.split(',') : [],
            notifications,
          })
        : [],
    [active, requestKey, invitationKey, notifications],
  )
  const unseenKey = unseen.join(',')

  useEffect(() => {
    if (!unseenKey) return
    // markRead is optimistic and skips rows already read, so a re-run while
    // the RPC is in flight never double-writes.
    for (const id of unseenKey.split(',')) void markRead(id)
  }, [unseenKey, markRead])
}
