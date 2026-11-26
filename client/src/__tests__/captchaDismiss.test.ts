import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@sentry/react', () => ({ captureMessage: vi.fn() }))
import * as Sentry from '@sentry/react'
import { getCaptchaTokenResult, stopWarmCaptcha, warmCaptcha } from '@/lib/captcha'

afterEach(() => { vi.unstubAllEnvs(); delete (window as { turnstile?: unknown }).turnstile })

/** A widget that asks for a human and then waits for the person. */
function interactiveWidget() {
  const render = vi.fn((_el: HTMLElement, opts: Record<string, unknown>) => {
    setTimeout(() => (opts['before-interactive-callback'] as () => void)(), 0)
    return 'w'
  })
  const remove = vi.fn()
  window.turnstile = { render, remove }
  return { render, remove }
}

const sheetOpen = () => document.querySelector('[data-testid="captcha-host"]')?.getAttribute('aria-modal') === 'true'

describe('captcha sheet can always be left (2026-11-26)', () => {
  it('the close button ends the check quietly: no token, no retry, no report', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'key')
    const { render } = interactiveWidget()
    const capture = vi.mocked(Sentry.captureMessage)
    capture.mockClear()
    const pending = getCaptchaTokenResult('login')
    await vi.waitFor(() => expect(sheetOpen()).toBe(true))
    const close = document.querySelector<HTMLButtonElement>('[data-testid="captcha-close"]')
    expect(close?.getAttribute('aria-label')).toBeTruthy()
    close!.click()
    const result = await pending
    expect(result).toEqual({ reason: 'dismissed', attempts: 1 })
    expect(render).toHaveBeenCalledTimes(1)
    expect(sheetOpen()).toBe(false)
    expect(capture).not.toHaveBeenCalled()
  })

  it('leaving the sign-in form stops its warmed check, so it cannot appear on another screen', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'key')
    const { remove } = interactiveWidget()
    warmCaptcha('login')
    await vi.waitFor(() => expect(sheetOpen()).toBe(true))
    stopWarmCaptcha('login')
    expect(sheetOpen()).toBe(false)
    expect(remove).toHaveBeenCalled()
  })

  it('stopping another form leaves a warmed check alone', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'key')
    window.turnstile = { render: vi.fn(() => 'w'), remove: vi.fn() }
    warmCaptcha('signup')
    await vi.waitFor(() => expect(window.turnstile!.render).toHaveBeenCalled())
    const removals = vi.mocked(window.turnstile!.remove).mock.calls.length
    stopWarmCaptcha('login')
    expect(vi.mocked(window.turnstile!.remove).mock.calls.length).toBe(removals)
    stopWarmCaptcha('signup')
  })
})
