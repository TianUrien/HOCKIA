import { afterEach, describe, expect, it, vi } from 'vitest'
import { captchaConfigured, captchaErrorMessage, getCaptchaToken } from '@/lib/captcha'

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

  it('maps Supabase captcha refusals to plain words', () => {
    expect(captchaErrorMessage('captcha protection: request disallowed (captcha verification process failed)')).toMatch(/not a bot/)
    expect(captchaErrorMessage('Invalid login credentials')).toBeNull()
  })
})
