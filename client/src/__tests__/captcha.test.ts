import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sentry/react', () => ({ captureMessage: vi.fn() }))
import * as Sentry from '@sentry/react'
import { captchaConfigured, captchaErrorMessage, getCaptchaToken, reportCaptchaCoverage } from '@/lib/captcha'

afterEach(() => { vi.unstubAllEnvs(); delete (window as { turnstile?: unknown }).turnstile })

describe('captcha (Turnstile, 2026-10-19)', () => {
  it('without a site key: no token, auth calls go out unchanged', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '')
    expect(captchaConfigured()).toBe(false)
    expect(await getCaptchaToken('login')).toBeUndefined()
  })

  it('with a site key: renders one invisible widget and returns its token', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '1x00000000000000000000AA')
    const render = vi.fn((_el: HTMLElement, opts: Record<string, unknown>) => { setTimeout(() => (opts.callback as (t: string) => void)('tok-123'), 0); return 'w1' })
    window.turnstile = { render, remove: vi.fn() }
    expect(captchaConfigured()).toBe(true)
    expect(await getCaptchaToken('signup')).toBe('tok-123')
    expect(render).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({ sitekey: '1x00000000000000000000AA', action: 'signup', appearance: 'interaction-only' }))
  })

  it('an error from the widget never throws: undefined, the server decides', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'key')
    window.turnstile = { render: (_el, opts) => { setTimeout(() => (opts['error-callback'] as () => void)(), 0); return 'w2' }, remove: vi.fn() }
    expect(await getCaptchaToken('reset')).toBeUndefined()
  })

  it('coverage (2026-10-28): an accepted request reports whether it carried a token, once', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'key')
    const capture = vi.mocked(Sentry.captureMessage)
    window.turnstile = { render: (_el, opts) => { setTimeout(() => (opts.callback as (t: string) => void)('tok'), 0); return 'w3' }, remove: vi.fn() }
    await getCaptchaToken('login')
    capture.mockClear()
    reportCaptchaCoverage('login')
    expect(capture).toHaveBeenCalledWith('captcha coverage (login: token)', expect.objectContaining({
      tags: expect.objectContaining({ captcha_coverage: 'token', captcha_action: 'login', captcha_reason: 'none' }),
      fingerprint: ['captcha-coverage', 'login', 'token'],
    }))
    capture.mockClear()
    reportCaptchaCoverage('login') // already reported
    expect(capture).not.toHaveBeenCalled()

    window.turnstile = { render: (_el, opts) => { setTimeout(() => (opts['error-callback'] as (c: string) => void)('200100'), 0); return 'w4' }, remove: vi.fn() }
    await getCaptchaToken('reverify')
    capture.mockClear()
    reportCaptchaCoverage('reverify')
    expect(capture).toHaveBeenCalledWith('captcha coverage (reverify: missing)', expect.objectContaining({
      tags: expect.objectContaining({ captcha_coverage: 'missing', captcha_reason: 'error_200100', captcha_attempts: '2' }),
    }))
  })

  it('coverage stays silent without a site key or a token request', async () => {
    const capture = vi.mocked(Sentry.captureMessage)
    capture.mockClear()
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'key')
    reportCaptchaCoverage('resend') // no token was requested for it
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '')
    await getCaptchaToken('magic_link')
    reportCaptchaCoverage('magic_link')
    expect(capture).not.toHaveBeenCalled()
  })

  it('maps Supabase captcha refusals to plain words', () => {
    expect(captchaErrorMessage('captcha protection: request disallowed (captcha verification process failed)')).toMatch(/security check/)
    expect(captchaErrorMessage('Invalid login credentials')).toBeNull()
  })

  it('picks the real key for production and the always-pass test key elsewhere', async () => {
    const seen: string[] = []
    window.turnstile = { render: (_el, opts) => { seen.push(String(opts.sitekey)); setTimeout(() => (opts.callback as (t: string) => void)('t'), 0); return 'w' }, remove: vi.fn() }
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '')
    vi.stubEnv('MODE', 'production')
    vi.stubEnv('VITE_SUPABASE_URL', 'https://xtertgftujnebubxgqit.supabase.co')
    await getCaptchaToken('login')
    vi.stubEnv('VITE_SUPABASE_URL', 'https://ivjkdaylalhsteyyclvl.supabase.co')
    await getCaptchaToken('login')
    expect(seen).toEqual(['0x4AAAAAAFbbx3EJbwS2Zs-d', '1x00000000000000000000AA'])
  })
})
