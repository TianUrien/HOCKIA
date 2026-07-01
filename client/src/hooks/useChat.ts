import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import * as Sentry from '@sentry/react'
import { supabase } from '@/lib/supabase'
import { isUniqueViolationError } from '@/lib/supabaseErrors'
import { monitor } from '@/lib/monitor'
import { logger } from '@/lib/logger'
import { withRetry } from '@/lib/retry'
import { requestCache, generateCacheKey } from '@/lib/requestCache'
import { useToastStore } from '@/lib/toast'
import { useUnreadStore } from '@/lib/unread'
import { loadMessageDraft, saveMessageDraft, clearMessageDraft } from '@/lib/messageDrafts'
import { reportSupabaseError } from '@/lib/sentryHelpers'
import { checkMessageRateLimit, formatRateLimitError } from '@/lib/rateLimit'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { trackMessageSend, trackConversationStart } from '@/lib/analytics'
import { extractErrorMessage } from '@/lib/utils'
import type { ChatMessage, Message, Conversation, ChatMessageEvent, MessageDeliveryStatus, MessageMetadata, ConversationOrigin } from '@/types/chat'

const MESSAGES_PAGE_SIZE = 50

type MessageCursor = {
  sentAt: string
  messageId: string
}

type ConversationSnapshot = {
  id: string
  isPending?: boolean
  participantOneId?: string | null
  participantTwoId?: string | null
  otherParticipantId?: string | null
}

const deriveConversationDraftKey = (conversation: ConversationSnapshot, viewerId: string | null) => {
  if (!viewerId) {
    return null
  }

  if (conversation.id && !conversation.isPending) {
    return conversation.id
  }

  const otherParticipantId = conversation.participantOneId === viewerId
    ? conversation.participantTwoId ?? conversation.otherParticipantId ?? null
    : conversation.participantTwoId === viewerId
    ? conversation.participantOneId ?? conversation.otherParticipantId ?? null
    : conversation.otherParticipantId ?? conversation.participantTwoId ?? conversation.participantOneId ?? null

  if (!otherParticipantId) {
    return null
  }

  return `pending-${otherParticipantId}`
}

interface UseChatProps {
  conversation: Conversation
  currentUserId: string
  onMessageSent?: (event: ChatMessageEvent) => void
  onConversationCreated: (conversation: Conversation) => void
  onConversationRead?: (conversationId: string) => void
}

export function useChat({
  conversation,
  currentUserId,
  onMessageSent,
  onConversationCreated,
  onConversationRead
}: UseChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [hasMoreMessages, setHasMoreMessages] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  
  const messagesRef = useRef<ChatMessage[]>([])
  const fetchMessagesPromiseRef = useRef<Promise<Message[]> | null>(null)
  const oldestLoadedCursorRef = useRef<MessageCursor | null>(null)
  const pendingReadIdsRef = useRef(new Set<string>())
  const readFlushTimeoutRef = useRef<number | null>(null)
  const unmountedRef = useRef(false)
  
  const { addToast } = useToastStore()
  const initializeUnreadStore = useUnreadStore(state => state.initialize)
  const refreshUnreadCount = useUnreadStore(state => state.refresh)

  const {
    id: conversationId,
    isPending: conversationIsPending,
    participant_one_id: participantOneId,
    participant_two_id: participantTwoId,
    otherParticipant
  } = conversation
  
  const otherParticipantId = otherParticipant?.id ?? null
  
  const conversationDraftKey = useMemo(
    () =>
      deriveConversationDraftKey(
        {
          id: conversationId,
          isPending: conversationIsPending,
          participantOneId,
          participantTwoId,
          otherParticipantId
        },
        currentUserId
      ),
    [conversationId, conversationIsPending, otherParticipantId, participantOneId, participantTwoId, currentUserId]
  )

  useEffect(() => {
    void initializeUnreadStore(currentUserId || null)
  }, [currentUserId, initializeUnreadStore])

  useEffect(() => {
    setHasMoreMessages(true)
    setIsLoadingMore(false)
    oldestLoadedCursorRef.current = null
  }, [conversation.id])

  // Draft management
  useEffect(() => {
    if (!conversationDraftKey || !currentUserId) {
      setNewMessage('')
      return
    }

    const draft = loadMessageDraft(currentUserId, conversationDraftKey)
    setNewMessage(draft)
  }, [conversationDraftKey, currentUserId])

  useEffect(() => {
    if (!conversationDraftKey || !currentUserId) {
      return
    }

    const handle = window.setTimeout(() => {
      if (!newMessage.trim()) {
        clearMessageDraft(currentUserId, conversationDraftKey)
        return
      }
      saveMessageDraft(currentUserId, conversationDraftKey, newMessage)
    }, 400)

    return () => {
      window.clearTimeout(handle)
    }
  }, [conversationDraftKey, currentUserId, newMessage])

  const syncMessagesState = useCallback(
    (next: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
      if (typeof next === 'function') {
        setMessages(prev => {
          const resolved = next(prev)
          messagesRef.current = resolved
          return resolved
        })
      } else {
        messagesRef.current = next
        setMessages(next)
      }
    },
    []
  )

  const fetchMessages = useCallback(async () => {
    if (!conversation.id || conversation.isPending) {
      syncMessagesState([])
      setHasMoreMessages(false)
      setLoading(false)
      return [] as Message[]
    }

    if (fetchMessagesPromiseRef.current) {
      return fetchMessagesPromiseRef.current
    }

    setLoading(true)
    const pendingFetch = (async () => {
      try {
        Sentry.addBreadcrumb({
          category: 'supabase',
          message: 'Fetch recent messages',
          data: { conversationId: conversation.id },
          level: 'info'
        })
        const { data, error } = await supabase
          .from('messages')
          .select('*')
          .eq('conversation_id', conversation.id)
          .order('sent_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(MESSAGES_PAGE_SIZE)

        if (error) throw error

        const fetched: ChatMessage[] = (data ?? []).reverse().map(message => ({
          ...message,
          metadata: message.metadata as unknown as ChatMessage['metadata'],
          status: 'delivered' as const
        }))
        logger.debug('Fetched messages:', fetched)
        syncMessagesState(fetched)
        oldestLoadedCursorRef.current = fetched[0]
          ? {
              sentAt: fetched[0].sent_at,
              messageId: fetched[0].id
            }
          : null
        setHasMoreMessages((data ?? []).length === MESSAGES_PAGE_SIZE)
        return fetched
      } catch (error) {
        logger.error('Error fetching messages:', error)
        reportSupabaseError('messaging_chat.fetch_messages', error, {
          conversationId: conversation.id
        }, {
          feature: 'messaging_chat',
          operation: 'fetch_messages'
        })
        syncMessagesState([])
        setHasMoreMessages(false)
        return [] as Message[]
      } finally {
        setLoading(false)
        fetchMessagesPromiseRef.current = null
      }
    })()

    fetchMessagesPromiseRef.current = pendingFetch
    return pendingFetch
  }, [conversation.id, conversation.isPending, syncMessagesState])

  const loadOlderMessages = useCallback(async () => {
    if (!conversation.id || isLoadingMore || !hasMoreMessages) {
      return false
    }

    const cursor = oldestLoadedCursorRef.current
    if (!cursor) {
      setHasMoreMessages(false)
      return false
    }

    setIsLoadingMore(true)

    try {
      const encodeValue = (value: string) => encodeURIComponent(value)
      const cursorFilter = [
        `sent_at.lt.${encodeValue(cursor.sentAt)}`,
        `and(sent_at.eq.${encodeValue(cursor.sentAt)},id.lt.${encodeValue(cursor.messageId)})`
      ].join(',')

      Sentry.addBreadcrumb({
        category: 'supabase',
        message: 'Load older messages',
        data: { conversationId: conversation.id, cursor },
        level: 'info'
      })
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversation.id)
        .or(cursorFilter)
        .order('sent_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(MESSAGES_PAGE_SIZE)

      if (error) {
        throw error
      }

      const fetched = data ?? []

      if (!fetched.length) {
        setHasMoreMessages(false)
        return false
      }

      const olderMessages = fetched.reverse()
      if (olderMessages[0]) {
        oldestLoadedCursorRef.current = {
          sentAt: olderMessages[0].sent_at,
          messageId: olderMessages[0].id
        }
      }
      setHasMoreMessages(fetched.length === MESSAGES_PAGE_SIZE)

      syncMessagesState(prev => {
        if (!olderMessages.length) {
          return prev
        }

        const existingIds = new Set(prev.map(msg => msg.id))
        const deduped = olderMessages.filter(msg => !existingIds.has(msg.id))

        if (deduped.length === 0) {
          return prev
        }

        return [...deduped.map(msg => ({ ...msg, status: 'delivered' as MessageDeliveryStatus } as ChatMessage)), ...prev]
      })
      
      return true
    } catch (error) {
      logger.error('Error loading older messages:', error)
      reportSupabaseError('messaging_chat.load_older_messages', error, {
        conversationId: conversation.id,
        cursor
      }, {
        feature: 'messaging_chat',
        operation: 'load_older_messages'
      })
      return false
    } finally {
      setIsLoadingMore(false)
    }
  }, [conversation.id, hasMoreMessages, isLoadingMore, syncMessagesState])

  const flushPendingReadReceipts = useCallback(async () => {
    if (!conversation.id || conversation.isPending) {
      pendingReadIdsRef.current.clear()
      return
    }

    const pendingIds = Array.from(pendingReadIdsRef.current)
    if (!pendingIds.length) {
      return
    }

    pendingReadIdsRef.current.clear()
    const optimisticIds = new Set(pendingIds)
    const now = new Date().toISOString()
    const cacheKey = generateCacheKey('unread_count', { userId: currentUserId })
    let latestPendingSentAt: string | null = null

    messagesRef.current.forEach(msg => {
      if (!optimisticIds.has(msg.id)) {
        return
      }
      if (!latestPendingSentAt || msg.sent_at > latestPendingSentAt) {
        latestPendingSentAt = msg.sent_at
      }
    })

    // Only apply optimistic UI update if still mounted
    if (!unmountedRef.current) {
      syncMessagesState(prev =>
        prev.map(msg => (optimisticIds.has(msg.id) ? { ...msg, read_at: now } : msg))
      )
    }

    try {
      Sentry.addBreadcrumb({
        category: 'supabase',
        message: 'Flush pending read receipts',
        data: { conversationId: conversation.id, pendingCount: pendingIds.length },
        level: 'info'
      })
      const { data: updatedRows, error } = await supabase.rpc('mark_conversation_messages_read', {
        p_conversation_id: conversation.id,
        p_before: latestPendingSentAt ?? undefined
      })

      if (error) throw error
      const affectedRows = typeof updatedRows === 'number' ? updatedRows : pendingIds.length

      if (!unmountedRef.current) {
        if (onConversationRead && pendingIds.length > 0) {
          onConversationRead(conversation.id)
        }

        requestCache.invalidate(cacheKey)
        if (onMessageSent && pendingIds.length > 0 && conversation.id) {
          onMessageSent({
            type: 'read',
            conversationId: conversation.id,
            messageIds: pendingIds
          })
        }

        if (affectedRows > 0) {
          void refreshUnreadCount({ bypassCache: true })
        }
      }
    } catch (error) {
      logger.error('Error marking messages as read in database:', error)
      reportSupabaseError('messaging_chat.mark_read', error, {
        conversationId: conversation.id,
        pendingMessageIds: pendingIds
      }, {
        feature: 'messaging_chat',
      operation: 'mark_read'
      })

      if (!unmountedRef.current) {
        syncMessagesState(prev =>
          prev.map(msg => (optimisticIds.has(msg.id) ? { ...msg, read_at: null } : msg))
        )
      }

      pendingIds.forEach(id => pendingReadIdsRef.current.add(id))
    }
  }, [
    conversation.id,
    conversation.isPending,
    currentUserId,
    onConversationRead,
    onMessageSent,
    refreshUnreadCount,
    syncMessagesState
  ])

  const queueReadReceipt = useCallback(
    (message: Message) => {
      if (message.sender_id === currentUserId || message.read_at) {
        return
      }

      if (pendingReadIdsRef.current.has(message.id)) {
        return
      }

      pendingReadIdsRef.current.add(message.id)

      if (readFlushTimeoutRef.current !== null) {
        return
      }

      readFlushTimeoutRef.current = window.setTimeout(() => {
        readFlushTimeoutRef.current = null
        void flushPendingReadReceipts()
      }, 200)
    },
    [currentUserId, flushPendingReadReceipts]
  )

  const markConversationAsRead = useCallback((options?: { immediate?: boolean }) => {
    if (!conversation.id || conversation.isPending) {
      return
    }

    const unreadMessages = messagesRef.current.filter(
      msg => msg.sender_id !== currentUserId && !msg.read_at
    )

    if (!unreadMessages.length) {
      return
    }

    unreadMessages.forEach(queueReadReceipt)

    if (options?.immediate) {
      if (readFlushTimeoutRef.current !== null) {
        window.clearTimeout(readFlushTimeoutRef.current)
        readFlushTimeoutRef.current = null
      }
      void flushPendingReadReceipts()
    }
  }, [conversation.id, conversation.isPending, currentUserId, flushPendingReadReceipts, queueReadReceipt])

  const updateMessageStatus = useCallback((messageId: string, status: MessageDeliveryStatus, error: string | null = null) => {
    syncMessagesState(prev => prev.map(msg => (msg.id === messageId ? { ...msg, status, error } : msg)))
  }, [syncMessagesState])

  const deleteFailedMessage = useCallback((messageId: string) => {
    syncMessagesState(prev => prev.filter(msg => msg.id !== messageId))
  }, [syncMessagesState])

  // Edit a delivered message the current user authored. Optimistic: swap the
  // content + stamp edited_at immediately, reconcile with the server row, and
  // roll back to the prior content on failure. The realtime UPDATE handler
  // echoes the same change to the other participant.
  const editMessage = useCallback(async (messageId: string, nextContent: string) => {
    const trimmed = nextContent.trim()
    if (!trimmed) {
      addToast('Message cannot be empty.', 'error')
      return false
    }
    if (trimmed.length > 1000) {
      addToast('Message is too long. Maximum 1000 characters.', 'error')
      return false
    }

    const previous = messagesRef.current.find(msg => msg.id === messageId)
    if (!previous) return false
    if (previous.content === trimmed) {
      return true
    }

    const optimisticEditedAt = new Date().toISOString()
    syncMessagesState(prev =>
      prev.map(msg => (msg.id === messageId ? { ...msg, content: trimmed, edited_at: optimisticEditedAt } : msg))
    )

    try {
      const { data, error } = await supabase.rpc('edit_message', {
        p_message_id: messageId,
        p_content: trimmed
      })
      if (error) throw error
      if (data) {
        const persisted = data as unknown as Message
        syncMessagesState(prev =>
          prev.map(msg => (msg.id === messageId ? { ...msg, ...persisted, status: 'delivered' as MessageDeliveryStatus } : msg))
        )
      }
      return true
    } catch (error) {
      logger.error('Error editing message:', error)
      reportSupabaseError('messaging_chat.edit_message', error, {
        conversationId: conversation.id,
        messageId
      }, {
        feature: 'messaging_chat',
        operation: 'edit_message'
      })
      syncMessagesState(prev =>
        prev.map(msg => (msg.id === messageId ? { ...msg, content: previous.content, edited_at: previous.edited_at ?? null } : msg))
      )
      addToast(extractErrorMessage(error, 'Failed to edit message. Please try again.'), 'error')
      return false
    }
  }, [addToast, conversation.id, syncMessagesState])

  // Soft-delete a message the current user authored. Optimistic: blank the
  // content + stamp deleted_at so the bubble flips to the "Message deleted"
  // tombstone immediately; reconcile with the server row and roll back on
  // failure.
  const deleteMessage = useCallback(async (messageId: string) => {
    const previous = messagesRef.current.find(msg => msg.id === messageId)
    if (!previous) return false

    const optimisticDeletedAt = new Date().toISOString()
    syncMessagesState(prev =>
      prev.map(msg => (msg.id === messageId ? { ...msg, content: '', metadata: null, deleted_at: optimisticDeletedAt } : msg))
    )

    try {
      const { data, error } = await supabase.rpc('delete_message', {
        p_message_id: messageId
      })
      if (error) throw error
      if (data) {
        const persisted = data as unknown as Message
        syncMessagesState(prev =>
          prev.map(msg => (msg.id === messageId ? { ...msg, ...persisted, status: 'delivered' as MessageDeliveryStatus } : msg))
        )
      }
      return true
    } catch (error) {
      logger.error('Error deleting message:', error)
      reportSupabaseError('messaging_chat.delete_message', error, {
        conversationId: conversation.id,
        messageId
      }, {
        feature: 'messaging_chat',
        operation: 'delete_message'
      })
      syncMessagesState(prev =>
        prev.map(msg => (msg.id === messageId ? { ...msg, content: previous.content, metadata: previous.metadata ?? null, deleted_at: previous.deleted_at ?? null } : msg))
      )
      addToast(extractErrorMessage(error, 'Failed to delete message. Please try again.'), 'error')
      return false
    }
  }, [addToast, conversation.id, syncMessagesState])

  const sendMessage = useCallback(async (content: string, options?: { reuseOptimisticId?: string; metadata?: MessageMetadata | null }) => {
    if (!content.trim() || sending) return false

    const messageContent = content.trim()
    if (messageContent.length > 1000) {
      addToast('Message is too long. Maximum 1000 characters.', 'error')
      return
    }

    // Rate limit check
    const rateCheck = await checkMessageRateLimit(currentUserId)
    if (rateCheck && !rateCheck.allowed) {
      addToast(formatRateLimitError(rateCheck), 'error')
      return false
    }

    setSending(true)
    
    const otherParticipantId =
      conversation.participant_one_id === currentUserId
        ? conversation.participant_two_id
        : conversation.participant_one_id

    if (!otherParticipantId) {
      logger.error('Cannot determine recipient for conversation', { conversation })
      setSending(false)
      return
    }

    let activeConversationId: string | null = conversation.isPending ? null : conversation.id
    let newlyCreatedConversation: Conversation | null = null
    let optimisticId: string | null = options?.reuseOptimisticId ?? null
    let optimisticMessage: ChatMessage | null = null
    let conversationCreatedForSend = false

    try {
      if (!activeConversationId) {
        try {
          Sentry.addBreadcrumb({
            category: 'supabase',
            message: 'Create conversation for send',
            data: { currentUserId, otherParticipantId },
            level: 'info'
          })
          const result = await withRetry(async () => {
            const response = await supabase
              .from('conversations')
              .insert({
                participant_one_id: currentUserId,
                participant_two_id: otherParticipantId,
                // Stamp the entry point on the NEW row only. The unique-violation
                // fallback below SELECTs the existing row and never overwrites it,
                // so a conversation's origin is frozen at first creation.
                origin: conversation.origin ?? 'Direct'
              })
              .select()

            if (response.error) throw response.error
            return response
          })

          const createdConversation = result.data?.[0]
          if (!createdConversation) {
            throw new Error('Failed to create conversation')
          }

          activeConversationId = createdConversation.id
          newlyCreatedConversation = {
            ...createdConversation,
            // DB types origin as a plain text column; narrow to the union.
            origin: createdConversation.origin as ConversationOrigin,
            otherParticipant: conversation.otherParticipant,
            isPending: false
          }
          conversationCreatedForSend = true
        } catch (creationError: unknown) {
          const parsedError = creationError as { code?: string; message?: string; details?: string }
          if (!isUniqueViolationError(parsedError)) {
            reportSupabaseError('messaging_chat.create_conversation', creationError, {
              currentUserId,
              otherParticipantId
            }, {
              feature: 'messaging_chat',
              operation: 'create_conversation'
            })
            throw creationError
          }

          Sentry.addBreadcrumb({
            category: 'supabase',
            message: 'Find existing conversation after unique violation',
            data: { currentUserId, otherParticipantId },
            level: 'info'
          })
          const { data: existingConversation, error: existingConversationError } = await supabase
            .from('conversations')
            .select('*')
            .or(
              `and(participant_one_id.eq.${currentUserId},participant_two_id.eq.${otherParticipantId}),and(participant_one_id.eq.${otherParticipantId},participant_two_id.eq.${currentUserId})`
            )
            .maybeSingle()

          if (existingConversationError) {
            reportSupabaseError('messaging_chat.find_existing_conversation', existingConversationError, {
              currentUserId,
              otherParticipantId
            }, {
              feature: 'messaging_chat',
              operation: 'create_conversation'
            })
            throw existingConversationError
          }

          if (!existingConversation) {
            throw creationError
          }

          activeConversationId = existingConversation.id
          newlyCreatedConversation = {
            ...existingConversation,
            // Existing row's stored origin (frozen at its creation); narrow it.
            origin: existingConversation.origin as ConversationOrigin,
            otherParticipant: conversation.otherParticipant,
            isPending: false
          }
        }
      }

      const idempotencyKey = `${currentUserId}-${Date.now()}-${Math.random()}`
      if (!optimisticId) {
        optimisticId = `optimistic-${idempotencyKey}`
        optimisticMessage = {
          id: optimisticId,
          conversation_id: activeConversationId,
          sender_id: currentUserId,
          content: messageContent,
          sent_at: new Date().toISOString(),
          read_at: null,
          status: 'sending',
          metadata: options?.metadata ?? null,
          // Carry the key so the realtime INSERT echo of this same message can
          // find + replace this optimistic entry instead of appending a dup.
          idempotency_key: idempotencyKey,
        }

        syncMessagesState(prev => [...prev, optimisticMessage!])
        setNewMessage('')
        clearMessageDraft(currentUserId, conversationDraftKey)
      } else {
        // Retry: reuse the on-screen bubble but send under a NEW idempotency
        // key. Stamp it onto the existing entry so THIS attempt's realtime
        // echo reconciles against this bubble (by idempotency_key) instead of
        // appending a duplicate.
        syncMessagesState(prev =>
          prev.map(msg =>
            msg.id === optimisticId
              ? { ...msg, status: 'sending', error: null, idempotency_key: idempotencyKey }
              : msg
          )
        )
      }
      
      const conversationIdForMetrics = activeConversationId
      let deliveredMessage: ChatMessage | null = null

      await monitor.measure(
        'send_message',
        async () => {
          Sentry.addBreadcrumb({
            category: 'supabase',
            message: 'Insert chat message',
            data: { conversationId: conversationIdForMetrics, idempotencyKey },
            level: 'info'
          })
          let persistedRow: Message | null = null
          try {
            const result = await withRetry(async () => {
              const res = await supabase
                .from('messages')
                .insert({
                  conversation_id: conversationIdForMetrics,
                  sender_id: currentUserId,
                  content: messageContent,
                  idempotency_key: idempotencyKey,
                  ...(options?.metadata ? { metadata: options.metadata as unknown as import('@/lib/database.types').Json } : {}),
                })
                .select()

              if (res.error) throw res.error
              return res
            })
            persistedRow = (result.data?.[0] as Message | undefined) ?? null
          } catch (insertError) {
            // A timed-out-but-committed first attempt makes withRetry re-issue
            // the SAME idempotency_key, which the global unique index rejects
            // with 23505. That is NOT a real failure — the row IS committed —
            // so recover it by its key instead of marking the message failed.
            // A failure here would prompt the user to retry, inserting a
            // genuine duplicate row under a new key. Mirrors the
            // conversation-create unique-violation fallback above.
            const parsedInsertError = insertError as { code?: string; message?: string; details?: string }
            if (!isUniqueViolationError(parsedInsertError)) throw insertError
            const { data: existing, error: lookupError } = await supabase
              .from('messages')
              .select('*')
              .eq('idempotency_key', idempotencyKey)
              .maybeSingle()
            if (lookupError || !existing) throw insertError
            persistedRow = existing as Message
          }

          if (persistedRow) {
            logger.debug('Message sent successfully, replacing optimistic message')
            const persisted: ChatMessage = { ...persistedRow, status: 'delivered' }
            deliveredMessage = persisted
            syncMessagesState(prev => prev.map(msg => (msg.id === optimisticId ? persisted : msg)))
          }
        },
        { conversationId: conversationIdForMetrics }
      )

      trackDbEvent('message_send', 'conversation', conversationIdForMetrics)
      trackMessageSend()

      if (onMessageSent && (deliveredMessage || optimisticMessage)) {
        onMessageSent({
          type: 'sent',
          conversationId: conversationIdForMetrics,
          message: (deliveredMessage ?? optimisticMessage)!
        })
      }

      if (newlyCreatedConversation) {
        // Report the real entry point. For the create branch this is the value
        // we just inserted; for the unique-violation branch it's the existing
        // row's stored origin (so re-opens report where it ORIGINALLY started).
        const startOrigin = newlyCreatedConversation.origin ?? 'Direct'
        trackDbEvent('conversation_start', 'conversation', newlyCreatedConversation.id, { context: startOrigin })
        trackConversationStart(startOrigin)
        onConversationCreated(newlyCreatedConversation)
      }
      
      return true
    } catch (error) {
      logger.error('Error sending message:', error)
      reportSupabaseError('messaging_chat.send_message', error, {
        conversationId: conversation.id,
        optimisticId,
        currentUserId,
        otherParticipantId: conversation.participant_one_id === currentUserId ? conversation.participant_two_id : conversation.participant_one_id
      }, {
        feature: 'messaging_chat',
        operation: 'send_message'
      })
      if (optimisticId) {
        updateMessageStatus(optimisticId, 'failed', 'Failed to send')
      }

      if (conversationCreatedForSend && newlyCreatedConversation) {
        try {
          Sentry.addBreadcrumb({
            category: 'supabase',
            message: 'Rollback conversation after failed send',
            data: { conversationId: newlyCreatedConversation.id },
            level: 'warning'
          })
          await supabase
            .from('conversations')
            .delete()
            .eq('id', newlyCreatedConversation.id)
        } catch (cleanupError) {
          logger.error('Failed to rollback empty conversation after send failure', cleanupError)
          reportSupabaseError('messaging_chat.cleanup_conversation', cleanupError, {
            conversationId: newlyCreatedConversation.id
          }, {
            feature: 'messaging_chat',
            operation: 'cleanup_conversation'
          })
        }
      }

      addToast(extractErrorMessage(error, 'Failed to send message. Please try again.'), 'error')
      return false
    } finally {
      setSending(false)
    }
  }, [
    addToast,
    conversation,
    conversationDraftKey,
    currentUserId,
    onConversationCreated,
    onMessageSent,
    sending,
    setNewMessage,
    syncMessagesState,
    updateMessageStatus
  ])

  const retryMessage = useCallback((messageId: string) => {
    const failedMessage = messagesRef.current.find(msg => msg.id === messageId)
    if (!failedMessage) {
      return
    }

    void sendMessage(failedMessage.content, { reuseOptimisticId: messageId, metadata: failedMessage.metadata ?? null })
  }, [sendMessage])

  // Realtime subscription
  useEffect(() => {
    if (!conversation.id || conversation.isPending) return

    const channel = supabase
      .channel(`conversation-${conversation.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversation.id}`
        },
        payload => {
          const raw = payload.new as Message & { idempotency_key?: string | null }
          const newMessage: ChatMessage = { ...raw, status: 'delivered' }

          let didInsert = false
          syncMessagesState(prev => {
            // Already reconciled under the real row id — nothing to do.
            if (prev.some(msg => msg.id === newMessage.id)) {
              return prev
            }
            // Our own just-sent message may still be sitting in state under its
            // optimistic id (`optimistic-<idempotencyKey>`) when this realtime
            // INSERT echo beats the insert().select() reconciliation. Match by
            // idempotency_key and replace it in place rather than appending a
            // second copy (the duplicate this guards against). The trailing
            // insert().select() map on the now-absent optimistic id no-ops.
            if (newMessage.idempotency_key) {
              const optimisticId = `optimistic-${newMessage.idempotency_key}`
              const idx = prev.findIndex(
                msg => msg.id === optimisticId || msg.idempotency_key === newMessage.idempotency_key
              )
              if (idx !== -1) {
                const next = [...prev]
                next[idx] = newMessage
                return next
              }
            }
            didInsert = true
            return [...prev, newMessage]
          })

          if (didInsert && onMessageSent && newMessage.sender_id !== currentUserId) {
            onMessageSent({
              type: 'received',
              conversationId: conversation.id,
              message: newMessage
            })
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversation.id}`
        },
        payload => {
          const updated: ChatMessage = { ...(payload.new as Message), status: 'delivered' }
          syncMessagesState(prev =>
            prev.map(msg => (msg.id === updated.id ? updated : msg))
          )
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          logger.debug(`[useChat] Realtime subscribed for conversation ${conversation.id}`)
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          logger.error(`[useChat] Realtime ${status} for conversation ${conversation.id}, refetching`)
          // Refetch messages to fill any gap from the disconnection
          void fetchMessages()
        }
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [conversation.id, conversation.isPending, currentUserId, onMessageSent, syncMessagesState, fetchMessages])

  // Initial load
  useEffect(() => {
    pendingReadIdsRef.current.clear()
    fetchMessagesPromiseRef.current = null
    if (readFlushTimeoutRef.current !== null) {
      window.clearTimeout(readFlushTimeoutRef.current)
      readFlushTimeoutRef.current = null
    }

    if (!conversation.id || conversation.isPending) {
      setLoading(false)
      syncMessagesState([])
      return
    }

    let cancelled = false

    const loadConversation = async () => {
      await fetchMessages()
      if (cancelled) return
    }

    loadConversation()

    return () => {
      cancelled = true
      if (readFlushTimeoutRef.current !== null) {
        window.clearTimeout(readFlushTimeoutRef.current)
        readFlushTimeoutRef.current = null
      }
      void flushPendingReadReceipts()
    }
  }, [conversation.id, conversation.isPending, fetchMessages, flushPendingReadReceipts, markConversationAsRead, syncMessagesState])

  // Cleanup on unmount — mark as unmounted so async flush skips state updates
  useEffect(() => {
    unmountedRef.current = false
    return () => {
      unmountedRef.current = true
      if (readFlushTimeoutRef.current !== null) {
        window.clearTimeout(readFlushTimeoutRef.current)
        readFlushTimeoutRef.current = null
      }
      void flushPendingReadReceipts()
    }
  }, [flushPendingReadReceipts])

  return {
    messages,
    loading,
    sending,
    newMessage,
    setNewMessage,
    hasMoreMessages,
    isLoadingMore,
    sendMessage,
    retryMessage,
    deleteFailedMessage,
    editMessage,
    deleteMessage,
    loadOlderMessages,
    queueReadReceipt,
    markConversationAsRead
  }
}
