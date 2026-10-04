/**
 * Onboarding QA 2026-10-04: a service-worker update must NEVER reload the page
 * on its own. A waiting version shows "A new version of HOCKIA is ready" with
 * Reload (applies it) and Dismiss; only the Reload tap reloads.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), debug: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

import UpdatePrompt from '@/components/UpdatePrompt'
import { registerServiceWorker, type WorkboxLike } from '@/lib/swUpdate'

describe('UpdatePrompt', () => {
  it('shows the neutral message with Reload and Dismiss', () => {
    render(<UpdatePrompt onReload={vi.fn()} />)
    expect(screen.getByRole('status')).toHaveTextContent('A new version of HOCKIA is ready')
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
