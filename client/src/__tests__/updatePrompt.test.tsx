/**
 * Onboarding QA 2026-10-04: a service-worker update must NEVER reload the page
 * on its own. A waiting version shows "A new version of Hockia is ready" with
 * Reload (applies it) and Dismiss; only the Reload tap reloads.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@sentry/react', () => ({ captureMessage: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), debug: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

import UpdatePrompt from '@/components/UpdatePrompt'
import * as Sentry from '@sentry/react'
import { applyPendingUpdate, isSafeSilentUpdate, registerServiceWorker, resetPendingUpdateForTests, watchForStuckInstall, type WorkboxLike } from '@/lib/swUpdate'

describe('UpdatePrompt', () => {
  it('shows the neutral message with Reload and Dismiss', () => {
    render(<UpdatePrompt onReload={vi.fn()} />)
    expect(screen.getByRole('status')).toHaveTextContent('A new version of Hockia is ready')
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument()
  })

  it('Reload applies the update', () => {
    const onReload = vi.fn()
    render(<UpdatePrompt onReload={onReload} />)
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(onReload).toHaveBeenCalledTimes(1)
  })

  it('Dismiss hides it without applying anything', () => {
    const onReload = vi.fn()
    const onDismiss = vi.fn()
    render(<UpdatePrompt onReload={onReload} onDismiss={onDismiss} />)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(onReload).not.toHaveBeenCalled()
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})

type Listener = (event: { isUpdate?: boolean; isExternal?: boolean }) => void

function fakeWorkbox() {
  const listeners: Record<string, Listener[]> = {}
  const wb: WorkboxLike & { fire: (type: string, event?: { isUpdate?: boolean }) => void } = {
    addEventListener: (type, listener) => {
      ;(listeners[type] ??= []).push(listener)
    },
    register: vi.fn(() => Promise.resolve(undefined)),
    messageSkipWaiting: vi.fn(),
    fire: (type, event = {}) => listeners[type]?.forEach((l) => l(event)),
  }
  return wb
}

describe('service-worker update flow (web)', () => {
  beforeAll(() => {
    // jsdom has no service workers; the flow only checks for the API.
    if (!('serviceWorker' in navigator)) Object.defineProperty(navigator, 'serviceWorker', { value: {}, configurable: true })
  })

  it('a waiting version shows the prompt and does NOT reload or skip waiting by itself', () => {
    const wb = fakeWorkbox()
    const reload = vi.fn()
    const showPrompt = vi.fn()
    registerServiceWorker({ isNative: false, showPrompt, reload, createWorkbox: () => wb })

    wb.fire('waiting')
    expect(showPrompt).toHaveBeenCalledTimes(1)
    expect(wb.messageSkipWaiting).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  it('Reload sends SKIP_WAITING, and the page reloads only once the new worker controls it', () => {
    const wb = fakeWorkbox()
    const reload = vi.fn()
    let apply: () => void = () => {}
    registerServiceWorker({ isNative: false, showPrompt: (a) => { apply = a }, reload, createWorkbox: () => wb })

    wb.fire('waiting')
    apply()
    expect(wb.messageSkipWaiting).toHaveBeenCalledTimes(1)
    expect(reload).not.toHaveBeenCalled()
    wb.fire('controlling', { isUpdate: true })
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('an update applied from ANOTHER tab offers the reload instead of doing it', () => {
    const wb = fakeWorkbox()
    const reload = vi.fn()
    const showPrompt = vi.fn()
    registerServiceWorker({ isNative: false, showPrompt, reload, createWorkbox: () => wb })

    wb.fire('controlling', { isUpdate: true })
    expect(reload).not.toHaveBeenCalled()
    expect(showPrompt).toHaveBeenCalledTimes(1)
  })

  it('native keeps applying a waiting version straight away (no prompt)', () => {
    const wb = fakeWorkbox()
    const reload = vi.fn()
    const showPrompt = vi.fn()
    registerServiceWorker({ isNative: true, showPrompt, reload, createWorkbox: () => wb })

    wb.fire('waiting')
    expect(showPrompt).not.toHaveBeenCalled()
    expect(wb.messageSkipWaiting).toHaveBeenCalledTimes(1)
    wb.fire('controlling', { isUpdate: true })
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('registers immediately so a version left waiting from an earlier visit is reported on load', () => {
    const wb = fakeWorkbox()
    registerServiceWorker({ isNative: false, showPrompt: vi.fn(), createWorkbox: () => wb })
    expect(wb.register).toHaveBeenCalledWith({ immediate: true })
  })
})

describe('silent update for a signed-out arrival (founder ruling 2026-10-10)', () => {
  it('applies a waiting version without the prompt when it is safe', () => {
    const wb = fakeWorkbox()
    const reload = vi.fn()
    const showPrompt = vi.fn()
    registerServiceWorker({ isNative: false, showPrompt, reload, createWorkbox: () => wb, canApplySilently: () => true })
    wb.fire('waiting')
    expect(showPrompt).not.toHaveBeenCalled()
    expect(wb.messageSkipWaiting).toHaveBeenCalledTimes(1)
    wb.fire('controlling', { isUpdate: true })
    expect(reload).toHaveBeenCalledTimes(1)
  })

  const base = { signedIn: false, path: '/', sinceLoadMs: 1500 }
  it('is safe only signed out, on Home / Sign up / Log in, right after arrival', () => {
    document.body.innerHTML = ''
    expect(isSafeSilentUpdate({ ...base, doc: document })).toBe(true)
    expect(isSafeSilentUpdate({ ...base, path: '/signin', doc: document })).toBe(true)
    expect(isSafeSilentUpdate({ ...base, signedIn: true, doc: document })).toBe(false)
    expect(isSafeSilentUpdate({ ...base, path: '/signup/email', doc: document })).toBe(false)
    expect(isSafeSilentUpdate({ ...base, path: '/dashboard/profile', doc: document })).toBe(false)
    expect(isSafeSilentUpdate({ ...base, sinceLoadMs: 30_000, doc: document })).toBe(false)
  })

  it('is never safe once something has been typed or a field is focused', () => {
    document.body.innerHTML = '<input type="email" />'
    const input = document.querySelector('input') as HTMLInputElement
    expect(isSafeSilentUpdate({ ...base, path: '/signin', doc: document })).toBe(true)
    input.value = 'me@'
    expect(isSafeSilentUpdate({ ...base, path: '/signin', doc: document })).toBe(false)
    input.value = ''
    input.focus()
    expect(isSafeSilentUpdate({ ...base, path: '/signin', doc: document })).toBe(false)
    document.body.innerHTML = ''
  })
})

describe('signed-in members get the waiting version at the next safe moment (2026-11-25)', () => {
  beforeAll(() => {
    if (!('serviceWorker' in navigator)) Object.defineProperty(navigator, 'serviceWorker', { value: {}, configurable: true })
  })

  it('a move to another screen applies a version waiting behind the prompt', () => {
    resetPendingUpdateForTests()
    document.body.innerHTML = ''
    const wb = fakeWorkbox()
    const reload = vi.fn()
    registerServiceWorker({ isNative: false, showPrompt: vi.fn(), reload, createWorkbox: () => wb })
    wb.fire('waiting')
    expect(wb.messageSkipWaiting).not.toHaveBeenCalled()

    expect(applyPendingUpdate(document)).toBe(true)
    expect(wb.messageSkipWaiting).toHaveBeenCalledTimes(1)
    wb.fire('controlling', { isUpdate: true })
    expect(reload).toHaveBeenCalledTimes(1)
    // Applied once: a second safe moment does nothing more.
    expect(applyPendingUpdate(document)).toBe(false)
  })

  it('never applies while the page holds typed text, and does once it is clear', () => {
    resetPendingUpdateForTests()
    document.body.innerHTML = '<textarea></textarea>'
    const field = document.querySelector('textarea') as HTMLTextAreaElement
    field.value = 'Hello coach'
    const wb = fakeWorkbox()
    registerServiceWorker({ isNative: false, showPrompt: vi.fn(), reload: vi.fn(), createWorkbox: () => wb })
    wb.fire('waiting')

    expect(applyPendingUpdate(document)).toBe(false)
    expect(wb.messageSkipWaiting).not.toHaveBeenCalled()
    field.value = ''
    field.blur()
    expect(applyPendingUpdate(document)).toBe(true)
    document.body.innerHTML = ''
  })

  it('does nothing when no version is waiting', () => {
    resetPendingUpdateForTests()
    expect(applyPendingUpdate(document)).toBe(false)
  })
})

describe('a new version stuck installing is reported once', () => {
  it('reports to Sentry when the worker is still installing after the timeout', () => {
    vi.useFakeTimers()
    const sw = { state: 'installing' } as unknown as ServiceWorker
    const reg = { installing: sw, addEventListener: vi.fn() } as unknown as ServiceWorkerRegistration
    watchForStuckInstall(reg, 1000)
    vi.advanceTimersByTime(999)
    expect(Sentry.captureMessage).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1)
    // Once per page, even if another install stalls.
    watchForStuckInstall(reg, 1000)
    vi.advanceTimersByTime(1000)
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})
