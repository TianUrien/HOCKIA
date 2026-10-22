import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

async function load(override: 'android' | 'ios' | null, platform: 'ios' | 'android' | 'web') {
  vi.resetModules()
  vi.doMock('@capacitor/core', () => ({
    Capacitor: { isNativePlatform: () => platform !== 'web', getPlatform: () => platform },
  }))
  if (override) window.localStorage.setItem('hockia-chrome', override)
  else window.localStorage.removeItem('hockia-chrome')
  const chrome = await import('@/lib/platformChrome')
  const glyph = await import('@/components/ui/BackGlyph')
  return { ...chrome, ...glyph }
}

afterEach(() => {
  window.localStorage.removeItem('hockia-chrome')
  vi.doUnmock('@capacitor/core')
})

describe('platform chrome', () => {
  it('is Android only inside the Android app', async () => {
    expect((await load(null, 'android')).ANDROID_CHROME).toBe(true)
    expect((await load(null, 'ios')).ANDROID_CHROME).toBe(false)
    expect((await load(null, 'web')).ANDROID_CHROME).toBe(false)
  })

  it('honours the preview override both ways', async () => {
    expect((await load('android', 'web')).ANDROID_CHROME).toBe(true)
    expect((await load('ios', 'android')).ANDROID_CHROME).toBe(false)
  })

  // The glyph is checked without resetting modules: re-importing BackGlyph
  // after vi.resetModules sometimes still bound the pre-reset platformChrome
  // under load (flaked in CI on PR 396 and the 2026-10-22 release), so the
  // platform decision above and the drawing below are tested separately.
  it('BackGlyph draws the Material arrow for Android chrome and the chevron for iOS', async () => {
    const { BackGlyph } = await import('@/components/ui/BackGlyph')
    const { container: a } = render(<BackGlyph chrome="android" className="h-6 w-6" />)
    expect(a.querySelector('svg')?.getAttribute('class')).toMatch(/lucide-arrow-left/)
    const { container: i } = render(<BackGlyph chrome="ios" className="h-6 w-6" />)
    expect(i.querySelector('svg')?.getAttribute('class')).toMatch(/lucide-chevron-left/)
  })

  it('BackGlyph follows the app chrome by default', async () => {
    const { BackGlyph } = await import('@/components/ui/BackGlyph')
    const { ANDROID_CHROME } = await import('@/lib/platformChrome')
    const { container } = render(<BackGlyph className="h-6 w-6" />)
    expect(container.querySelector('svg')?.getAttribute('class')).toMatch(ANDROID_CHROME ? /lucide-arrow-left/ : /lucide-chevron-left/)
  })
})
