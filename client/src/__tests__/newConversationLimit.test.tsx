import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The daily allowance for NEW conversations: the database refuses the
// conversations insert; the client shows the server's sentence as a note,
// leaves nothing half-sent and reports the refusal for the admin signal.

const REFUSAL = {
  code: 'P0001',
  message: "You've started a lot of new conversations today. You can start more tomorrow.",
  details: 'new_conversation_limit',
  hint: null,
}

const toasts: Array<{ message: string; type: string }> = []
const rpcCalls: string[] = []
let conversationInsertResult: { data: unknown; error: unknown } = { data: null, error: REFUSAL }
let conversationLookup: { data: unknown; error: unknown } = { data: null, error: null }
const conversationInsert = vi.fn()
const conversationDelete = vi.fn()
const messageInsert = vi.fn()
const reportSupabaseError = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'conversations') {
        return {
          insert: (row: unknown) => {
            conversationInsert(row)
            const result = Promise.resolve(conversationInsertResult)
            return {
              select: () => Object.assign(result, { single: () => Promise.resolve(conversationInsertResult) }),
            }
          },
          select: () => ({ or: () => ({ maybeSingle: () => Promise.resolve(conversationLookup) }) }),
          delete: () => { conversationDelete(); return { eq: () => Promise.resolve({ error: null }) } },
        }
      }
      return {
        insert: (row: unknown) => {
          messageInsert(row)
          const result = Promise.resolve({ data: [{ id: 'm1', ...(row as object) }], error: null })
          return Object.assign(result, { select: () => result })
        },
      }
    },
    rpc: (fn: string) => {
      rpcCalls.push(fn)
      return Promise.resolve({ data: null, error: null })
    },
    channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
    removeChannel: vi.fn(),
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))
vi.mock('@/lib/toast', () => {
  // Stable identities: the hook lists these in effect dependencies.
  const store = { addToast: (message: string, type: string) => { toasts.push({ message, type }) } }
  return {
    useToastStore: (selector?: (s: typeof store) => unknown) => (selector ? selector(store) : store),
  }
})
vi.mock('@/lib/unread', () => {
  const store = { initialize: () => {}, refresh: () => {}, adjust: () => {} }
  return { useUnreadStore: (selector: (s: typeof store) => unknown) => selector(store) }
})
vi.mock('@/lib/rateLimit', () => ({
  checkMessageRateLimit: () => Promise.resolve(null),
  formatRateLimitError: () => 'rate limited',
}))
vi.mock('@/lib/sentryHelpers', () => ({
  reportSupabaseError: (...args: unknown[]) => reportSupabaseError(...args),
}))
vi.mock('@sentry/react', () => ({ addBreadcrumb: vi.fn(), captureException: vi.fn() }))
vi.mock('@/lib/trackDbEvent', () => ({ trackDbEvent: vi.fn() }))
vi.mock('@/lib/analytics', () => ({ trackMessageSend: vi.fn(), trackConversationStart: vi.fn() }))
vi.mock('@/lib/monitor', () => ({
  monitor: { measure: (_name: string, fn: () => Promise<unknown>) => fn() },
}))

import { useChat } from '@/hooks/useChat'
import { sendSharedPostMessage } from '@/lib/sharePost'
import {
  NEW_CONVERSATION_LIMIT_MESSAGE,
  isNewConversationLimitError,
} from '@/lib/newConversationLimit'
import type { Conversation, SharedPostMetadata } from '@/types/chat'

const pendingConversation = {
  id: 'pending-user-2',
  participant_one_id: 'user-1',
  participant_two_id: 'user-2',
  isPending: true,
  origin: 'Direct',
} as unknown as Conversation

beforeEach(() => {
  toasts.length = 0
  rpcCalls.length = 0
  conversationInsertResult = { data: null, error: REFUSAL }
  conversationLookup = { data: null, error: null }
  conversationInsert.mockClear()
  conversationDelete.mockClear()
  messageInsert.mockClear()
  reportSupabaseError.mockClear()
})

describe('isNewConversationLimitError', () => {
  it('recognises the refusal by its code or by its sentence, and nothing else', () => {
    expect(NEW_CONVERSATION_LIMIT_MESSAGE).toBe("You've started a lot of new conversations today. You can start more tomorrow.")
    expect(isNewConversationLimitError(REFUSAL)).toBe(true)
    expect(isNewConversationLimitError({ message: 'x', details: 'new_conversation_limit' })).toBe(true)
    expect(isNewConversationLimitError({ message: NEW_CONVERSATION_LIMIT_MESSAGE })).toBe(true)
    expect(isNewConversationLimitError({ code: '23505', message: 'duplicate key value' })).toBe(false)
    expect(isNewConversationLimitError({ message: 'message_rate_limit_exceeded', details: 'Burst limit' })).toBe(false)
    expect(isNewConversationLimitError(null)).toBe(false)
    expect(isNewConversationLimitError('new_conversation_limit')).toBe(false)
  })
})

describe('first message to someone new, refused by the daily allowance', () => {
  it('shows the sentence as a note, sends nothing, and reports the refusal once', async () => {
    const onConversationCreated = vi.fn()
    const { result } = renderHook(() =>
      useChat({ conversation: pendingConversation, currentUserId: 'user-1', onConversationCreated }),
    )

    let sent: boolean | undefined
    await act(async () => {
      sent = await result.current.sendMessage('Hello there')
    })

    expect(sent).toBe(false)
    expect(conversationInsert).toHaveBeenCalledTimes(1)
    expect(messageInsert).not.toHaveBeenCalled()
    expect(conversationDelete).not.toHaveBeenCalled()
    expect(onConversationCreated).not.toHaveBeenCalled()
    expect(toasts).toEqual([{ message: NEW_CONVERSATION_LIMIT_MESSAGE, type: 'info' }])
    expect(rpcCalls.filter((fn) => fn === 'log_new_conversation_refusal')).toHaveLength(1)
    // A normal refusal is not an error report, and no failed bubble is left in the thread.
    expect(reportSupabaseError).not.toHaveBeenCalled()
    expect(result.current.messages).toEqual([])
    expect(result.current.sending).toBe(false)
  })

  it('still sends when the conversation is created', async () => {
    conversationInsertResult = {
      data: [{ id: 'conv-new', participant_one_id: 'user-1', participant_two_id: 'user-2', origin: 'Direct' }],
      error: null,
    }
    const onConversationCreated = vi.fn()
    const { result } = renderHook(() =>
      useChat({ conversation: pendingConversation, currentUserId: 'user-1', onConversationCreated }),
    )

    let sent: boolean | undefined
    await act(async () => {
      sent = await result.current.sendMessage('Hello there')
    })

    expect(sent).toBe(true)
    expect(messageInsert).toHaveBeenCalledWith(expect.objectContaining({ conversation_id: 'conv-new', content: 'Hello there' }))
    expect(toasts).toEqual([])
    expect(rpcCalls).not.toContain('log_new_conversation_refusal')
  })
})

describe('sharing a post with someone new, refused by the daily allowance', () => {
  const postData: SharedPostMetadata = {
    type: 'shared_post',
    post_id: 'post-1',
    author_id: 'author-1',
    author_name: 'Author',
    author_avatar: null,
    author_role: 'player',
    content_preview: 'Hello',
    thumbnail_url: null,
  }

  it('returns the sentence for the toast and sends nothing', async () => {
    const result = await sendSharedPostMessage('user-1', 'user-2', postData)
    expect(result).toEqual({ success: false, error: NEW_CONVERSATION_LIMIT_MESSAGE })
    expect(messageInsert).not.toHaveBeenCalled()
    expect(rpcCalls.filter((fn) => fn === 'log_new_conversation_refusal')).toHaveLength(1)
  })
})
