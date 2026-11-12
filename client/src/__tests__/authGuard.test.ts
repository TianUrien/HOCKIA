import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'anon-key' }))
vi.mock('@/lib/analyticsIdentity', () => ({ getAnonymousId: () => 'install-1' }))
vi.mock('@/lib/appVersion', () => ({
  getRuntimePlatform: () => 'android-native',
  getAppVersion: () => Promise.resolve({ version: '1.26', build: '28' }),
}))
const getCaptchaToken = vi.fn()
vi.mock('@/lib/captcha', () => ({
  getCaptchaToken: (...args: unknown[]) => getCaptchaToken(...args),
  CAPTCHA_FAILED_COPY: 'captcha failed copy',
}))

import { guardCheck, guardReportFailedSignIn, rateLimitedCopy, setAuthGuardEnabledForTests } from '@/lib/authGuard'

const fetchMock = vi.fn()
const answer = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))
const sentBody = (call: number) => JSON.parse(fetchMock.mock.calls[call][1].body as string)

describe('authGuard', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    getCaptchaToken.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    setAuthGuardEnabledForTests(true)
  })
  afterEach(() => {
    setAuthGuardEnabledForTests(false)
    vi.unstubAllGlobals()
  })

  it('does nothing in other unit tests (no network) until enabled', async () => {
    setAuthGuardEnabledForTests(false)
    expect(await guardCheck('password_signin')).toEqual({ allowed: true })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends the kind, provider and client details to the function', async () => {
    fetchMock.mockReturnValueOnce(answer({ allowed: true }))
    expect(await guardCheck('oauth_start', 'apple')).toEqual({ allowed: true })
    expect(fetchMock.mock.calls[0][0]).toBe('https://example.supabase.co/functions/v1/auth-guard')
    expect(sentBody(0)).toEqual({
      action: 'check', kind: 'oauth_start', provider: 'apple',
      client: { platform: 'android', appVersion: '1.26', installId: 'install-1' },
    })
  })

  it('lets the person through when the function is unreachable, missing or broken', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect((await guardCheck('signup')).allowed).toBe(true)
    fetchMock.mockReturnValueOnce(answer({ message: 'not found' }, 404))
    expect((await guardCheck('signup')).allowed).toBe(true)
    fetchMock.mockReturnValueOnce(answer({ error: 'boom' }, 500))
    expect((await guardCheck('signup')).allowed).toBe(true)
    fetchMock.mockReturnValueOnce(Promise.resolve(new Response('not json', { status: 200 })))
    expect((await guardCheck('signup')).allowed).toBe(true)
    fetchMock.mockReturnValueOnce(answer({ allowed: false, reason: 'something_new' }))
    expect((await guardCheck('signup')).allowed).toBe(true)
  })

  it('lets the person through when the function does not answer in time', async () => {
    vi.useFakeTimers()
    try {
      fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      }))
      const pending = guardCheck('password_signin')
      await vi.advanceTimersByTimeAsync(3000)
      expect((await pending).allowed).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('passes a rate-limit refusal on with the wait in plain words', async () => {
    fetchMock.mockReturnValueOnce(answer({ allowed: false, reason: 'rate_limited', retryAfter: 170 }))
    expect(await guardCheck('password_signin')).toEqual({
      allowed: false, reason: 'rate_limited', message: 'Too many attempts. Please try again in 3 minutes.',
    })
  })

  it('gets a bot-check token and asks again when the server requires one', async () => {
    fetchMock.mockReturnValueOnce(answer({ allowed: false, reason: 'captcha_required' }))
    fetchMock.mockReturnValueOnce(answer({ allowed: true }))
    getCaptchaToken.mockResolvedValueOnce('token-1')
    expect(await guardCheck('oauth_start', 'google')).toEqual({ allowed: true })
    expect(getCaptchaToken).toHaveBeenCalledWith('guard')
    expect(sentBody(1).captchaToken).toBe('token-1')
  })

  it('refuses with the bot-check copy when no token can be had or the token is rejected', async () => {
    fetchMock.mockReturnValueOnce(answer({ allowed: false, reason: 'captcha_required' }))
    getCaptchaToken.mockResolvedValueOnce(undefined)
    expect(await guardCheck('signup')).toEqual({ allowed: false, reason: 'captcha_failed', message: 'captcha failed copy' })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    fetchMock.mockReturnValueOnce(answer({ allowed: false, reason: 'captcha_required' }))
    fetchMock.mockReturnValueOnce(answer({ allowed: false, reason: 'captcha_failed' }))
    getCaptchaToken.mockResolvedValueOnce('bad-token')
    expect((await guardCheck('signup')).reason).toBe('captcha_failed')
  })

  it('reports a failed password sign-in without waiting', async () => {
    fetchMock.mockReturnValueOnce(answer({ ok: true }))
    guardReportFailedSignIn()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(sentBody(0)).toMatchObject({ action: 'report', kind: 'password_signin_failed' })
  })

  it('rounds the wait up to minutes', () => {
    expect(rateLimitedCopy(30)).toBe('Too many attempts. Please try again in a minute.')
    expect(rateLimitedCopy(null)).toBe('Too many attempts. Please try again in a minute.')
    expect(rateLimitedCopy(61)).toBe('Too many attempts. Please try again in 2 minutes.')
  })
})
