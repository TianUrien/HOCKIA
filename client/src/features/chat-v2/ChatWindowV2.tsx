import { useCallback, useEffect, useMemo, useRef, useState, useId } from 'react'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useChat } from '@/hooks/useChat'
import { useSafeArea } from '@/hooks/useSafeArea'
import { useChatScrollController } from '@/hooks/useChatScrollController'
import { ChatWindowSkeleton } from '@/components/Skeleton'
import { buildPublicProfilePath } from './utils'
import { ChatHeader } from './components/ChatHeader'
import { MessageList } from './components/MessageList'
import { NewMessagesToast } from './components/NewMessagesToast'
import { Composer } from './components/Composer'
import { EmptyState } from './components/EmptyState'
import type { Conversation, ChatMessageEvent } from '@/types/chat'

const NEW_MESSAGE_DISTANCE_THRESHOLD = 120
const MAX_PENDING_BADGE = 9

interface ChatWindowV2Props {
  conversation: Conversation
  currentUserId: string
  onBack: () => void
  onMessageSent?: (event: ChatMessageEvent) => void
  onConversationCreated: (conversation: Conversation) => void
  onConversationRead?: (conversationId: string) => void
  isImmersiveMobile?: boolean
}

export default function ChatWindowV2({
  conversation,
  currentUserId,
  onBack,
  onMessageSent,
  onConversationCreated,
  onConversationRead,
  isImmersiveMobile = false
}: ChatWindowV2Props) {
  const {
    messages,
    loading,
    sending,
    newMessage,
    setNewMessage,
    hasMoreMessages,
    isLoadingMore,
    sendMessage,
    loadOlderMessages,
    retryMessage,
    deleteFailedMessage,
    queueReadReceipt,
    markConversationAsRead
  } = useChat({
    conversation,
    currentUserId,
    onMessageSent,
    onConversationCreated,
    onConversationRead
  })

  useSafeArea()
  const isMobile = useMediaQuery('(max-width: 767px)')
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<number | null>(null)
  const initialScrollDoneRef = useRef(false)
  const textareaId = useId()

  const [pendingNewMessagesCount, setPendingNewMessagesCount] = useState(0)
  const [distanceFromBottom, setDistanceFromBottom] = useState(0)
  const lastMessageIdRef = useRef<string | null>(null)

  const handleBeforeLoadOlder = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return
    anchorRef.current = container.scrollHeight
  }, [])

  const { scrollToBottom, getDistanceFromBottom } = useChatScrollController({
    hasMore: hasMoreMessages,
    isLoadingMore,
    loadOlderMessages,
    onReachBottom: () => {
      setPendingNewMessagesCount(0)
      markConversationAsRead()
    },
    onBeforeLoadOlder: handleBeforeLoadOlder,
    scrollContainerRef,
    onScrollMetricsChange: metrics => setDistanceFromBottom(metrics.distanceFromBottom)
  })

  const scrollToBottomSmooth = useCallback(() => {
    scrollToBottom('smooth')
  }, [scrollToBottom])

  useEffect(() => {
    if (loading) {
      initialScrollDoneRef.current = false
      return
    }
    if (!initialScrollDoneRef.current && messages.length > 0) {
      scrollToBottom('auto')
      initialScrollDoneRef.current = true
    }
  }, [loading, messages.length, scrollToBottom])

  useEffect(() => {
    // Only adjust scroll position when loading older messages (when anchor is set)
    if (anchorRef.current === null) return
    const container = scrollContainerRef.current
    if (!container) return
    
    const previousHeight = anchorRef.current
    const heightDiff = container.scrollHeight - previousHeight
    
    // Clear anchor before adjusting to prevent re-triggering
    anchorRef.current = null
    
    // Use RAF to batch the scroll adjustment and prevent loops
    requestAnimationFrame(() => {
      if (container) {
        container.scrollTop = Math.max(0, container.scrollTop + heightDiff)
      }
    })
  }, [messages.length])

  useEffect(() => {
    setPendingNewMessagesCount(0)
    setDistanceFromBottom(0)
    initialScrollDoneRef.current = false
    lastMessageIdRef.current = null
  }, [conversation.id])

  // Keep the newest messages visible across keyboard open/close. The
  // visual-viewport resize shrinks (or restores) the message list; if the
  // user was already near the bottom, follow the viewport down to the
  // latest message so the keyboard never ends up covering it.
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const handleViewportResize = () => {
      if (getDistanceFromBottom() <= 120) {
        scrollToBottom('auto')
      }
    }
    viewport.addEventListener('resize', handleViewportResize)
    return () => viewport.removeEventListener('resize', handleViewportResize)
  }, [getDistanceFromBottom, scrollToBottom])

  useEffect(() => {
    if (!messages.length) return
    
    const latestMessage = messages[messages.length - 1]
    const latestMessageId = latestMessage.id
    
    // Only react to NEW messages, not updates to existing messages
    if (lastMessageIdRef.current === latestMessageId) {
      return
    }
    
    // Store the latest message ID
    const previousMessageId = lastMessageIdRef.current
    lastMessageIdRef.current = latestMessageId
    
    // Skip on initial load (no previous message)
    if (!previousMessageId) {
      return
    }
    
    const distanceFromBottom = getDistanceFromBottom()

    // Always scroll for own messages
    if (latestMessage.sender_id === currentUserId) {
      scrollToBottomSmooth()
      setPendingNewMessagesCount(0)
      return
    }

    // Only auto-scroll for incoming messages if user is near bottom (within 100px)
    if (distanceFromBottom <= 100) {
      scrollToBottomSmooth()
      setPendingNewMessagesCount(0)
      markConversationAsRead()
      return
    }

    // User is reading older messages - don't force scroll
    setPendingNewMessagesCount(count => count + 1)
  }, [messages.length, messages, currentUserId, getDistanceFromBottom, scrollToBottomSmooth, markConversationAsRead])

  const handleSendMessage = useCallback(async () => {
    if (!newMessage.trim()) {
      return
    }
    await sendMessage(newMessage)
  }, [newMessage, sendMessage])

  const handleComposerFocus = useCallback(() => {
    // Only scroll if already at/near bottom to avoid disruptive jumps
    if (getDistanceFromBottom() <= 50) {
      scrollToBottomSmooth()
    }
    setPendingNewMessagesCount(0)
    markConversationAsRead()
  }, [getDistanceFromBottom, markConversationAsRead, scrollToBottomSmooth])

  const profilePath = buildPublicProfilePath(conversation.otherParticipant)

  const unreadMetadata = useMemo(() => {
    let firstUnreadId: string | null = null
    let unreadCount = 0

    messages.forEach(message => {
      if (message.sender_id !== currentUserId && !message.read_at) {
        unreadCount += 1
        if (!firstUnreadId) {
          firstUnreadId = message.id
        }
      }
    })

    return { firstUnreadId, unreadCount }
  }, [messages, currentUserId])

  const shouldShowNewToast = pendingNewMessagesCount > 0 && distanceFromBottom > NEW_MESSAGE_DISTANCE_THRESHOLD
  const pendingLabel = pendingNewMessagesCount > MAX_PENDING_BADGE ? `${MAX_PENDING_BADGE}+` : `${pendingNewMessagesCount}`

  if (loading) {
    return <ChatWindowSkeleton />
  }

  // Immersive mobile: render the window as a fixed overlay sized to the
  // *visual* viewport (--chat-viewport-height, kept current by
  // useSafeArea). Because the container tracks the visual viewport, the
  // keyboard simply shrinks it — header, message list and composer all
  // stay in normal flex flow, so the composer rests directly above the
  // keyboard with no fixed-positioning jank. Desktop keeps the in-parent
  // flex layout.
  const isImmersive = isMobile && isImmersiveMobile

  const containerClasses = isImmersive
    ? 'fixed inset-x-0 z-50 top-[var(--chat-safe-area-top,0px)] h-[var(--chat-viewport-height,100dvh)] flex flex-col bg-white overflow-hidden'
    : 'flex flex-1 flex-col min-h-0 bg-white overflow-hidden'

  const scrollPaddingClasses = isImmersive ? 'px-4 py-3 md:px-6' : 'px-4 py-4 md:px-5'

  return (
    <div className={containerClasses}>
      <ChatHeader
        participant={conversation.otherParticipant ?? undefined}
        onBack={onBack}
        profilePath={profilePath}
        isMobile={isMobile}
        immersiveMobile={isImmersiveMobile}
      />
      <div className="relative flex-1 min-h-0 overflow-hidden">
        <div
          ref={scrollContainerRef}
          data-testid="chat-message-list"
          className={`chat-scroll-container absolute inset-0 bg-gray-50 overflow-y-auto overscroll-contain ${scrollPaddingClasses}`}
        >
          {messages.length === 0 ? (
            <EmptyState />
          ) : (
            <MessageList
              messages={messages}
              currentUserId={currentUserId}
              scrollContainerRef={scrollContainerRef}
              queueReadReceipt={queueReadReceipt}
              retryMessage={retryMessage}
              deleteFailedMessage={deleteFailedMessage}
              isLoadingMore={isLoadingMore}
              unreadMetadata={unreadMetadata}
            />
          )}
          <NewMessagesToast
            visible={shouldShowNewToast}
            label={`${pendingLabel} new message${pendingNewMessagesCount > 1 ? 's' : ''}`}
            onClick={() => {
              setPendingNewMessagesCount(0)
              scrollToBottomSmooth()
            }}
          />
        </div>
      </div>
      <Composer
        value={newMessage}
        sending={sending}
        disabled={!newMessage.trim() || sending || newMessage.length > 1000}
        onChange={setNewMessage}
        onSubmit={handleSendMessage}
        onFocus={handleComposerFocus}
        maxLength={1000}
        textareaId={textareaId}
      />
    </div>
  )
}
