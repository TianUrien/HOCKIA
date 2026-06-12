import { useEffect, useMemo, useRef } from 'react'
import type { MutableRefObject } from 'react'
import { MessageBubble } from './MessageBubble'
import type { ChatMessage } from '@/types/chat'
import type { MessageDeliveryStatus } from '@/types/chat'
import { EmptyState } from './EmptyState'
import { isSameDay } from 'date-fns'

interface MessageListProps {
  messages: ChatMessage[]
  currentUserId: string
  scrollContainerRef: MutableRefObject<HTMLDivElement | null>
  queueReadReceipt: (message: ChatMessage) => void
  retryMessage: (id: string) => void
  deleteFailedMessage: (id: string) => void
  editMessage: (id: string, content: string) => Promise<boolean>
  deleteMessage: (id: string) => Promise<boolean>
  isLoadingMore: boolean
  unreadMetadata: {
    firstUnreadId: string | null
    unreadCount: number
  }
}

export function MessageList({
  messages,
  currentUserId,
  scrollContainerRef,
  queueReadReceipt,
  retryMessage,
  deleteFailedMessage,
  editMessage,
  deleteMessage,
  isLoadingMore,
  unreadMetadata
}: MessageListProps) {
  const messageRefs = useRef(new Map<string, HTMLDivElement>())

  const meta = useMemo(() => {
    return messages.map((message, index) => {
      const previous = index > 0 ? messages[index - 1] : undefined
      const messageDate = new Date(message.sent_at)
      const previousDate = previous ? new Date(previous.sent_at) : undefined

      const showDayDivider = !previous || !previousDate || !isSameDay(messageDate, previousDate)
      const showTimestamp = !previous || !previousDate || messageDate.getTime() - previousDate.getTime() > 5 * 60 * 1000
      const isSameSenderAsPrevious = previous && previous.sender_id === message.sender_id
      const isCloseInTime = previousDate ? messageDate.getTime() - previousDate.getTime() < 5 * 60 * 1000 : false
      const isGroupedWithPrevious = Boolean(isSameSenderAsPrevious && isCloseInTime && !showDayDivider)
      const isUnreadMarker = unreadMetadata.firstUnreadId === message.id && unreadMetadata.unreadCount > 0 && message.sender_id !== currentUserId
      const status = (message.status ?? (message.sender_id === currentUserId ? 'delivered' : undefined)) as MessageDeliveryStatus | undefined

      return {
        showDayDivider,
        showTimestamp,
        isGroupedWithPrevious,
        isUnreadMarker,
        status
      }
    })
  }, [messages, currentUserId, unreadMetadata.firstUnreadId, unreadMetadata.unreadCount])

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') {
      return
    }

    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting || entry.intersectionRatio < 0.6) {
            return
          }
          const messageId = entry.target.getAttribute('data-message-id')
          if (!messageId) return
          const message = messages.find(msg => msg.id === messageId)
          if (message) {
            queueReadReceipt(message)
          }
        })
      },
      {
        root: container,
        threshold: [0.6],
        rootMargin: '0px 0px -32px 0px'
      }
    )

    messageRefs.current.forEach(node => observer.observe(node))

    return () => observer.disconnect()
  }, [messages, queueReadReceipt, scrollContainerRef])

  const setMessageRef = (messageId: string) => (node: HTMLDivElement | null) => {
    const refs = messageRefs.current
    const existing = refs.get(messageId)
    if (existing && existing !== node) {
      refs.delete(messageId)
    }
    if (node) {
      node.setAttribute('data-message-id', messageId)
      refs.set(messageId, node)
    }
  }

  if (!messages.length) {
    return <EmptyState />
  }

  return (
    <div className="space-y-4">
      {isLoadingMore && (
        <div className="flex justify-center pb-4 text-xs font-medium uppercase tracking-wide text-gray-500">
          Loading earlier messages...
        </div>
      )}
      {messages.map((message, index) => (
        <div key={message.id} ref={setMessageRef(message.id)} className="chat-bubble-enter chat-message-wrapper">
          <MessageBubble
            message={message}
            isMine={message.sender_id === currentUserId}
            status={meta[index].status}
            isGroupedWithPrevious={meta[index].isGroupedWithPrevious}
            showDayDivider={meta[index].showDayDivider}
            showTimestamp={meta[index].showTimestamp}
            isUnreadMarker={meta[index].isUnreadMarker}
            onRetry={retryMessage}
            onDeleteFailed={deleteFailedMessage}
            onEditSave={editMessage}
            onDelete={deleteMessage}
          />
        </div>
      ))}
    </div>
  )
}
