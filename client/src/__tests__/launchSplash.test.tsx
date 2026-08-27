import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Native launch-splash hand-off (01-E artwork, 2026-08-21).
 *
 * Contract: the native splash (launchAutoHide:false) is released ONLY when the
 * web app has a real first frame — never on a timer. Two reporters:
 *   NativeLaunchSplash  → when its identical artwork has decoded
 *   LaunchSplashController → immediately, when the first commit has no splash
 * Plus a failsafe that fires only if neither reported (broken image), so a
 * user can never be trapped behind the native layer.
 */
const m = vi.hoisted(() => ({
  native: true,
  hide: vi.fn(() => Promise.resolve()),
}))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => m.native } }))
vi.mock('@capacitor/splash-screen', () => ({ SplashScreen: { hide: m.hide } }))

import { hideNativeSplash, armLaunchSplashFailsafe, warmLaunchArtwork, LAUNCH_ARTWORK_URL, __resetLaunchSplashForTests } from '@/lib/launchSplash'
import NativeLaunchSplash from '@/components/NativeLaunchSplash'
import LaunchSplashController from '@/components/LaunchSplashController'

const flushFrames = () => act(() => { vi.advanceTimersByTime(50) })

describe('launch splash hand-off', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame'] })
    m.native = true
    m.hide.mockClear()
    __resetLaunchSplashForTests()
  })
  afterEach(() => { vi.useRealTimers() })

  it('hides the native splash exactly once, after two frames, with no fade', () => {
    hideNativeSplash()
    expect(m.hide).not.toHaveBeenCalled() // waits for the committed DOM to paint
    flushFrames()
    hideNativeSplash(); hideNativeSplash()
    flushFrames()
    expect(m.hide).toHaveBeenCalledTimes(1)
    expect(m.hide).toHaveBeenCalledWith({ fadeOutDuration: 0 })
  })

  it('is a no-op on the web', () => {
    m.native = false
    hideNativeSplash(); flushFrames()
    expect(m.hide).not.toHaveBeenCalled()
  })

  it('NativeLaunchSplash: the artwork decoding is what releases the native splash', () => {
    render(<NativeLaunchSplash />)
    const img = screen.getByTestId('native-launch-splash').querySelector('img')!
    expect(img.getAttribute('src')).toBe('/native/launch-editorial.webp')
    flushFrames()
    expect(m.hide).not.toHaveBeenCalled() // not before the image is ready
    fireEvent.load(img); flushFrames()
    expect(m.hide).toHaveBeenCalledTimes(1)
  })

  it('NativeLaunchSplash: waits for the bitmap to DECODE, not just load (no flat-colour frame)', async () => {
    let resolveDecode!: () => void
    const decode = vi.fn(() => new Promise<void>(r => { resolveDecode = r }))
    Object.defineProperty(HTMLImageElement.prototype, 'decode', { value: decode, configurable: true })
    try {
      render(<NativeLaunchSplash />)
      const img = screen.getByTestId('native-launch-splash').querySelector('img')!
      expect(img.getAttribute('decoding')).toBe('sync')
      fireEvent.load(img); flushFrames()
      expect(decode).toHaveBeenCalledTimes(1)
      expect(m.hide).not.toHaveBeenCalled() // bytes loaded, bitmap not ready → still native
      await act(async () => { resolveDecode(); await Promise.resolve() })
      flushFrames()
      expect(m.hide).toHaveBeenCalledTimes(1)
    } finally {
      delete (HTMLImageElement.prototype as unknown as Record<string, unknown>).decode
    }
  })

  it('NativeLaunchSplash: a broken image still releases (never trap the user)', () => {
    render(<NativeLaunchSplash />)
    fireEvent.error(screen.getByTestId('native-launch-splash').querySelector('img')!)
    flushFrames()
    expect(m.hide).toHaveBeenCalledTimes(1)
  })

  it('controller: first frame WITHOUT a splash → release immediately', () => {
    render(<div><LaunchSplashController /></div>)
    flushFrames()
    expect(m.hide).toHaveBeenCalledTimes(1)
  })

  it('controller: first frame WITH the splash → defer to the splash, do not release', () => {
    render(<div><NativeLaunchSplash /><LaunchSplashController /></div>)
    flushFrames()
    expect(m.hide).not.toHaveBeenCalled()
  })

  it('warm-up: native pre-fetches AND decodes the artwork once; web does nothing', () => {
    const decode = vi.fn(() => Promise.resolve())
    Object.defineProperty(HTMLImageElement.prototype, 'decode', { value: decode, configurable: true })
    const srcs: string[] = []
    const desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')!
    Object.defineProperty(HTMLImageElement.prototype, 'src', { configurable: true, get: desc.get, set(v: string) { srcs.push(v); desc.set!.call(this, v) } })
    try {
      warmLaunchArtwork(); warmLaunchArtwork()
      expect(srcs).toEqual([LAUNCH_ARTWORK_URL])
      expect(decode).toHaveBeenCalledTimes(1)
      __resetLaunchSplashForTests(); m.native = false
      warmLaunchArtwork()
      expect(srcs).toHaveLength(1)
    } finally {
      Object.defineProperty(HTMLImageElement.prototype, 'src', desc)
      delete (HTMLImageElement.prototype as unknown as Record<string, unknown>).decode
    }
  })

  it('failsafe fires only when nothing reported, at 4s — never on a healthy launch', () => {
    armLaunchSplashFailsafe()
    act(() => { vi.advanceTimersByTime(3999) })
    expect(m.hide).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(1) }); flushFrames()
    expect(m.hide).toHaveBeenCalledTimes(1)
  })

  it('failsafe is cancelled by a normal release (no double hide)', () => {
    armLaunchSplashFailsafe()
    hideNativeSplash(); flushFrames()
    act(() => { vi.advanceTimersByTime(5000) }); flushFrames()
    expect(m.hide).toHaveBeenCalledTimes(1)
  })
})
