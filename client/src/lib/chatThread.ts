/**
 * Pure helpers for the chat thread's paging and refresh (hooks/useChat).
 */

export interface MessageCursor {
  sentAt: string
  messageId: string
}

/**
 * PostgREST `or=` filter for the page older than `cursor`: strictly earlier
 * `sent_at`, or the same instant with a smaller id (the thread's tiebreak).
 *
 * The values go in raw, double-quoted. supabase-js URL-encodes the whole
 * parameter once; encoding them here as well sent `%3A` and `%2B` through to
 * Postgres, which rejected the timestamp (`invalid input syntax for type
 * timestamp with time zone`), so no thread could ever load past its newest
 * 50 messages (2026-10-14). The quotes keep the `+00:00` offset and the
 * colons out of the filter grammar.
 */
export function olderMessagesCursorFilter(cursor: MessageCursor): string {
  const sentAt = quote(cursor.sentAt)
  const id = quote(cursor.messageId)
  return `sent_at.lt.${sentAt},and(sent_at.eq.${sentAt},id.lt.${id})`
}

function quote(value: string): string {
  return `"${value.replace(/["\\]/g, '')}"`
}

interface ThreadMessage {
  id: string
  sent_at: string
}

/**
 * Fold a fresh "newest page" into the messages already on screen: rows the
 * thread already holds are updated in place (edits, read receipts), new ones
 * are added, and the older pages the reader scrolled up to are kept. Used by
 * the realtime-reconnect refetch, which used to replace the thread wholesale
 * behind a skeleton and so threw the reader back to the bottom.
 */
export function mergeFetchedMessages<T extends ThreadMessage>(existing: readonly T[], fetched: readonly T[]): T[] {
  if (!existing.length) return [...fetched]
  const byId = new Map(existing.map(message => [message.id, message]))
  for (const message of fetched) byId.set(message.id, message)
  return [...byId.values()].sort(compareMessages)
}

function compareMessages(a: ThreadMessage, b: ThreadMessage): number {
  if (a.sent_at !== b.sent_at) return a.sent_at < b.sent_at ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}
