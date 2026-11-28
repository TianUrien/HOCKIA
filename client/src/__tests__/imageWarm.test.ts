import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetImageWarm, loadedVariant, preloadUrl, rememberLoaded, warmUploadedPhoto } from '@/lib/imageWarm'

const RAW = 'https://x.supabase.co/storage/v1/object/public/gallery/u/1.jpg'

describe('imageWarm (Community photos, 2026-11-28)', () => {
  beforeEach(() => __resetImageWarm())
  afterEach(() => vi.unstubAllGlobals())

  it('remembers the exact variant the grid decoded', () => {
    expect(loadedVariant(RAW)).toBeNull()
    rememberLoaded(RAW, 'https://x.supabase.co/storage/v1/render/image/public/gallery/u/1.jpg?width=400')
    expect(loadedVariant(RAW)).toContain('width=400')
    rememberLoaded(null, 'x')
    expect(loadedVariant(null)).toBeNull()
  })

  it('preloads a URL only once', () => {
    const made: string[] = []
    class FakeImage { decoding = ''; set src(v: string) { made.push(v) } decode() { return Promise.resolve() } }
    vi.stubGlobal('Image', FakeImage)
    preloadUrl('https://a/1.jpg')
    preloadUrl('https://a/1.jpg')
    expect(made).toEqual(['https://a/1.jpg'])
  })

  it('warms the grid widths and the full-screen size of an upload', () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null))
    vi.stubGlobal('fetch', fetchMock)
    warmUploadedPhoto(RAW)
    const urls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(urls.every((u) => u.includes('/render/image/public/'))).toBe(true)
    expect(urls.some((u) => u.includes('width=200'))).toBe(true)
    expect(urls.some((u) => u.includes('width=400'))).toBe(true)
    expect(urls.some((u) => u.includes('width=1440'))).toBe(true)
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ mode: 'no-cors', credentials: 'omit' })
  })

  it('also warms the avatar sizes of a profile photo, and ignores non-storage URLs', () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null))
    vi.stubGlobal('fetch', fetchMock)
    warmUploadedPhoto(RAW, 'avatar')
    const urls = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(urls.some((u) => u.includes('width=80&'))).toBe(true)
    fetchMock.mockClear()
    warmUploadedPhoto('https://elsewhere.example/p.jpg')
    warmUploadedPhoto(null)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
