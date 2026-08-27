import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Sentry JAVASCRIPT-REACT-C9 (2026-08-24, Pixel 6 Pro / WebView 95):
 * "OAuthCancelled" surfaced as an UNHANDLED rejection from the sign-in
 * button. signInWithOAuthNative creates `authPromise`, then awaits
 * Browser.open() BEFORE returning it — if the user taps again while the
 * Custom Tab is still opening, the newer attempt's cancelInFlight() rejects
 * the first promise while nobody has attached to it yet.
 *
 * Contract pinned here:
 *   - a second attempt supersedes the first: the first rejects with
 *     name === 'OAuthCancelled' once its caller awaits it;
 *   - that rejection is NEVER unhandled, even while Browser.open() is
 *     still pending (vitest fails the run on unhandled rejections).
 */
const m = vi.hoisted(() => ({
  openResolvers: [] as Array<() => void>,
  removed: 0,
}))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }))
vi.mock('@capacitor/browser', () => ({
  Browser: {
    open: vi.fn(() => new Promise<void>(r => { m.openResolvers.push(r) })),
    close: vi.fn(() => Promise.resolve()),
  },
}))
vi.mock('@capacitor/app', () => ({
  App: { addListener: vi.fn(() => Promise.resolve({ remove: () => { m.removed++ } })) },
}))
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { signInWithOAuth: vi.fn(() => Promise.resolve({ data: { url: 'https://auth.example/x' }, error: null })) } },
}))
vi.mock('@/lib/sentryHelpers', () => ({ reportAuthFlowError: vi.fn() }))
vi.mock('@sentry/react', () => ({ addBreadcrumb: vi.fn(), setTag: vi.fn() }))
vi.mock('@/lib/logger', () => ({ logger: { debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() } }))

import { signInWithOAuthNative } from '@/lib/nativeOAuth'

const tick = () => new Promise(r => setTimeout(r, 0))

describe('signInWithOAuthNative — superseding an in-flight attempt', () => {
  beforeEach(() => { m.openResolvers.length = 0; m.removed = 0 })

  it('second tap while the browser is still opening: first attempt rejects as OAuthCancelled, never unhandled', async () => {
    // Attempt A: gets its OAuth URL, is now awaiting Browser.open() (pending).
    const a = signInWithOAuthNative('apple')
    await tick(); await tick()
    expect(m.openResolvers).toHaveLength(1)

    // Attempt B taps in — cancels A while A is still inside Browser.open().
    const b = signInWithOAuthNative('apple')
    await tick(); await tick()
    expect(m.openResolvers).toHaveLength(2)

    // Let A's Browser.open() finish so A returns its (already rejected) promise.
    m.openResolvers[0]()
    await expect(a).rejects.toMatchObject({ name: 'OAuthCancelled' })
    expect(m.removed).toBe(1) // A's appUrlOpen listener was torn down

    // B is still live and waiting for its callback — not affected.
    let settled = false
    void b.then(() => { settled = true }, () => { settled = true })
    m.openResolvers[1](); await tick(); await tick()
    expect(settled).toBe(false)
  })
})
