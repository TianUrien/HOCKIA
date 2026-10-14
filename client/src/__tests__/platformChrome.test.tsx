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

  it('BackGlyph draws the Material arrow on Android and the chevron elsewhere', async () => {
    const android = await load(null, 'android')
    const { container: a } = render(<android.BackGlyph className="h-6 w-6" />)
    expect(a.querySelector('svg')?.getAttribute('class')).toMatch(/lucide-arrow-left/)

    const ios = await load(null, 'ios')
    const { container: i } = render(<ios.BackGlyph className="h-6 w-6" />)
    expect(i.querySelector('svg')?.getAttribute('class')).toMatch(/lucide-chevron-left/)
  })
})
