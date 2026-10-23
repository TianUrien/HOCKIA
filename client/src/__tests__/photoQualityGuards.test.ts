/**
 * Photo quality guards (2026-10-23): the Community member deck fills a phone
 * screen, so its photos and the uploads behind them must stay large. Profile
 * photos were saved at 512 px and the deck asked for 800 px versions; both
 * were stretched 3–5× on a phone.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8')

describe('photo quality', () => {
  it('the member deck requests the immersive preset everywhere, never feed-full', () => {
    const src = read('components/community/photo/MemberFullPreview.tsx')
    expect(src).not.toContain("'feed-full'")
    expect(src.match(/'immersive'/g)?.length).toBeGreaterThanOrEqual(4)
  })

  it('profile photos are kept at 1440 px (square for the round avatars)', () => {
    const src = read('lib/imageOptimization.ts')
    const avatar = src.slice(src.indexOf('export async function optimizeAvatarImage'))
    expect(avatar).toMatch(/squareSize: 1440/)
    expect(avatar).toMatch(/maxSizeMB: 3/)
  })

  it('resizing uses the high-quality smoothing filter', () => {
    expect(read('lib/imageOptimization.ts')).toContain("ctx.imageSmoothingQuality = 'high'")
  })

  it('gallery photos keep up to 2048 px in their own shape', () => {
    const src = read('components/GalleryManager.tsx')
    expect(src).toMatch(/GALLERY_OPTIMIZE_OPTIONS: OptimizeOptions = \{\s*maxWidth: 2048,\s*maxHeight: 2048,\s*maxSizeMB: 3,/)
  })

  it('the native picker no longer caps photos at 1024 px', () => {
    const src = read('lib/nativeImagePicker.ts')
    expect(src).toMatch(/width: 2048,\s*height: 2048,/)
  })
})
