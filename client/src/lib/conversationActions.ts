import { useCallback } from 'react'
import { queryClient as appQueryClient } from '@/lib/queryClient'
import { supabase } from '@/lib/supabase'
import { qk } from '@/lib/queryKeys'
import { useToastStore } from '@/lib/toast'
import { logger } from '@/lib/logger'

/**
 * Per-member conversation and message actions (founder 2026-11-10), backed by
 * migration 20261110100000_messaging_per_user_state:
 *  - Mark as unread: a reminder only the member sees. The row and the Inbox
 *    tab show the unread dot until the member opens the conversation again.
 *  - Delete conversation: clears the history for the member only and hides
 *    the row; a new message from the other person brings it back with only
 *    the new messages. The other person is never told.
 *  - Delete for me: hides one message for the member only (any message).
 * Nothing is hard-deleted (ruling 2026-09-23); "Delete for everyone" stays
 * the author's soft delete in useChat.
 */
export async function setConversationMarkedUnread(conversationId: string, unread: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_conversation_marked_unread', {
    p_conversation_id: conversationId,
    p_unread: unread,
  })
  if (error) throw error
}

/** Mark read from the list: the messages (read receipts) and the reminder. */
export async function markConversationRead(conversationId: string): Promise<void> {
  const { error } = await supabase.rpc('mark_conversation_messages_read', { p_conversation_id: conversationId })
  if (error) throw error
}

export async function deleteConversationForMe(conversationId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_conversation_for_me', { p_conversation_id: conversationId })
  if (error) throw error
}

export async function hideMessageForMe(messageId: string): Promise<void> {
  const { error } = await supabase.rpc('hide_message_for_me', { p_message_id: messageId })
  if (error) throw error
}

/** Every cache that lists conversations or feeds the Inbox dot. */
export function invalidateConversationCaches(userId: string | null, queryClient = appQueryClient) {
  if (!userId) return
  void queryClient.invalidateQueries({ queryKey: ['inbox-conversations', userId] })
  void queryClient.invalidateQueries({ queryKey: ['conversations', 'page', userId] })
  void queryClient.invalidateQueries({ queryKey: qk.unreadCount(userId) })
}

interface InboxRowLike {
  conversation_id: string
  unread_count: number | null
}

/**
 * List actions with optimistic updates of the phone Inbox cache; callers that
 * keep their own state (the desktop list) pass `onLocalChange` to mirror it.
 */
export function useConversationActions(userId: string | null) {
  const addToast = useToastStore((s) => s.addToast)

  const patchInbox = useCallback((update: (rows: InboxRowLike[]) => InboxRowLike[]) => {
    if (!userId) return () => {}
    const key = ['inbox-conversations', userId]
    const previous = appQueryClient.getQueryData<InboxRowLike[]>(key)
    if (previous) appQueryClient.setQueryData(key, update(previous))
    return () => { if (previous) appQueryClient.setQueryData(key, previous) }
  }, [userId])

  const setUnread = useCallback(async (conversationId: string, unread: boolean) => {
    const rollback = patchInbox((rows) => rows.map((r) => (
      r.conversation_id === conversationId ? { ...r, unread_count: unread ? Math.max(1, Number(r.unread_count ?? 0)) : 0 } : r
    )))
    try {
      if (unread) await setConversationMarkedUnread(conversationId, true)
      else await markConversationRead(conversationId)
      return true
    } catch (error) {
      rollback()
      logger.error('[INBOX] mark unread/read failed', error)
      addToast(unread ? 'Could not mark as unread. Try again.' : 'Could not mark as read. Try again.', 'error')
      return false
    } finally {
      invalidateConversationCaches(userId)
    }
  }, [addToast, patchInbox, userId])

  const deleteConversation = useCallback(async (conversationId: string) => {
    const rollback = patchInbox((rows) => rows.filter((r) => r.conversation_id !== conversationId))
    try {
      await deleteConversationForMe(conversationId)
      addToast('Conversation deleted', 'success')
      return true
    } catch (error) {
      rollback()
      logger.error('[INBOX] delete conversation failed', error)
      addToast('Could not delete the conversation. Try again.', 'error')
      return false
    } finally {
      invalidateConversationCaches(userId)
    }
  }, [addToast, patchInbox, userId])

  return { setUnread, deleteConversation }
}
