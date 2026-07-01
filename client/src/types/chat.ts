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
  /** Set when the author edited the message; drives the "edited" label. */
  edited_at?: NullableDate
  /** Set when the author soft-deleted the message; UI shows a "Message deleted" tombstone. */
  deleted_at?: NullableDate
  metadata?: MessageMetadata | null
}

export interface ChatMessage extends Message {
  client_generated_id?: string
  status?: MessageDeliveryStatus
  error?: string | null
  /**
   * The per-send idempotency key. Present at runtime on both the optimistic
   * copy (which is keyed `optimistic-<idempotency_key>`) and the persisted /
   * realtime rows. Used to reconcile the sender's own realtime INSERT against
   * its still-optimistic entry so a message never renders twice when the
   * realtime echo beats the insert().select() response.
   */
  idempotency_key?: string | null
}

export interface ConversationParticipant {
  id: string
  full_name: string
  username: string | null
  avatar_url: string | null
  // Brand messaging was enabled server-side in migration 202603070200; the
  // client union must include 'brand' so DM partners are correctly typed
  // and `buildPublicProfilePath` can route to /brands/<slug> instead of
  // falling through to /players/<slug> (404).
  role: 'player' | 'coach' | 'club' | 'umpire' | 'brand'
}

/**
 * Where a conversation was initiated — surfaced as the admin "Source" column.
 * Must stay in lockstep with the CHECK constraint on conversations.origin
 * (migration 20260615190000_admin_conversations.sql).
 */
export type ConversationOrigin =
  | 'Community'
  | 'Profile'
  | 'Opportunity'
  | 'Hockia AI'
  | 'Direct'
  | 'unknown'

export interface Conversation {
  id: string
  participant_one_id: string
  participant_two_id: string
  created_at: string
  updated_at: string
  last_message_at: NullableDate
  otherParticipant?: ConversationParticipant
  isPending?: boolean
  /**
   * Entry point this conversation started from. Set ONLY when a brand-new row
   * is created; existing conversations are never re-attributed. Defaults
   * 'unknown' server-side for pre-instrumentation rows.
   */
  origin?: ConversationOrigin
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
