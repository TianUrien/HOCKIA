import { beforeEach, describe, expect, it, vi } from 'vitest'

// Which Sentry SDK boots in which shell. Native (Capacitor iOS/Android) must
// go through @sentry/capacitor with the React SDK as its sibling so the
// native crash layer is installed; the web must keep calling @sentry/react
// directly. Both paths must carry the same release/environment/scrubbing.

const state = vi.hoisted(() => ({ native: false, platform: 'web' }))

const sentryReact = vi.hoisted(() => ({
  init: vi.fn(),
  setTag: vi.fn(),
  setTags: vi.fn(),
}))
const sentryCapacitor = vi.hoisted(() => ({
  init: vi.fn(),
  nativeCrash: vi.fn(),
}))

vi.mock('@sentry/react', () => sentryReact)
vi.mock('@sentry/capacitor', () => sentryCapacitor)
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => state.native,
    getPlatform: () => state.platform,
  },
}))
vi.mock('@/lib/appVersion', () => ({
  getAppVersion: vi.fn(async () => (state.native ? { version: '1.3.17', build: '28' } : null)),
}))
vi.mock('@/lib/sentryHelpers', () => ({ isNetworkFailureMessage: () => false }))
vi.mock('@/lib/sentryFilters', () => ({
  EXPECTED_REFUSAL_MESSAGES: ['This user is not available for messaging right now.'],
  isExpectedRefusal: () => false,
}))
vi.mock('@/lib/sentryScrub', () => ({
  scrubBreadcrumb: (crumb: unknown) => crumb,
  scrubEvent: (event: unknown) => event,
}))

async function freshInit() {
  vi.resetModules()
  return (await import('@/lib/sentryInit')).initSentry
}

beforeEach(() => {
  state.native = false
  state.platform = 'web'
  vi.clearAllMocks()
  delete window.__hockiaSentry
})

describe('initSentry — shell selection', () => {
  it('native: boots @sentry/capacitor with the React SDK as sibling and enableNative', async () => {
    state.native = true
    state.platform = 'ios'
    const initSentry = await freshInit()

    expect(initSentry()).toBe('native')
    expect(sentryCapacitor.init).toHaveBeenCalledTimes(1)
    const [options, siblingInit] = sentryCapacitor.init.mock.calls[0]
    expect(siblingInit).toBe(sentryReact.init)
    expect(options.enableNative).toBe(true)
    expect(options.enableNativeCrashHandling).toBe(true)
    // Replay is web-only (Apple 5.1.2); the Capacitor options must not carry it.
    expect(options).not.toHaveProperty('replaysSessionSampleRate')
    expect(options).not.toHaveProperty('replaysOnErrorSampleRate')
    // The sibling init is invoked BY the Capacitor SDK, never directly.
    expect(sentryReact.init).not.toHaveBeenCalled()
  })

  it('web: boots @sentry/react directly and never touches the Capacitor SDK', async () => {
    const initSentry = await freshInit()

    expect(initSentry()).toBe('web')
    expect(sentryReact.init).toHaveBeenCalledTimes(1)
    expect(sentryCapacitor.init).not.toHaveBeenCalled()
    const [options] = sentryReact.init.mock.calls[0]
    expect(options).not.toHaveProperty('enableNative')
    expect(options.replaysSessionSampleRate).toBeDefined()
    expect(options.replaysOnErrorSampleRate).toBe(1.0)
  })

  it('both shells share release, environment, filters and scrubbing hooks', async () => {
    const web = await freshInit()
    web()
    state.native = true
    state.platform = 'android'
    const native = await freshInit()
    native()

    const webOptions = sentryReact.init.mock.calls[0][0]
    const nativeOptions = sentryCapacitor.init.mock.calls[0][0]
    for (const options of [webOptions, nativeOptions]) {
      // Tests run outside production mode → development → reporting off, and
      // the native layer stays uninitialised too (the plugin honours enabled).
      expect(options.environment).toBe('development')
      expect(options.enabled).toBe(false)
      expect(options.release).toBe('dev')
      expect('dsn' in options).toBe(true)
      expect(options.ignoreErrors).toContain('This user is not available for messaging right now.')
      expect(typeof options.beforeSend).toBe('function')
      expect(typeof options.beforeBreadcrumb).toBe('function')
      expect(typeof options.beforeSendTransaction).toBe('function')
    }
  })
})

describe('initSentry — runtime tags', () => {
  it('tags the shell and, on native, the store version and build', async () => {
    state.native = true
    state.platform = 'ios'
    const initSentry = await freshInit()
    initSentry()

    expect(sentryReact.setTag).toHaveBeenCalledWith('platform', 'ios')
    await vi.waitFor(() =>
      expect(sentryReact.setTags).toHaveBeenCalledWith({ app_version: '1.3.17', app_build: '28' }),
    )
  })

  it('tags the web shell and sets no version tags', async () => {
    const initSentry = await freshInit()
    initSentry()
    await new Promise((r) => setTimeout(r, 10))

    expect(sentryReact.setTag).toHaveBeenCalledWith('platform', 'web')
    expect(sentryReact.setTags).not.toHaveBeenCalled()
  })
})

describe('initSentry — release-verification hooks', () => {
  it('are exposed on native only and route the crash to the Capacitor SDK', async () => {
    const initSentry = await freshInit()
    initSentry()
    expect(window.__hockiaSentry).toBeUndefined()

    state.native = true
    state.platform = 'ios'
    const nativeInit = await freshInit()
    nativeInit()
    expect(window.__hockiaSentry).toBeDefined()
    window.__hockiaSentry!.nativeCrash()
    expect(sentryCapacitor.nativeCrash).toHaveBeenCalledTimes(1)
  })
})
