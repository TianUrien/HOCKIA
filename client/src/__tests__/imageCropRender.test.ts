import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadImageFile } from '@/lib/imageCropRender'

/**
 * A file from a phone's picker failed once to decode through its object URL
 * (Android, device lab 2026-11-20). loadImageFile reads the bytes into memory
 * and tries once more before the crop step reports the image as unreadable.
 */
describe('loadImageFile', () => {
  let outcomes: Array<'load' | 'error'>
  const RealImage = globalThis.Image

  beforeEach(() => {
    outcomes = []
    let n = 0
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:test-${++n}`)
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    class FakeImage {
      style = {} as CSSStyleDeclaration
      naturalWidth = 300
      naturalHeight = 200
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_: string) {
        const outcome = outcomes.shift() ?? 'load'
        queueMicrotask(() => (outcome === 'load' ? this.onload?.() : this.onerror?.()))
      }
    }
    globalThis.Image = FakeImage as unknown as typeof Image
  })

  afterEach(() => {
    globalThis.Image = RealImage
    vi.restoreAllMocks()
  })

  const file = () => new File([new Uint8Array([1, 2, 3])], 'crest.png', { type: 'image/png' })

  it('decodes a readable file on the first try', async () => {
    const image = await loadImageFile(file())
    expect(image).toMatchObject({ url: 'blob:test-1', width: 300, height: 200 })
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
  })

  it('reads the bytes into memory and tries once more when the first decode fails', async () => {
    outcomes = ['error', 'load']
    const image = await loadImageFile(file())
    expect(image.url).toBe('blob:test-2')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-1')
    const second = vi.mocked(URL.createObjectURL).mock.calls[1][0] as Blob
    expect(second).not.toBeInstanceOf(File)
    expect(second.type).toBe('image/png')
    expect(second.size).toBe(3)
  })

  it('gives up after the second failure', async () => {
    outcomes = ['error', 'error']
    await expect(loadImageFile(file())).rejects.toThrow('Failed to load image')
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2)
  })
})
