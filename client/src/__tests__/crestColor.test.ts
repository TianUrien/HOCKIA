import { describe, expect, it } from 'vitest'
import { darkenForWhiteText, dominantCrestColor, whiteContrast } from '@/lib/crestColor'

/** RGBA pixels: `n` pixels of each colour. */
function pixels(...groups: [number, [number, number, number, number?]][]): number[] {
  const out: number[] = []
  for (const [n, [r, g, b, a = 255]] of groups) for (let i = 0; i < n; i += 1) out.push(r, g, b, a)
  return out
}

const hexToRgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]

describe('crest colour', () => {
  it('ignores the white JPEG square and picks the crest colour', () => {
    const color = dominantCrestColor(pixels([1500, [255, 255, 255]], [400, [30, 90, 200]]))
    expect(color).not.toBeNull()
    const [r, g, b] = hexToRgb(color as string)
    expect(b).toBeGreaterThan(r)
    expect(b).toBeGreaterThan(g)
  })

  it('ignores black outlines, greys and transparency', () => {
    expect(dominantCrestColor(pixels([800, [0, 0, 0]], [800, [128, 128, 128]], [800, [200, 30, 30, 0]]))).toBeNull()
  })

  it('needs more than a few stray pixels', () => {
    expect(dominantCrestColor(pixels([2000, [255, 255, 255]], [5, [200, 30, 30]]))).toBeNull()
  })

  it('the colour always carries white text at 4.5:1', () => {
    for (const rgb of [[250, 220, 40], [60, 200, 120], [120, 200, 255]] as [number, number, number][]) {
      expect(whiteContrast(darkenForWhiteText(rgb))).toBeGreaterThanOrEqual(4.5)
    }
    const picked = dominantCrestColor(pixels([600, [250, 220, 40]]))
    expect(whiteContrast(hexToRgb(picked as string))).toBeGreaterThanOrEqual(4.5)
  })
})
