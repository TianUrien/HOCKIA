/**
 * Sign-in captcha timeouts (2026-10-21): one retry with a fresh widget,
 * quiet outcomes not reported, one informative Sentry message per request.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const captureMessage = vi.hoisted(() => vi.fn())
vi.mock('@sentry/react', () => ({ captureMessage }))
import { getCaptchaTokenResult, resetCaptcha, warmCaptcha } from '@/lib/captcha'

type Opts = Record<string, unknown>
const cb = (opts: Opts, name: string) => opts[name] as (arg?: string) => void

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'key')
  captureMessage.mockClear()
})
afterEach(() => {
  resetCaptcha()
  vi.useRealTimers()
  vi.unstubAllEnvs()
  delete (window as { turnstile?: unknown }).turnstile
})

describe('captcha retry and fallback', () => {
  it('a widget that times out is replaced by a fresh one, which can still deliver the token', async () => {
    const remove = vi.fn()
    let n = 0
    const render = vi.fn((_el: HTMLElement, opts: Opts) => {
      n += 1
      if (n === 2) setTimeout(() => cb(opts, 'callback')('tok-2'), 10)
      return `w${n}`
    })
    window.turnstile = { render, remove }
    const p = getCaptchaTokenResult('login')
    await vi.advanceTimersByTimeAsync(12_000) // first widget: no answer
    await vi.advanceTimersByTimeAsync(20)
    await expect(p).resolves.toEqual({ token: 'tok-2', attempts: 2 })
    expect(render).toHaveBeenCalledTimes(2)
    expect(remove).toHaveBeenCalledWith('w1')
    expect(captureMessage).not.toHaveBeenCalled()
  })

  it('reports once, with the attempt count and reasons, when both widgets fail', async () => {
    window.turnstile = { render: vi.fn((_el: HTMLElement, opts: Opts) => { setTimeout(() => cb(opts, 'error-callback')('200100'), 5); return 'w' }), remove: vi.fn() }
    const p = getCaptchaTokenResult('login')
    await vi.advanceTimersByTimeAsync(50)
    await expect(p).resolves.toEqual({ reason: 'error_200100', attempts: 2 })
    expect(captureMessage).toHaveBeenCalledTimes(1)
    expect(captureMessage).toHaveBeenCalledWith('captcha token unavailable (login: error_200100)', expect.objectContaining({
      tags: expect.objectContaining({ captcha_attempts: '2', captcha_reason: 'error_200100' }),
      extra: { captcha_reasons: 'error_200100,error_200100' },
    }))
  })

  it('a visible check left unanswered is the person stepping away: no retry, no report', async () => {
    const render = vi.fn((_el: HTMLElement, opts: Opts) => { setTimeout(() => cb(opts, 'before-interactive-callback')(), 5); return 'w' })
    window.turnstile = { render, remove: vi.fn() }
    const p = getCaptchaTokenResult('login')
    await vi.advanceTimersByTimeAsync(60_010)
    await expect(p).resolves.toEqual({ reason: 'interactive_timeout', attempts: 1 })
    expect(render).toHaveBeenCalledTimes(1)
    expect(captureMessage).not.toHaveBeenCalled()
  })

  it('the host box stays rendered while idle so the WebView runs the check', async () => {
    window.turnstile = { render: vi.fn((_el: HTMLElement, opts: Opts) => { setTimeout(() => cb(opts, 'callback')('t'), 5); return 'w' }), remove: vi.fn() }
    const p = getCaptchaTokenResult('signup')
    await vi.advanceTimersByTimeAsync(10)
    await p
    const host = document.querySelector('[data-testid="captcha-host"]') as HTMLElement
    expect(host.style.display).toBe('block')
  })

  it('a warm widget replaced by another action is settled quietly, not counted as a timeout', async () => {
    const render = vi.fn((_el: HTMLElement, opts: Opts) => {
      if (opts.action === 'signup') setTimeout(() => cb(opts, 'callback')('tok-signup'), 5)
      return String(opts.action)
    })
    window.turnstile = { render, remove: vi.fn() }
    warmCaptcha('login')
    await vi.advanceTimersByTimeAsync(1)
    const p = getCaptchaTokenResult('signup')
    await vi.advanceTimersByTimeAsync(10)
    await expect(p).resolves.toEqual({ token: 'tok-signup', attempts: 1 })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(captureMessage).not.toHaveBeenCalled()
  })

  it('uses the warmed token for the same action without rendering again', async () => {
    const render = vi.fn((_el: HTMLElement, opts: Opts) => { setTimeout(() => cb(opts, 'callback')('warm-tok'), 5); return 'w' })
    window.turnstile = { render, remove: vi.fn() }
    warmCaptcha('login')
    await vi.advanceTimersByTimeAsync(10)
    await expect(getCaptchaTokenResult('login')).resolves.toEqual({ token: 'warm-tok', attempts: 1 })
    expect(render).toHaveBeenCalledTimes(1)
  })

  it('a stalled script load is dropped and retried with a new script tag', async () => {
    const tags = () => document.head.querySelectorAll('script[src*="turnstile"]')
    const p = getCaptchaTokenResult('login')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(tags().length).toBe(1) // the stalled tag was removed, a new one added
    window.turnstile = { render: vi.fn((_el: HTMLElement, opts: Opts) => { setTimeout(() => cb(opts, 'callback')('late'), 5); return 'w' }), remove: vi.fn() }
    const tag = tags()[0] as HTMLScriptElement
    tag.onload?.(new Event('load'))
    await vi.advanceTimersByTimeAsync(10)
    await expect(p).resolves.toEqual({ token: 'late', attempts: 2 })
  })
})
