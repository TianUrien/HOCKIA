// Pure (no Supabase import) so it unit-tests without env vars; the hook
// wiring lives in hooks/useInboxSegmentDots.
export interface InboxSegmentDots {
  messages: boolean
  requests: boolean
  activity: boolean
}

interface InboxSegmentDotInput {
  /** Unread message total for the viewer (the same number behind the tab-bar dot). */
  unreadMessages: number
  /** Pending friend requests the viewer received (sent requests excluded). */
  incomingRequests: number
  /** profile_notifications rows as held by the notification store. */
  notifications: ReadonlyArray<{ readAt: string | null; clearedAt: string | null }>
}

/**
 * Which Inbox segments carry a "new" dot (never a number). Each rule mirrors
 * what its segment already shows: Messages = any unread thread, Requests =
 * any pending received request, Activity = any row the Activity list renders
 * as unread (not cleared, not read).
 */
export function computeInboxSegmentDots({
  unreadMessages,
  incomingRequests,
  notifications,
}: InboxSegmentDotInput): InboxSegmentDots {
  return {
    messages: unreadMessages > 0,
    requests: incomingRequests > 0,
    activity: notifications.some((n) => !n.readAt && !n.clearedAt),
  }
}
