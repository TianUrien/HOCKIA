export type NullableDate = string | null

export type MessageDeliveryStatus = 'sending' | 'sent' | 'delivered' | 'failed'

export interface SharedPostMetadata {
  type: 'shared_post'
  post_id: string
  author_id: string
  author_name: string | null
  author_avatar: string | null
  author_role: 'player' | 'coach' | 'club' | 'brand' | 'umpire'
  content_preview: string
  thumbnail_url: string | null
}

export type MessageMetadata = SharedPostMetadata

export interface Message {
  id: string
  conversation_id: string
  sender_id: string
  content: string
  sent_at: string
  read_at: NullableDate
  metadata?: MessageMetadata | null
}

export interface ChatMessage extends Message {
  client_generated_id?: string
  status?: MessageDeliveryStatus
  error?: string | null
}

export interface ConversationParticipant {
  id: string
  full_name: string
  username: string | null
  avatar_url: string | null
  role: 'player' | 'coach' | 'club' | 'umpire'
}

export interface Conversation {
  id: string
  participant_one_id: string
  participant_two_id: string
  created_at: string
  updated_at: string
  last_message_at: NullableDate
  otherParticipant?: ConversationParticipant
  isPending?: boolean
}

export type ChatMessageEvent =
  | {
      type: 'sent'
      conversationId: string
      message: Message
    }
  | {
      type: 'received'
      conversationId: string
      message: Message
    }
  | {
      type: 'read'
      conversationId: string
      messageIds: string[]
    }
