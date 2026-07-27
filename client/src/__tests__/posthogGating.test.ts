import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// PostHog must NEVER send before consent, on automated browsers, or on
// native. These gates are the privacy/data-quality contract — if they
// regress, we leak to a third party or drown real users in bot traffic.

const state = vi.hoisted(() => ({
  consent: 'accepted' as 'accepted' | 'declined' | null,
  native: false,
  initCalls: 0,
  captures: [] as Array<{ event: string; props?: Record<string, unknown> }>,
  identifies: [] as Array<{ id: string; props?: Record<string, unknown> }>,
}))

vi.mock('@/lib/cookieConsent', () => ({
  hasAnalyticsConsent: () => state.consent === 'accepted',
  getConsentStatus: () => state.consent,
}))
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => state.native },
}))
vi.mock('@/lib/analyticsIdentity', () => ({ getAnonymousId: () => 'anon-test' }))
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), error: vi.fn() } }))
// Models the real SDK shape: the DEFAULT EXPORT is itself the client
// (posthog.capture(...) works off the module object), and init() invokes
// `loaded` with that same object.
vi.mock('posthog-js', () => {
  const fake = {
    init: (_key: string, opts: { loaded?: (ph: unknown) => void }) => {
      state.initCalls += 1
      opts.loaded?.(fake)
      return fake
    },
    capture: (event: string, props?: Record<string, unknown>) =>
      state.captures.push({ event, props }),
    identify: (id: string, props?: Record<string, unknown>) => state.identifies.push({ id, props }),
    reset: vi.fn(),
    getFeatureFlag: () => 'variant-b',
  }
  return { default: fake }
})

async function freshModule() {
  vi.resetModules()
  return await import('@/lib/posthog')
}

beforeEach(() => {
  state.consent = 'accepted'
  state.native = false
  state.initCalls = 0
  state.captures = []
  state.identifies = []
  Object.defineProperty(window.navigator, 'webdriver', { value: false, configurable: true })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('PostHog gating', () => {
  it('initialises when consent is granted on web', async () => {
    const ph = await freshModule()
    ph.initPostHog()
    await vi.waitFor(() => expect(state.initCalls).toBe(1))
  })

  it('does NOT initialise without consent', async () => {
    state.consent = null
    const ph = await freshModule()
    ph.initPostHog()
    await new Promise((r) => setTimeout(r, 20))
    expect(state.initCalls).toBe(0)
  })

  it('does NOT initialise when consent is declined', async () => {
    state.consent = 'declined'
    const ph = await freshModule()
    ph.initPostHog()
    await new Promise((r) => setTimeout(r, 20))
    expect(state.initCalls).toBe(0)
  })

  it('does NOT initialise on automated browsers (E2E bot traffic)', async () => {
    Object.defineProperty(window.navigator, 'webdriver', { value: true, configurable: true })
    const ph = await freshModule()
    ph.initPostHog()
    await new Promise((r) => setTimeout(r, 20))
    expect(state.initCalls).toBe(0)
  })

  it('does NOT initialise on native (web-only for now)', async () => {
    state.native = true
    const ph = await freshModule()
    ph.initPostHog()
    await new Promise((r) => setTimeout(r, 20))
    expect(state.initCalls).toBe(0)
  })

  it('is idempotent — repeated init calls load once', async () => {
    const ph = await freshModule()
    ph.initPostHog()
    await vi.waitFor(() => expect(state.initCalls).toBe(1))
    ph.initPostHog()
    ph.initPostHog()
    await new Promise((r) => setTimeout(r, 20))
    expect(state.initCalls).toBe(1)
  })
})

describe('PostHog capture', () => {
  it('mirrors events once initialised', async () => {
    const ph = await freshModule()
    ph.initPostHog()
    await vi.waitFor(() => expect(state.initCalls).toBe(1))
    ph.phCapture('login_wall_shown', { action: 'apply_opportunity' })
    expect(state.captures).toEqual([
      { event: 'login_wall_shown', props: { action: 'apply_opportunity' } },
    ])
  })

  it('silently drops events when not consented (never throws)', async () => {
    state.consent = null
    const ph = await freshModule()
    expect(() => ph.phCapture('login_wall_shown')).not.toThrow()
    expect(state.captures).toHaveLength(0)
  })
})

describe('PostHog identify — idempotency', () => {
  // QA 2026-07-27: two $identify events landed per sign-in because the profile
  // fetch can run more than once. identify() is meant to be called once.
  it('identifies a user once, then drops repeats', async () => {
    const ph = await freshModule()
    ph.initPostHog()
    await vi.waitFor(() => expect(state.initCalls).toBe(1))

    ph.phIdentify('user-1', { role: 'coach' })
    ph.phIdentify('user-1', { role: 'coach' })
    ph.phIdentify('user-1')
    expect(state.identifies).toEqual([{ id: 'user-1', props: { role: 'coach' } }])
  })

  it('identifies a different user after reset (shared browser)', async () => {
    const ph = await freshModule()
    ph.initPostHog()
    await vi.waitFor(() => expect(state.initCalls).toBe(1))

    ph.phIdentify('user-1', { role: 'coach' })
    ph.phReset()
    ph.phIdentify('user-2', { role: 'player' })
    expect(state.identifies.map((i) => i.id)).toEqual(['user-1', 'user-2'])
  })
})

describe('PostHog experiments', () => {
  it('returns null for variants when unavailable, so callers show control', async () => {
    state.consent = null
    const ph = await freshModule()
    expect(ph.phVariant('landing-redesign')).toBeNull()
  })

  it('returns the assigned variant once loaded', async () => {
    const ph = await freshModule()
    ph.initPostHog()
    await vi.waitFor(() => expect(state.initCalls).toBe(1))
    expect(ph.phVariant('landing-redesign')).toBe('variant-b')
  })
})
