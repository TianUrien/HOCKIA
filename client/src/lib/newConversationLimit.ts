import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'

/**
 * Daily allowance for NEW conversations (the first message to someone the
 * member has no conversation with). The database refuses the conversation
 * insert with this exact message and the DETAIL code below; replies and
 * messages in existing conversations are never limited.
 */
export const NEW_CONVERSATION_LIMIT_MESSAGE =
  "You've started a lot of new conversations today. You can start more tomorrow."
export const NEW_CONVERSATION_LIMIT_CODE = 'new_conversation_limit'

type ErrorLike = { message?: unknown; details?: unknown } | null | undefined

/** True when a Supabase error is the daily-allowance refusal. */
export function isNewConversationLimitError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as ErrorLike
  return e?.details === NEW_CONVERSATION_LIMIT_CODE || e?.message === NEW_CONVERSATION_LIMIT_MESSAGE
}

/**
 * Tell the server a start was refused, so the admin signal can count it (the
 * refusal itself cannot write anything). Best effort: never throws, never
 * blocks the UI.
 */
export function reportNewConversationRefusal(): void {
  try {
    void Promise.resolve(supabase.rpc('log_new_conversation_refusal'))
      .then((result) => {
        if (result?.error) logger.debug('[newConversationLimit] refusal not recorded', result.error)
      })
      .catch((error: unknown) => {
        logger.debug('[newConversationLimit] refusal not recorded', error)
      })
  } catch (error) {
    logger.debug('[newConversationLimit] refusal not recorded', error)
  }
}
