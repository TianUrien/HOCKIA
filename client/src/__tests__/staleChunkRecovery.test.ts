import { afterEach, describe, expect, it, vi } from 'vitest'
import { STALE_CHUNK_KEY, STALE_RETRY_WINDOW_MS, claimStaleChunkRecovery, handleStaleChunkRejection, isStaleChunkRecoveryRunning, recoverFromStaleChunk } from '@/lib/swUpdate'

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

describe('stale chunk guard (prod 2026-10-30)', () => {
  afterEach(() => sessionStorage.clear())

  it('allows one recovery per minute, then again for a later deploy in the same tab', () => {
    const t0 = 1_000_000
    expect(claimStaleChunkRecovery(t0)).toBe(true)
    expect(claimStaleChunkRecovery(t0 + 5_000)).toBe(false) // the reload didn't help: no loop
    expect(claimStaleChunkRecovery(t0 + STALE_RETRY_WINDOW_MS + 1)).toBe(true)
  })

  it('treats the old "1" marker as an old recovery, not a block', () => {
    sessionStorage.setItem(STALE_CHUNK_KEY, '1')
    expect(claimStaleChunkRecovery()).toBe(true)
  })

  it('reports a running recovery so routes wait for the reload instead of the error screen', async () => {
    await recoverFromStaleChunk({ reload: vi.fn(), timeoutMs: 1 })
    expect(isStaleChunkRecoveryRunning()).toBe(true)
  })
})

describe('unhandled stale-chunk rejections (JAVASCRIPT-REACT-7J, 2026-11-27)', () => {
  afterEach(() => { sessionStorage.removeItem(STALE_CHUNK_KEY) })

  const rejection = (reason: unknown) => ({ reason, preventDefault: vi.fn() })
  // Earlier tests started recoveries; a fresh module has none running.
  const fresh = async () => { vi.resetModules(); return (await import('@/lib/swUpdate')).handleStaleChunkRejection }

  it('recovers once from a plain import() that hit a replaced chunk', async () => {
    const handleStaleChunkRejection = await fresh()
    sessionStorage.removeItem(STALE_CHUNK_KEY)
    const event = rejection(new TypeError('Importing a module script failed.'))
    const recover = vi.fn().mockResolvedValue(undefined)
    expect(handleStaleChunkRejection(event, recover)).toBe(true)
    expect(event.preventDefault).toHaveBeenCalled()
    expect(recover).toHaveBeenCalledTimes(1)
  })

  it('leaves other rejections alone', () => {
    const event = rejection(new Error('Something else'))
    const recover = vi.fn()
    expect(handleStaleChunkRejection(event, recover)).toBe(false)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(recover).not.toHaveBeenCalled()
  })

  it('lets it surface when a recovery already ran within the window', async () => {
    const handleStaleChunkRejection = await fresh()
    sessionStorage.setItem(STALE_CHUNK_KEY, String(Date.now()))
    const event = rejection(new TypeError('Failed to fetch dynamically imported module: /assets/x.js'))
    const recover = vi.fn()
    expect(handleStaleChunkRejection(event, recover)).toBe(false)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(recover).not.toHaveBeenCalled()
  })
})
