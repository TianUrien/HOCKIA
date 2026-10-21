import { useEffect } from 'react'
import { loadFriendshipEdges } from '@/hooks/friendshipEdgeCache'
import { useAuthStore } from '@/lib/auth'

/**
 * Inbox segments, shared by the phone Inbox tab and the desktop master-detail
 * inbox (design audit 2026-10-21, B4): Messages · Requests · Activity, one
 * route each (/inbox, /inbox/requests, /inbox/activity). A thread lives at
 * /messages/:conversationId and belongs to Messages.
 */
export const INBOX_SEGMENTS = ['messages', 'requests', 'activity'] as const
export type InboxSegment = (typeof INBOX_SEGMENTS)[number]

export const isInboxSegment = (value: string | undefined): value is InboxSegment =>
  Boolean(value) && (INBOX_SEGMENTS as readonly string[]).includes(value as string)

/** The segment a path shows: /inbox/requests → requests; /messages… and /inbox → messages. */
export function inboxSegmentFromPath(pathname: string): InboxSegment {
  const m = /^\/inbox\/([^/?#]+)/.exec(pathname)
  return m && isInboxSegment(m[1]) ? m[1] : 'messages'
}

export function inboxSegmentPath(segment: InboxSegment): string {
  return segment === 'messages' ? '/inbox' : `/inbox/${segment}`
}

/**
 * Opening Inbox re-reads the shared friendship edges so the Requests dot
 * (and the tab-bar dot, which shares it) matches the list shown.
 */
export function useRefreshInboxEdges(enabled = true) {
  const viewerId = useAuthStore((s) => s.profile?.id ?? null)
  useEffect(() => {
    if (enabled && viewerId) void loadFriendshipEdges(viewerId, true)
  }, [enabled, viewerId])
}
