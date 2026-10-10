/**
 * Arrivals from Instagram / Facebook (in-app browsers).
 *
 * Contract:
 * - No warning on arrival: the landing, log-in and sign-up pages render no
 *   in-app banner (the old amber "may have trouble with login" bar is gone).
 * - Google is the only provider that cannot finish inside a webview (Google
 *   blocks embedded user agents), so tapping it there shows the calm
 *   "Continue with Google in Safari / Chrome" panel and never starts OAuth.
 * - Apple and email keep working in place.
 * - The hand-off URL keeps the destination, including one stashed only in
 *   this webview's sessionStorage (club invites).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

const mocks = vi.hoisted(() => ({
  startOAuthSignIn: vi.fn(() => Promise.resolve()),
  trackEvent: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }))
vi.mock('@/lib/oauthSignIn', () => ({ startOAuthSignIn: mocks.startOAuthSignIn }))
vi.mock('@/lib/analytics', () => ({
  trackLogin: vi.fn(),
  trackSignUpStart: vi.fn(),
  trackEvent: mocks.trackEvent,
}))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), debug: vi.fn() } }))

import { OAuthButtons } from '@/components/auth/OAuthButtons'
import {
  detectInAppBrowser,
  externalBrowserUrl,
  getExternalBrowserInstructions,
  handoffHref,
  supportsOAuthProvider,
} from '@/lib/inAppBrowser'

const UA = {
  instagramIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22F76 Instagram 389.0.0.29.87 (iPhone15,3; iOS 18_5; en_US; en; scale=3.00; 1290x2796; 762306041)',
  facebookIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22F76 [FBAN/FBIOS;FBAV/520.0.0.38.101;FBBV/750000000;FBDV/iPhone15,3;FBMD/iPhone;FBSN/iOS;FBSV/18.5;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5;FBRV/0]',
  instagramAndroid:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/128.0.6613.127 Mobile Safari/537.36 Instagram 389.0.0.49.87 Android (34/14; 420dpi; 1080x2400; Google/google; Pixel 8; shiba; shiba; en_US; 762306041)',
  facebookAndroid:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A.240805.005; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/128.0.6613.127 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/480.0.0.58.82;]',
  safariIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  chromeAndroid:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
}

const realUa = navigator.userAgent
function setUa(ua: string) {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true })
}

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia
  sessionStorage.clear()
  mocks.startOAuthSignIn.mockClear()
  mocks.trackEvent.mockClear()
})
afterEach(() => setUa(realUa))

describe('detection', () => {
  it.each([
    ['instagramIos', 'Instagram'],
    ['facebookIos', 'Facebook'],
    ['instagramAndroid', 'Instagram'],
    ['facebookAndroid', 'Facebook'],
  ] as const)('%s → %s in-app browser', (key, name) => {
    setUa(UA[key])
    expect(detectInAppBrowser()).toMatchObject({ isInAppBrowser: true, browserName: name })
  })

  it.each(['safariIos', 'chromeAndroid'] as const)('%s is a real browser', (key) => {
    setUa(UA[key])
    expect(detectInAppBrowser().isInAppBrowser).toBe(false)
  })
})

describe('providers inside Meta in-app browsers', () => {
  it('Google needs the system browser; Apple works in place', () => {
    setUa(UA.instagramIos)
    expect(supportsOAuthProvider('google')).toBe(false)
    expect(supportsOAuthProvider('apple')).toBe(true)
    setUa(UA.safariIos)
    expect(supportsOAuthProvider('google')).toBe(true)
  })

  it('tapping Google shows the hand-off panel and never starts OAuth', () => {
    setUa(UA.instagramIos)
    render(<OAuthButtons intent="signup" onError={vi.fn()} />)
    expect(screen.queryByRole('status')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }))
    expect(mocks.startOAuthSignIn).not.toHaveBeenCalled()
    expect(screen.getByText('Continue with Google in Safari')).toBeInTheDocument()
    expect(screen.getByText(/Instagram doesn’t allow Google sign-in inside the app/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open in Safari' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /copy link/i })).toBeInTheDocument()
    expect(screen.getByText(/Open in external browser/)).toBeInTheDocument()
  })

  it('Android Facebook offers Chrome', () => {
    setUa(UA.facebookAndroid)
    render(<OAuthButtons intent="signin" onError={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }))
    expect(screen.getByRole('button', { name: 'Open in Chrome' })).toBeInTheDocument()
    expect(screen.getByText(/Tap ⋮ at the top right/)).toBeInTheDocument()
  })

  it('tapping Apple inside Instagram starts the Apple round-trip', () => {
    setUa(UA.instagramIos)
    render(<OAuthButtons intent="signup" onError={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /continue with apple/i }))
    expect(mocks.startOAuthSignIn).toHaveBeenCalledWith('apple')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('a real browser starts Google directly', () => {
    setUa(UA.safariIos)
    render(<OAuthButtons intent="signup" onError={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }))
    expect(mocks.startOAuthSignIn).toHaveBeenCalledWith('google')
  })
})

describe('hand-off URL', () => {
  it('keeps the path and ?next=, drops the fragment', () => {
    expect(handoffHref({ href: 'https://inhockia.com/signup?next=%2Fopportunities%2Fabc#x' })).toBe(
      'https://inhockia.com/signup?next=%2Fopportunities%2Fabc',
    )
  })

  it('carries a destination stashed only in this webview (club invite)', () => {
    sessionStorage.setItem('hockia-redirect-after-login', '/invite/club/tok123')
    expect(handoffHref({ href: 'https://inhockia.com/signup' })).toBe(
      'https://inhockia.com/signup?next=%2Finvite%2Fclub%2Ftok123',
    )
  })

  it('never carries an unsafe stashed destination', () => {
    sessionStorage.setItem('hockia-redirect-after-login', '//evil.example')
    expect(handoffHref({ href: 'https://inhockia.com/signup' })).toBe('https://inhockia.com/signup')
  })

  it('builds the platform hand-off links', () => {
    const href = 'https://inhockia.com/signup?next=%2Fx'
    expect(externalBrowserUrl(href, 'android')).toBe(
      'intent://inhockia.com/signup?next=%2Fx#Intent;scheme=https;action=android.intent.action.VIEW;end',
    )
    expect(externalBrowserUrl(href, 'ios')).toBe('x-safari-https://inhockia.com/signup?next=%2Fx')
    expect(externalBrowserUrl(href, 'other')).toBeNull()
    expect(externalBrowserUrl('javascript:alert(1)', 'ios')).toBeNull()
  })

  it('names the menu item the Meta apps use', () => {
    setUa(UA.instagramIos)
    expect(getExternalBrowserInstructions('Instagram')).toBe('Tap ⋯ at the top right, then “Open in external browser”.')
  })
})
