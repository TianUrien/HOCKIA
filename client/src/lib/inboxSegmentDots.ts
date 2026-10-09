// Pure (no Supabase import) so it unit-tests without env vars; the hook
// wiring lives in hooks/useInboxSegmentDots.
export interface InboxSegmentDots {
  messages: boolean
  requests: boolean
  activity: boolean
}

/** The profile_notifications fields the dot rules read. */
export interface InboxDotNotification {
  id: string
  kind: string
  sourceEntityId: string | null
  readAt: string | null
  clearedAt: string | null
}

interface RequestSeenInput {
  /** profile_friendships ids of the pending requests the viewer RECEIVED. */
  pendingRequestIds: Iterable<string>
  /** club_members ids of the pending squad invitations addressed to the viewer. */
  clubInvitationIds?: Iterable<string>
  /** profile_notifications rows as held by the notification store. */
  notifications: ReadonlyArray<InboxDotNotification>
}

/**
 * The notifications behind still-pending requests the viewer has NOT seen yet.
 *
 * "Seen" is the notification's server-side read_at (founder spec 2026-10-09:
 * a red dot means something NEW, not something pending). Every friend request
 * and squad invitation enqueues one profile_notifications row whose
 * source_entity_id is the friendship / club_members id; a re-sent request
 * resets that row's read_at (enqueue_notification ON CONFLICT), so it counts
 * as new again. Opening Inbox › Requests marks these rows read, which:
 *  - clears the Requests dot while the requests stay pending and listed;
 *  - persists across reloads and devices (it is a DB column, no migration);
 *  - also clears the same rows' unread state in Activity, so the tab-bar dot
 *    can go out once nothing else is unread.
 * A pending request with no unread row (older than the loaded notifications,
 * or already read) is not new, so it carries no dot.
 */
export function unseenRequestNotificationIds({
  pendingRequestIds,
  clubInvitationIds = [],
  notifications,
}: RequestSeenInput): string[] {
  const friendships = new Set(pendingRequestIds)
  const invitations = new Set(clubInvitationIds)
  if (friendships.size === 0 && invitations.size === 0) return []
  const ids: string[] = []
  for (const n of notifications) {
    if (n.readAt || n.clearedAt || !n.sourceEntityId) continue
    if (
      (n.kind === 'friend_request_received' && friendships.has(n.sourceEntityId)) ||
      (n.kind === 'club_invitation_received' && invitations.has(n.sourceEntityId))
    ) {
      ids.push(n.id)
    }
  }
  return ids
}

interface InboxSegmentDotInput extends RequestSeenInput {
  /** Unread message total for the viewer (the same number behind the tab-bar dot). */
  unreadMessages: number
}

/**
 * Which Inbox segments carry a "new" dot (never a number). Messages = any
 * unread thread; Requests = any pending received request or squad invitation
 * the viewer has not seen yet (see unseenRequestNotificationIds); Activity =
 * any row the Activity list renders as unread (not cleared, not read).
 */
export function computeInboxSegmentDots({
  unreadMessages,
  pendingRequestIds,
  clubInvitationIds,
  notifications,
}: InboxSegmentDotInput): InboxSegmentDots {
  return {
    messages: unreadMessages > 0,
    requests: unseenRequestNotificationIds({ pendingRequestIds, clubInvitationIds, notifications }).length > 0,
    activity: notifications.some((n) => !n.readAt && !n.clearedAt),
  }
}

/** The tab-bar Inbox dot: on whenever any Inbox segment carries a dot. */
export function inboxTabDot(dots: InboxSegmentDots): boolean {
  return dots.messages || dots.requests || dots.activity
}

/** Ids of the pending requests the viewer received (their own sent requests excluded). */
export function incomingPendingRequestIds(
  edges: Iterable<{ id: string | null; status: string | null; requester_id: string | null }>,
  viewerId: string | null | undefined,
): string[] {
  if (!viewerId) return []
  const ids: string[] = []
  for (const edge of edges) {
    if (edge.id && edge.status === 'pending' && edge.requester_id !== viewerId) ids.push(edge.id)
  }
  return ids
}
