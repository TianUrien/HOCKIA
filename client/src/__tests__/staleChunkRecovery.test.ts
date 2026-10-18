import { afterEach, describe, expect, it, vi } from 'vitest'
import { recoverFromStaleChunk } from '@/lib/swUpdate'

type Listener = () => void

function fakeWorker() {
  const listeners: Listener[] = []
  return { state: 'installing', postMessage: vi.fn(), addEventListener: (_: string, l: Listener) => listeners.push(l), fire(state: string) { this.state = state; listeners.forEach((l) => l()) } }
}

function installNavigator(reg: unknown, controller: { listeners: Listener[] }) {
  Object.defineProperty(globalThis.navigator, 'serviceWorker', {
    configurable: true,
    value: {
      getRegistration: vi.fn().mockResolvedValue(reg),
      addEventListener: (_: string, l: Listener) => controller.listeners.push(l),
    },
  })
}

afterEach(() => { delete (globalThis.navigator as { serviceWorker?: unknown }).serviceWorker })

describe('stale chunk recovery (prod 2026-10-18)', () => {
  it('activates a waiting worker, then reloads once it controls the page', async () => {
    const waiting = fakeWorker()
    const controller = { listeners: [] as Listener[] }
    const reg = { waiting, installing: null, update: vi.fn().mockResolvedValue(undefined), addEventListener: vi.fn() }
    waiting.postMessage.mockImplementation(() => controller.listeners.forEach((l) => l()))
    installNavigator(reg, controller)
    const reload = vi.fn()
    await recoverFromStaleChunk({ reload, timeoutMs: 50 })
    expect(reg.update).toHaveBeenCalled()
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('waits for a worker that is still installing', async () => {
    const installing = fakeWorker()
    const controller = { listeners: [] as Listener[] }
    const reg: { waiting: unknown; installing: unknown; update: () => Promise<void>; addEventListener: () => void } = { waiting: null, installing, update: vi.fn().mockResolvedValue(undefined), addEventListener: vi.fn() }
    installing.postMessage.mockImplementation(() => controller.listeners.forEach((l) => l()))
    installNavigator(reg, controller)
    const reload = vi.fn()
    const done = recoverFromStaleChunk({ reload, timeoutMs: 1000 })
    await Promise.resolve(); await Promise.resolve()
    reg.waiting = installing
    installing.fire('installed')
    await done
    expect(installing.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('no new worker (or no service worker at all): still reloads', async () => {
    const controller = { listeners: [] as Listener[] }
    installNavigator({ waiting: null, installing: null, update: vi.fn().mockRejectedValue(new Error('offline')), addEventListener: vi.fn() }, controller)
    const reload = vi.fn()
    await recoverFromStaleChunk({ reload, timeoutMs: 20 })
    expect(reload).toHaveBeenCalledTimes(1)
    delete (globalThis.navigator as { serviceWorker?: unknown }).serviceWorker
    const reload2 = vi.fn()
    await recoverFromStaleChunk({ reload: reload2, timeoutMs: 20 })
    expect(reload2).toHaveBeenCalledTimes(1)
  })
})
