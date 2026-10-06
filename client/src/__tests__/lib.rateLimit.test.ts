import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: vi.fn() },
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import {
  formatRateLimitError,
  checkLoginRateLimit,
  checkMessageRateLimit,
  checkSignupRateLimit,
  checkPasswordResetRateLimit,
  checkApplicationRateLimit,
} from '@/lib/rateLimit'
import type { RateLimitResult } from '@/lib/rateLimit'
import { supabase } from '@/lib/supabase'

describe('formatRateLimitError', () => {
  it('returns "in a minute" when reset_at is less than 1 minute away', () => {
    const result: RateLimitResult = {
      allowed: false,
      remaining: 0,
      reset_at: new Date(Date.now() + 30000).toISOString(), // 30 seconds
      limit: 5,
    }
    expect(formatRateLimitError(result)).toBe('Too many attempts. Please try again in a minute.')
  })

  it('returns "in N minutes" when reset_at is less than 60 minutes away', () => {
    const result: RateLimitResult = {
      allowed: false,
      remaining: 0,
      reset_at: new Date(Date.now() + 15 * 60000).toISOString(), // 15 minutes
      limit: 5,
    }
    expect(formatRateLimitError(result)).toBe('Too many attempts. Please try again in 15 minutes.')
  })

  it('returns "in 1 hour" singular for 60-119 minutes', () => {
    const result: RateLimitResult = {
      allowed: false,
      remaining: 0,
      reset_at: new Date(Date.now() + 60 * 60000).toISOString(), // 60 minutes
      limit: 5,
    }
    expect(formatRateLimitError(result)).toBe('Too many attempts. Please try again in 1 hour.')
  })

  it('returns "in N hours" plural for longer periods', () => {
    const result: RateLimitResult = {
      allowed: false,
      remaining: 0,
      reset_at: new Date(Date.now() + 3 * 60 * 60000).toISOString(), // 3 hours
      limit: 5,
    }
    expect(formatRateLimitError(result)).toBe('Too many attempts. Please try again in 3 hours.')
  })
})

describe('checkLoginRateLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns data on successful RPC call', async () => {
    const mockResult: RateLimitResult = {
      allowed: true,
      remaining: 4,
      reset_at: new Date().toISOString(),
      limit: 5,
    }
    vi.mocked(supabase.rpc).mockResolvedValue({ data: mockResult, error: null } as never)

    const result = await checkLoginRateLimit('test@example.com')
    expect(result).toEqual(mockResult)
    expect(supabase.rpc).toHaveBeenCalledWith('check_login_rate_limit', { p_email: 'test@example.com' })
  })

  it('fails open (null) on RPC error, so the caller carries on', async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: null,
      error: { message: 'function not found', code: 'PGRST202' },
    } as never)

    const result = await checkLoginRateLimit('test@example.com')
    expect(result).toBeNull()
  })

  it('fails open (null) on a network failure', async () => {
    vi.mocked(supabase.rpc).mockRejectedValue(new Error('Network failure'))

    const result = await checkLoginRateLimit('test@example.com')
    expect(result).toBeNull()
  })
})

describe('checkMessageRateLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns data on successful RPC call', async () => {
    const mockResult: RateLimitResult = {
      allowed: true,
      remaining: 29,
      reset_at: new Date().toISOString(),
      limit: 30,
    }
    vi.mocked(supabase.rpc).mockResolvedValue({ data: mockResult, error: null } as never)

    const result = await checkMessageRateLimit('user-123')
    expect(result).toEqual(mockResult)
    expect(supabase.rpc).toHaveBeenCalledWith('check_message_rate_limit', { p_user_id: 'user-123' })
  })

  it('fails open (null) on RPC error', async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: null,
      error: { message: 'function not found', code: 'PGRST202' },
    } as never)

    const result = await checkMessageRateLimit('user-123')
    expect(result).toBeNull()
  })

  it('fails open (null) on a network failure', async () => {
    vi.mocked(supabase.rpc).mockRejectedValue(new Error('Network failure'))

    const result = await checkMessageRateLimit('user-123')
    expect(result).toBeNull()
  })

  it('still passes a real refusal through', async () => {
    const refused: RateLimitResult = { allowed: false, remaining: 0, reset_at: new Date(Date.now() + 30_000).toISOString(), limit: 30 }
    vi.mocked(supabase.rpc).mockResolvedValue({ data: refused, error: null } as never)

    const result = await checkMessageRateLimit('user-123')
    expect(result).toEqual(refused)
  })
})

describe('the other pre-checks fail open too', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    ['checkSignupRateLimit', () => checkSignupRateLimit('a@b.co')],
    ['checkPasswordResetRateLimit', () => checkPasswordResetRateLimit('a@b.co')],
    ['checkApplicationRateLimit', () => checkApplicationRateLimit('user-123')],
  ])('%s returns null on RPC error and on a network failure', async (_name, call) => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: null, error: { message: 'boom', code: '500' } } as never)
    expect(await call()).toBeNull()
    vi.mocked(supabase.rpc).mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect(await call()).toBeNull()
  })
})
