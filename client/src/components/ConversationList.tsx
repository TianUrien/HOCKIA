import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { SUPABASE_URL } from '@/lib/supabase'
import { recruitingPreview } from '@/lib/signing'
import { identityLine } from '@/lib/identity'
import { clubInboxRoleLine } from '@/lib/clubInbox'
import type { ClubInboxRowMeta } from '@/hooks/useClubInbox'
import { ConversationRow } from '@/components/inbox/ConversationRow'

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
    role: 'player' | 'coach' | 'club' | 'umpire' | 'brand'
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
  /** Clubs: the applicant context line and the amber "owes a first reply" dot per conversation. */
  clubMeta?: Map<string, ClubInboxRowMeta>
}

export default function ConversationList({
  conversations,
  selectedConversationId,
  onSelectConversation,
  currentUserId,
  variant = 'default',
  clubMeta,
}: ConversationListProps) {
  const isCompact = variant === 'compact'
  const parentRef = useRef<HTMLDivElement>(null)
  const rowVirtualizer = useVirtualizer({
    count: conversations.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => (isCompact ? 76 : 80),
    overscan: 6
  })

  const getAvatarUrl = (avatarUrl: string | null) => {
    if (!avatarUrl) return null
    if (avatarUrl.startsWith('http')) return avatarUrl
    return `${SUPABASE_URL}/storage/v1/object/public/avatars/${avatarUrl}`
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
          const isUnread = (conversation.unreadCount || 0) > 0
          const isSentByMe = conversation.lastMessage?.sender_id === currentUserId
          const otherParticipantLabel = conversation.otherParticipant?.full_name?.split(' ')[0] || conversation.otherParticipant?.username || 'Contact'
          // Server-posted recruiting lines are reworded for the club and shown without a sender prefix (lib/signing).
          const preview = conversation.lastMessage ? recruitingPreview(conversation.lastMessage.content, { isMine: isSentByMe, otherFirstName: otherParticipantLabel }) : null
          const previewText = preview ? `${isSentByMe && !preview.system ? 'You: ' : ''}${preview.text}` : 'Say hello'
          const participantName =
            conversation.otherParticipant?.full_name ||
            conversation.otherParticipant?.username ||
            'Hockia member'
          const role = conversation.otherParticipant?.role
          const meta = clubMeta?.get(conversation.id)
          const contextLine = meta ? clubInboxRoleLine(role, meta.detail, meta.applied) : role ? identityLine(role) : null

          return (
            <div
              key={conversation.id}
              ref={rowVirtualizer.measureElement}
              data-index={virtualRow.index}
              className="group absolute top-0 left-0 w-full"
              style={{
                transform: `translateY(${virtualRow.start}px)`,
                willChange: 'transform'
              }}
            >
              <ConversationRow
                name={participantName}
                avatarUrl={getAvatarUrl(conversation.otherParticipant?.avatar_url || null)}
                role={role}
                at={conversation.last_message_at ?? conversation.lastMessage?.sent_at ?? null}
                contextLine={contextLine}
                preview={previewText}
                unread={isUnread}
                waiting={Boolean(meta?.waiting)}
                selected={isSelected}
                onSelect={() => onSelectConversation(conversation.id)}
                testId="conversation-item"
                conversationId={conversation.id}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
