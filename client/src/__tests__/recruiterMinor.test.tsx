import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Founder ruling 2026-10-06: clubs and recruiting coaches cannot START a
// conversation with an under-18. The database refuses the conversations insert
// (P0001, DETAIL recruiter_minor); the client shows the server's sentence as an
// info note, sends nothing and reports nothing as an error.

const REFUSAL = {
  code: 'P0001',
  message: "This member can't be contacted by clubs or coaches.",
  details: 'recruiter_minor',
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
import { RECRUITER_MINOR_MESSAGE, isRecruiterMinorError, recruiterCannotStartWith } from '@/lib/recruiterMinor'
import { isNewConversationLimitError } from '@/lib/newConversationLimit'
import type { Conversation, SharedPostMetadata } from '@/types/chat'

const pendingConversation = {
  id: 'pending-minor',
  participant_one_id: 'club-1',
  participant_two_id: 'minor-1',
  isPending: true,
  origin: 'Direct',
} as unknown as Conversation

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-06T12:00:00Z'))
  toasts.length = 0
  rpcCalls.length = 0
  conversationInsertResult = { data: null, error: REFUSAL }
  conversationLookup = { data: null, error: null }
  conversationInsert.mockClear()
  conversationDelete.mockClear()
  messageInsert.mockClear()
  reportSupabaseError.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('isRecruiterMinorError', () => {
  it('recognises the refusal by its code or by its sentence, and nothing else', () => {
    expect(RECRUITER_MINOR_MESSAGE).toBe("This member can't be contacted by clubs or coaches.")
    expect(isRecruiterMinorError(REFUSAL)).toBe(true)
    expect(isRecruiterMinorError({ message: 'x', details: 'recruiter_minor' })).toBe(true)
    expect(isRecruiterMinorError({ message: RECRUITER_MINOR_MESSAGE })).toBe(true)
    expect(isRecruiterMinorError({ code: '23505', message: 'duplicate key value' })).toBe(false)
    expect(isRecruiterMinorError({ message: 'x', details: 'new_conversation_limit' })).toBe(false)
    expect(isRecruiterMinorError(null)).toBe(false)
    expect(isRecruiterMinorError('recruiter_minor')).toBe(false)
    // and the daily-allowance check does not swallow it
    expect(isNewConversationLimitError(REFUSAL)).toBe(false)
  })
})

describe('recruiterCannotStartWith (profile Message button)', () => {
  it('is true only for a club or a recruiting coach looking at a known under-18', () => {
    expect(recruiterCannotStartWith({ role: 'club' }, 16)).toBe(true)
    expect(recruiterCannotStartWith({ role: 'coach', coach_recruits_for_team: true }, 17)).toBe(true)
    expect(recruiterCannotStartWith({ role: 'club' }, 18)).toBe(false)
    expect(recruiterCannotStartWith({ role: 'club' }, null)).toBe(false)
    expect(recruiterCannotStartWith({ role: 'club' }, undefined)).toBe(false)
    expect(recruiterCannotStartWith({ role: 'coach', coach_recruits_for_team: false }, 15)).toBe(false)
    expect(recruiterCannotStartWith({ role: 'player' }, 15)).toBe(false)
    expect(recruiterCannotStartWith(null, 15)).toBe(false)
  })
})

describe('a club starting a conversation with an under-18 (chat)', () => {
  it('shows the sentence as an info note, sends nothing and reports no error', async () => {
    const onConversationCreated = vi.fn()
    const { result } = renderHook(() =>
      useChat({ conversation: pendingConversation, currentUserId: 'club-1', onConversationCreated }),
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
    expect(toasts).toEqual([{ message: RECRUITER_MINOR_MESSAGE, type: 'info' }])
    expect(reportSupabaseError).not.toHaveBeenCalled()
    // Not the daily allowance: nothing is reported for the admin signal.
    expect(rpcCalls).not.toContain('log_new_conversation_refusal')
    expect(result.current.messages).toEqual([])
    expect(result.current.sending).toBe(false)
  })
})

describe('a club sharing a post with an under-18', () => {
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

  it('returns the sentence as a notice and sends nothing', async () => {
    const result = await sendSharedPostMessage('club-1', 'minor-1', postData)
    expect(result).toEqual({ success: false, error: RECRUITER_MINOR_MESSAGE, notice: true })
    expect(messageInsert).not.toHaveBeenCalled()
    expect(rpcCalls).not.toContain('log_new_conversation_refusal')
  })

  it('still shares into an existing conversation', async () => {
    conversationLookup = { data: { id: 'conv-existing' }, error: null }
    const result = await sendSharedPostMessage('club-1', 'minor-1', postData)
    expect(result).toEqual({ success: true })
    expect(conversationInsert).not.toHaveBeenCalled()
    expect(messageInsert).toHaveBeenCalledWith(expect.objectContaining({ conversation_id: 'conv-existing' }))
  })
})
