/**
 * detectInAppBrowser — pins the contract that the Capacitor native shell
 * (iOS/Android) is NOT treated as an in-app browser, even though its WebView
 * UA includes "; wv)" / WKWebView patterns we use to spot Instagram, FB, etc.
 *
 * Background: Vincent (Android Closed Testing) saw the "open in Safari or
 * Chrome" warning *inside our own app downloaded from Play Store*. Pre-fix,
 * the Android WebView UA matched the generic-WebView pattern. We now bail
 * out for native-platform contexts the same way we already bail out for
 * standalone PWAs.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const capacitorMock = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => false),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: capacitorMock,
}))

import { detectInAppBrowser } from '@/lib/inAppBrowser'

const ANDROID_WEBVIEW_UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 6 Build/TQ3A.230805.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0.0.0 Mobile Safari/537.36'
const ANDROID_CHROME_UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36'
const INSTAGRAM_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21A329 Instagram 305.0.0.0'

function setUserAgent(ua: string) {
  Object.defineProperty(navigator, 'userAgent', {
    value: ua,
    configurable: true,
  })
}

describe('detectInAppBrowser — Capacitor-native bail-out', () => {
  beforeEach(() => {
    capacitorMock.isNativePlatform.mockReset()
    capacitorMock.isNativePlatform.mockReturnValue(false)
  })

  afterEach(() => {
    // Restore a plausible default so other tests don't inherit a weird UA.
    setUserAgent(ANDROID_CHROME_UA)
  })

  it('returns isInAppBrowser=false when running inside the Capacitor native app, even with a WebView UA', () => {
    capacitorMock.isNativePlatform.mockReturnValue(true)
    setUserAgent(ANDROID_WEBVIEW_UA)

    const result = detectInAppBrowser()
    expect(result.isInAppBrowser).toBe(false)
    expect(result.browserName).toBeNull()
  })

  it('returns isInAppBrowser=false for native even if the UA looks like Instagram (defensive — native always trusted)', () => {
    capacitorMock.isNativePlatform.mockReturnValue(true)
    setUserAgent(INSTAGRAM_UA)

    expect(detectInAppBrowser().isInAppBrowser).toBe(false)
  })

  it('still flags the bare Android WebView UA when NOT running inside the Capacitor app (preserves the original detection purpose)', () => {
    capacitorMock.isNativePlatform.mockReturnValue(false)
    setUserAgent(ANDROID_WEBVIEW_UA)

    const result = detectInAppBrowser()
    expect(result.isInAppBrowser).toBe(true)
    expect(result.browserName).toBe('WebView')
  })

  it('still flags Instagram in-app browser when not in the native shell', () => {
    capacitorMock.isNativePlatform.mockReturnValue(false)
    setUserAgent(INSTAGRAM_UA)

    const result = detectInAppBrowser()
    expect(result.isInAppBrowser).toBe(true)
    expect(result.browserName).toBe('Instagram')
  })

  it('returns isInAppBrowser=false for regular Chrome on Android (no false positives)', () => {
    capacitorMock.isNativePlatform.mockReturnValue(false)
    setUserAgent(ANDROID_CHROME_UA)

    expect(detectInAppBrowser().isInAppBrowser).toBe(false)
  })
})
