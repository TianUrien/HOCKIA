import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@sentry/react', () => ({
  captureException: vi.fn(),
  setTag: vi.fn(),
  setContext: vi.fn(),
}))

vi.mock('@/lib/inAppBrowser', () => ({
  detectInAppBrowser: vi.fn(() => ({
    isInAppBrowser: false,
    browserName: null,
    canOpenInExternalBrowser: false,
    suggestedAction: null,
  })),
}))

import * as Sentry from '@sentry/react'
import { toSentryError, reportSupabaseError, reportAuthFlowError } from '@/lib/sentryHelpers'

describe('toSentryError', () => {
  it('passes through existing Error instances unchanged', () => {
    const original = new Error('already an error')
    const result = toSentryError(original)

    expect(result).toBe(original)
    expect(result.message).toBe('already an error')
  })

  it('wraps plain objects as Error with name SupabaseError', () => {
    const obj = { code: '23505', message: 'duplicate key value', details: 'Key already exists' }
    const result = toSentryError(obj)

    expect(result).toBeInstanceOf(Error)
    expect(result.name).toBe('SupabaseError')
    expect(result.message).toBe('duplicate key value')
  })

  it('uses "Unknown Supabase error" for objects without a message', () => {
    const obj = { code: '42501' }
    const result = toSentryError(obj)

    expect(result.message).toBe('Unknown Supabase error')
    expect(result.name).toBe('SupabaseError')
  })

  it('preserves the raw error as __raw property', () => {
    const raw = { code: '23505', message: 'test' }
    const result = toSentryError(raw)

    expect((result as unknown as Record<string, unknown>).__raw).toBe(raw)
  })

  it('handles null by wrapping with default message', () => {
    const result = toSentryError(null)

    expect(result).toBeInstanceOf(Error)
    expect(result.message).toBe('Unknown Supabase error')
  })

  it('handles string error by wrapping with default message', () => {
    const result = toSentryError('string error')

    expect(result).toBeInstanceOf(Error)
    expect(result.name).toBe('SupabaseError')
  })
})

describe('reportSupabaseError', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls Sentry.captureException with correct tags', () => {
    reportSupabaseError('messaging.send', { code: 'PGRST116', message: 'not found' })

    expect(Sentry.captureException).toHaveBeenCalledTimes(1)

    const [, options] = vi.mocked(Sentry.captureException).mock.calls[0] as unknown as [unknown, { tags?: Record<string, unknown>; extra?: Record<string, unknown> }]
    expect(options!.tags!.scope).toBe('messaging.send')
    expect(options!.tags!.isSupabase).toBe(true)
  })

  it('includes Supabase error metadata in extras', () => {
    reportSupabaseError('test.scope', {
      code: '23505',
      details: 'Key already exists',
      hint: 'Check constraint',
    })

    const [, options] = vi.mocked(Sentry.captureException).mock.calls[0] as unknown as [unknown, { tags?: Record<string, unknown>; extra?: Record<string, unknown> }]
    expect(options!.extra!.supabaseCode).toBe('23505')
    expect(options!.extra!.supabaseDetails).toBe('Key already exists')
    expect(options!.extra!.supabaseHint).toBe('Check constraint')
  })

  it('passes custom extras and tags through', () => {
    reportSupabaseError(
      'vacancies.apply',
      { message: 'RLS violation' },
      { vacancyId: 'v-123', userId: 'u-456' },
      { feature: 'opportunities', operation: 'apply' }
    )

    const [, options] = vi.mocked(Sentry.captureException).mock.calls[0] as unknown as [unknown, { tags?: Record<string, unknown>; extra?: Record<string, unknown> }]
    expect(options!.extra!.vacancyId).toBe('v-123')
    expect(options!.extra!.userId).toBe('u-456')
    expect(options!.tags!.feature).toBe('opportunities')
    expect(options!.tags!.operation).toBe('apply')
  })

  it('includes in-app browser context in tags', () => {
    reportSupabaseError('test', { message: 'err' })

    const [, options] = vi.mocked(Sentry.captureException).mock.calls[0] as unknown as [unknown, { tags?: Record<string, unknown>; extra?: Record<string, unknown> }]
    expect(options!.tags).toHaveProperty('isInAppBrowser')
    expect(options!.tags).toHaveProperty('inAppBrowserName')
  })
})

describe('reportAuthFlowError', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('includes feature: auth_flow tag', () => {
    reportAuthFlowError('login', new Error('auth failed'))

    const [, options] = vi.mocked(Sentry.captureException).mock.calls[0] as unknown as [unknown, { tags?: Record<string, unknown>; extra?: Record<string, unknown> }]
    expect(options!.tags!.feature).toBe('auth_flow')
  })

  it('includes the stage tag', () => {
    reportAuthFlowError('pkce_exchange', new Error('PKCE error'))

    const [, options] = vi.mocked(Sentry.captureException).mock.calls[0] as unknown as [unknown, { tags?: Record<string, unknown>; extra?: Record<string, unknown> }]
    expect(options!.tags!.stage).toBe('pkce_exchange')
  })

  it('passes custom extras through', () => {
    reportAuthFlowError('login', new Error('fail'), { userId: 'u-123', provider: 'email' })

    const [, options] = vi.mocked(Sentry.captureException).mock.calls[0] as unknown as [unknown, { tags?: Record<string, unknown>; extra?: Record<string, unknown> }]
    expect(options!.extra!.userId).toBe('u-123')
    expect(options!.extra!.provider).toBe('email')
  })
})
