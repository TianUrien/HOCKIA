import { describe, it, expect, vi } from 'vitest'

/**
 * Tests for usePushSubscription dual-path detection.
 *
 * The hook supports two push notification paths:
 * 1. Web Push (VAPID) — for browsers with service workers
 * 2. Native FCM — for Capacitor iOS/Android apps
 *
 * We test the platform detection logic rather than the full hook
 * (which requires React rendering and async side effects).
 */

describe('Push subscription platform detection', () => {
  it('detects iOS platform from user agent', async () => {
    const { detectPlatform } = await import('@/lib/detectPlatform')

    const originalUA = navigator.userAgent
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      configurable: true,
    })

    expect(detectPlatform()).toBe('ios')

    Object.defineProperty(navigator, 'userAgent', { value: originalUA, configurable: true })
  })

  it('detects Android platform from user agent', async () => {
    const { detectPlatform } = await import('@/lib/detectPlatform')

    const originalUA = navigator.userAgent
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Linux; Android 14; Pixel 8)',
      configurable: true,
    })

    expect(detectPlatform()).toBe('android')

    Object.defineProperty(navigator, 'userAgent', { value: originalUA, configurable: true })
  })

  it('detects desktop platform from standard user agent', async () => {
    const { detectPlatform } = await import('@/lib/detectPlatform')

    const originalUA = navigator.userAgent
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      configurable: true,
    })

    expect(detectPlatform()).toBe('desktop')

    Object.defineProperty(navigator, 'userAgent', { value: originalUA, configurable: true })
  })

  it('Capacitor.isNativePlatform returns false in test environment', async () => {
    const { Capacitor } = await import('@capacitor/core')
    expect(Capacitor.isNativePlatform()).toBe(false)
  })

  it('web push support requires VAPID key, PushManager, and service worker', () => {
    // In jsdom test environment, these are not available
    const hasServiceWorker = 'serviceWorker' in navigator
    const hasPushManager = 'PushManager' in window

    // VAPID key comes from env — not set in test
    const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY

    // In test environment, web push should not be "supported"
    const isWebPushSupported = hasServiceWorker && hasPushManager && !!vapidKey
    expect(isWebPushSupported).toBe(false)
  })
})
