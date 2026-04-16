import { supabase } from './supabase'
import { logger } from './logger'
import type { SharedPostMetadata } from '@/types/chat'

/**
 * Send a shared-post message to a recipient without requiring an active chat window.
 * Finds or creates the conversation, then inserts a message with metadata.
 */
export async function sendSharedPostMessage(
  currentUserId: string,
  recipientUserId: string,
  postData: SharedPostMetadata,
): Promise<{ success: boolean; error?: string }> {
  try {
    // 1. Find existing conversation (either participant ordering)
    let conversationId: string | null = null

    const { data: existing, error: findError } = await supabase
      .from('conversations')
      .select('id')
      .or(
        `and(participant_one_id.eq.${currentUserId},participant_two_id.eq.${recipientUserId}),and(participant_one_id.eq.${recipientUserId},participant_two_id.eq.${currentUserId})`,
      )
      .maybeSingle()

    if (findError) {
      logger.error('[sharePost] Error finding conversation:', findError)
      return { success: false, error: 'Failed to find conversation' }
    }

    if (existing) {
      conversationId = existing.id
    } else {
      // 2. Create new conversation
      const { data: created, error: createError } = await supabase
        .from('conversations')
        .insert({
          participant_one_id: currentUserId,
          participant_two_id: recipientUserId,
        })
        .select('id')
        .single()

      if (createError) {
        // Handle race condition: another request may have created the conversation
        if (createError.code === '23505') {
          const { data: raceExisting } = await supabase
            .from('conversations')
            .select('id')
            .or(
              `and(participant_one_id.eq.${currentUserId},participant_two_id.eq.${recipientUserId}),and(participant_one_id.eq.${recipientUserId},participant_two_id.eq.${currentUserId})`,
            )
            .maybeSingle()

          if (raceExisting) {
            conversationId = raceExisting.id
          } else {
            logger.error('[sharePost] Race condition but could not find conversation')
            return { success: false, error: 'Failed to create conversation' }
          }
        } else {
          logger.error('[sharePost] Error creating conversation:', createError)
          return { success: false, error: 'Failed to create conversation' }
        }
      } else {
        conversationId = created.id
      }
    }

    if (!conversationId) {
      return { success: false, error: 'Failed to resolve conversation' }
    }

    // 3. Insert message with shared post metadata
    const { error: msgError } = await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_id: currentUserId,
      content: 'Shared a post',
      metadata: postData as never,
    })

    if (msgError) {
      logger.error('[sharePost] Error inserting message:', msgError)
      return { success: false, error: 'Failed to send message' }
    }

    return { success: true }
  } catch (err) {
    logger.error('[sharePost] Unexpected error:', err)
    return { success: false, error: 'Something went wrong' }
  }
}
