/**
 * Release audit 2026-10-05 · the native version gate.
 *
 * Store builds carry the web bundle inside them, so `app_version_requirements`
 * is the only lever that retires an old build. Nothing tested the comparison or
 * the hook before this file: a wrong comparison either locks every native user
 * out ("Update required" on a current build) or never blocks an unsupported
 * one.
 */
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  native: true,
  platform: 'ios' as 'ios' | 'android' | 'web',
  info: { version: '1.3.15', build: '26' } as { version: string; build: string } | Error,
  row: { data: null as unknown, error: null as unknown },
  rowThrows: false,
  from: vi.fn(),
  eq: vi.fn(),
  browserOpen: vi.fn(),
  loggerError: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => h.native,
    getPlatform: () => h.platform,
  },
}))
vi.mock('@capacitor/app', () => ({
  App: {
    getInfo: async () => {
      if (h.info instanceof Error) throw h.info
      return h.info
    },
  },
}))
vi.mock('@capacitor/browser', () => ({ Browser: { open: (...a: unknown[]) => h.browserOpen(...a) } }))
vi.mock('@/lib/logger', () => ({ logger: { error: (...a: unknown[]) => h.loggerError(...a), debug: vi.fn(), warn: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/bottomPrompt', () => ({ useBottomPrompt: vi.fn() }))
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      h.from(table)
      return {
        select: () => ({
          eq: (column: string, value: string) => {
            h.eq(column, value)
            return {
              maybeSingle: async () => {
                if (h.rowThrows) throw new Error('network down')
                return h.row
              },
            }
          },
        }),
      }
    },
  },
}))

import { compareVersions, getAppVersion, getStoreUrl } from '@/lib/appVersion'
import { useAppUpdateCheck } from '@/hooks/useAppUpdateCheck'
import NativeUpdatePrompt from '@/components/NativeUpdatePrompt'

const IOS_STORE = 'https://apps.apple.com/app/hockia/id6760937891'
const ANDROID_STORE = 'https://play.google.com/store/apps/details?id=com.inhockia.app'

function requirements(min: string, latest: string, storeUrl: string | null = null) {
  h.row = { data: { min_version: min, latest_version: latest, store_url: storeUrl }, error: null }
}

/** Let the hook's async check settle (version read → query → setState). */
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
  })
}

beforeEach(() => {
  h.native = true
  h.platform = 'ios'
  h.info = { version: '1.3.15', build: '26' }
  h.row = { data: null, error: null }
  h.rowThrows = false
  h.from.mockClear()
  h.eq.mockClear()
  h.browserOpen.mockClear()
  h.loggerError.mockClear()
  localStorage.clear()
})

describe('compareVersions', () => {
  it('compares segment by segment as numbers, not as text', () => {
    // The trap: "1.3.9" > "1.3.15" as strings. Live versions are 1.3.15 (iOS) and 1.16 (Android).
    expect(compareVersions('1.3.9', '1.3.15')).toBe(-1)
    expect(compareVersions('1.3.15', '1.3.9')).toBe(1)
    expect(compareVersions('1.9', '1.16')).toBe(-1)
    expect(compareVersions('1.16', '1.9')).toBe(1)
    expect(compareVersions('2.0.0', '1.99.99')).toBe(1)
    expect(compareVersions('1.3.15', '1.3.15')).toBe(0)
  })

  it('treats a missing segment as zero, in either position', () => {
    expect(compareVersions('1.16', '1.16.0')).toBe(0)
    expect(compareVersions('1.16.0.0', '1.16')).toBe(0)
    expect(compareVersions('1.16', '1.16.1')).toBe(-1)
    expect(compareVersions('1.16.1', '1.16')).toBe(1)
    expect(compareVersions('2', '1.99')).toBe(1)
  })

  it('never returns NaN or throws on text that is not a clean version', () => {
    for (const [a, b] of [['', ''], ['', '1.0'], ['abc', '1.0'], ['1..2', '1.0.2'], ['1.3.15-beta', '1.3.15'], [' 1.3.15 ', '1.3.15']] as const) {
      const out = compareVersions(a, b)
      expect([-1, 0, 1], `${JSON.stringify(a)} vs ${JSON.stringify(b)}`).toContain(out)
    }
    // An empty installed version counts as 0: it is below any real minimum.
    expect(compareVersions('', '1.0')).toBe(-1)
    // A pre-release suffix on the patch segment does not lower it.
    expect(compareVersions('1.3.15-beta', '1.3.15')).toBe(0)
  })

  it('is antisymmetric (swapping the sides flips the sign)', () => {
    const versions = ['0.9', '1.0', '1.3.9', '1.3.15', '1.16', '1.16.1', '2']
    for (const a of versions) {
      for (const b of versions) {
        expect(compareVersions(a, b), `${a} vs ${b}`).toBe(-compareVersions(b, a) || 0)
      }
    }
  })
})

describe('getAppVersion / getStoreUrl', () => {
  it('web and PWA have no bundled version (always served fresh)', async () => {
    h.native = false
    expect(await getAppVersion()).toBeNull()
  })

  it('a failing native bridge yields null instead of throwing', async () => {
    h.info = new Error('plugin not implemented')
    expect(await getAppVersion()).toBeNull()
  })

  it('points each platform at its own store listing', () => {
    h.platform = 'ios'
    expect(getStoreUrl()).toBe(IOS_STORE)
    h.platform = 'android'
    expect(getStoreUrl()).toBe(ANDROID_STORE)
  })
})

describe('useAppUpdateCheck', () => {
  it('web: never asks the server and never prompts', async () => {
    h.native = false
    requirements('99.0.0', '99.0.0')
    const { result } = renderHook(() => useAppUpdateCheck())
    await settle()
    expect(h.from).not.toHaveBeenCalled()
    expect(result.current.status).toBe('ok')
  })

  it('reads the requirement row of its OWN platform', async () => {
    h.platform = 'android'
    h.info = { version: '1.16', build: '18' }
    requirements('1.16', '1.16')
    renderHook(() => useAppUpdateCheck())
    await settle()
    expect(h.from).toHaveBeenCalledWith('app_version_requirements')
    expect(h.eq).toHaveBeenCalledWith('platform', 'android')
  })

  it('installed below min_version → force', async () => {
    requirements('1.3.16', '1.3.16')
    const { result } = renderHook(() => useAppUpdateCheck())
    await waitFor(() => expect(result.current.status).toBe('force'), { timeout: 5000 })
  })

  it('installed equal to min_version is NOT forced (the boundary build stays usable)', async () => {
    requirements('1.3.15', '1.3.15')
    const { result } = renderHook(() => useAppUpdateCheck())
    await settle()
    expect(result.current.status).toBe('ok')
  })

  it('at or above min but below latest → soft', async () => {
    requirements('1.3.9', '1.4.0')
    const { result } = renderHook(() => useAppUpdateCheck())
    await waitFor(() => expect(result.current.status).toBe('soft'), { timeout: 5000 })
  })

  it('force wins when the build is below both', async () => {
    requirements('1.4.0', '1.5.0')
    const { result } = renderHook(() => useAppUpdateCheck())
    await waitFor(() => expect(result.current.status).toBe('force'), { timeout: 5000 })
  })

  it('a build newer than latest_version (store review build) is ok', async () => {
    h.info = { version: '1.4.1', build: '30' }
    requirements('1.3.9', '1.4.0')
    const { result } = renderHook(() => useAppUpdateCheck())
    await settle()
    expect(result.current.status).toBe('ok')
  })

  it('uses the row store_url when set, else the built-in listing', async () => {
    requirements('2.0.0', '2.0.0', 'https://example.test/store')
    const first = renderHook(() => useAppUpdateCheck())
    await waitFor(() => expect(first.result.current.status).toBe('force'))
    expect(first.result.current.storeUrl).toBe('https://example.test/store')

    requirements('2.0.0', '2.0.0', null)
    const second = renderHook(() => useAppUpdateCheck())
    await waitFor(() => expect(second.result.current.status).toBe('force'))
    expect(second.result.current.storeUrl).toBe(IOS_STORE)
  })

  // The gate FAILS OPEN by design: an outage must not lock people out of the
  // app. The cost is stated here so nobody relies on min_version as a security
  // control: a build that cannot read the row is never blocked.
  it('fails open: query error, missing row, thrown error and unreadable version all leave it ok', async () => {
    h.row = { data: null, error: { message: 'permission denied' } }
    const a = renderHook(() => useAppUpdateCheck())
    await settle()
    expect(a.result.current.status).toBe('ok')

    h.row = { data: null, error: null }
    const b = renderHook(() => useAppUpdateCheck())
    await settle()
    expect(b.result.current.status).toBe('ok')

    h.rowThrows = true
    const c = renderHook(() => useAppUpdateCheck())
    await settle()
    expect(c.result.current.status).toBe('ok')
    expect(h.loggerError).toHaveBeenCalled()
    h.rowThrows = false

    h.info = new Error('bridge down')
    requirements('99.0.0', '99.0.0')
    h.from.mockClear()
    const d = renderHook(() => useAppUpdateCheck())
    await settle()
    expect(d.result.current.status).toBe('ok')
    expect(h.from).not.toHaveBeenCalled()
  })

  it('a row with a NULL min_version does not crash the app; it is logged and treated as ok', async () => {
    h.row = { data: { min_version: null, latest_version: '9.9.9', store_url: null }, error: null }
    const { result } = renderHook(() => useAppUpdateCheck())
    await settle()
    expect(result.current.status).toBe('ok')
    expect(h.loggerError).toHaveBeenCalled()
  })
})

describe('NativeUpdatePrompt', () => {
  it('force: a blocking "Update required" with no way to dismiss, and the button opens the store', async () => {
    requirements('9.0.0', '9.0.0')
    render(<NativeUpdatePrompt />)
    expect(await screen.findByText('Update required')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument()
    screen.getByRole('button', { name: /Update HOCKIA/ }).click()
    expect(h.browserOpen).toHaveBeenCalledWith({ url: IOS_STORE })
  })

  it('force ignores an earlier soft dismissal', async () => {
    localStorage.setItem('native-update-prompt-dismissed-at', Date.now().toString())
    requirements('9.0.0', '9.0.0')
    render(<NativeUpdatePrompt />)
    expect(await screen.findByText('Update required')).toBeInTheDocument()
  })

  it('soft: dismissible, and a dismissal is remembered for a day, not for ever', async () => {
    requirements('1.0.0', '9.0.0')
    const first = render(<NativeUpdatePrompt />)
    const dismiss = await screen.findByRole('button', { name: 'Dismiss' }, { timeout: 5000 })
    expect(screen.queryByText('Update required')).not.toBeInTheDocument()
    act(() => dismiss.click())
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument()
    first.unmount()

    // Same day: stays hidden.
    const second = render(<NativeUpdatePrompt />)
    await settle()
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument()
    second.unmount()

    // 25 hours later: shown again.
    localStorage.setItem('native-update-prompt-dismissed-at', (Date.now() - 25 * 60 * 60 * 1000).toString())
    render(<NativeUpdatePrompt />)
    expect(await screen.findByRole('button', { name: 'Dismiss' }, { timeout: 5000 })).toBeInTheDocument()
  })

  it('ok: renders nothing', async () => {
    requirements('1.0.0', '1.0.0')
    const { container } = render(<NativeUpdatePrompt />)
    await settle()
    expect(container).toBeEmptyDOMElement()
  })
})
