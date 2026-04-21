import { useRef } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { useVirtualizer } from '@tanstack/react-virtual'
import { SUPABASE_URL } from '@/lib/supabase'
import Avatar from './Avatar'
import RoleBadge from './RoleBadge'

interface Conversation {
  id: string
  participant_one_id: string
  participant_two_id: string
  created_at: string
  updated_at: string
  last_message_at: string | null
  otherParticipant?: {
    id: string
    full_name: string
    username: string | null
    avatar_url: string | null
    role: 'player' | 'coach' | 'club' | 'umpire'
  }
  lastMessage?: {
    content: string
    sent_at: string
    sender_id: string
  }
  unreadCount?: number
}

interface ConversationListProps {
  conversations: Conversation[]
  selectedConversationId: string | null
  onSelectConversation: (conversationId: string) => void
  currentUserId: string
  variant?: 'default' | 'compact'
}

export default function ConversationList({
  conversations,
  selectedConversationId,
  onSelectConversation,
  currentUserId,
  variant = 'default'
}: ConversationListProps) {
  const isCompact = variant === 'compact'
  const parentRef = useRef<HTMLDivElement>(null)
  const rowVirtualizer = useVirtualizer({
    count: conversations.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => (isCompact ? 68 : 92),
    overscan: 6
  })

  const getAvatarUrl = (avatarUrl: string | null) => {
    if (!avatarUrl) return null
    if (avatarUrl.startsWith('http')) return avatarUrl
    return `${SUPABASE_URL}/storage/v1/object/public/avatars/${avatarUrl}`
  }

  const truncateMessage = (message: string, maxLength: number = 50) => {
    if (message.length <= maxLength) return message
    return message.substring(0, maxLength) + '...'
  }

  const getInitials = (value?: string | null) => {
    if (!value) return '?'
    return value
      .trim()
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part[0]!.toUpperCase())
      .join('')
  }

  const virtualItems = rowVirtualizer.getVirtualItems()

  return (
    <div ref={parentRef} className="h-full overflow-y-auto">
      <div
        className="relative w-full"
        style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
      >
        {virtualItems.map(virtualRow => {
          const conversation = conversations[virtualRow.index]
          if (!conversation) {
            return null
          }

          const isSelected = conversation.id === selectedConversationId
          const avatarUrl = getAvatarUrl(conversation.otherParticipant?.avatar_url || null)
          const isUnread = (conversation.unreadCount || 0) > 0
          const isSentByMe = conversation.lastMessage?.sender_id === currentUserId
          const otherParticipantLabel = conversation.otherParticipant?.full_name?.split(' ')[0] || conversation.otherParticipant?.username || 'Contact'
          const buttonClasses = `w-full flex items-start gap-3 ${isCompact ? 'px-3 py-2.5' : 'px-4 py-3'} transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-purple-500 ${
            isSelected
              ? 'bg-gray-100'
              : 'hover:bg-gray-50'
          }`
          const participantName =
            conversation.otherParticipant?.full_name ||
            conversation.otherParticipant?.username ||
            'HOCKIA Member'
          const avatarInitials = getInitials(participantName)

          return (
            <div
              key={conversation.id}
              ref={rowVirtualizer.measureElement}
              data-index={virtualRow.index}
              className="absolute top-0 left-0 w-full border-b border-gray-100"
              style={{
                transform: `translateY(${virtualRow.start}px)`,
                willChange: 'transform'
              }}
            >
              <button
                data-testid="conversation-item"
                data-conversation-id={conversation.id}
                onClick={() => onSelectConversation(conversation.id)}
                className={buttonClasses}
              >
                <div className="relative flex-shrink-0">
                  <Avatar
                    src={avatarUrl}
                    alt={participantName}
                    initials={avatarInitials}
                    className="w-12 h-12 text-base"
                    enablePreview
                    previewTitle={participantName}
                    previewInteraction="pointer"
                  />
                  {isUnread && (
                    <span className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-purple-500 ring-2 ring-white" />
                  )}
                </div>

                <div className="flex-1 min-w-0 text-left">
                  <div className="mb-0.5 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <h3
                        className={`truncate text-sm text-gray-900 ${
                          isUnread ? 'font-semibold' : 'font-medium'
                        }`}
                      >
                        {participantName}
                      </h3>
                      <RoleBadge role={conversation.otherParticipant?.role ?? 'member'} className="text-[10px] flex-shrink-0" />
                    </div>
                    {conversation.last_message_at && (
                      <span className="flex-shrink-0 text-[11px] text-gray-400">
                        {formatDistanceToNow(new Date(conversation.last_message_at), { addSuffix: false })}
                      </span>
                    )}
                  </div>

                  {conversation.lastMessage && (
                    <p className={`text-[13px] truncate ${isUnread ? 'text-gray-700 font-medium' : 'text-gray-500'}`}>
                      <span className="text-gray-400">
                        {isSentByMe ? 'You' : otherParticipantLabel}:
                      </span>{' '}
                      {truncateMessage(conversation.lastMessage.content, 40)}
                    </p>
                  )}
                </div>
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
