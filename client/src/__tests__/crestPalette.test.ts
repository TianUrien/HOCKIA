import { describe, expect, it } from 'vitest'
import { CREST_PALETTE_VERSION, GRAPHITE, coverBackground, extractCrestPalette, isCurrentPalette, rgbToHsl } from '@/lib/crestPalette'
import { colorFromPalette, dominantCrestColor, whiteContrast } from '@/lib/crestColor'

/** Fixed RGBA fixtures: `fill` paints a run of pixels, transparent plate by default. */
function pixels(runs: Array<[rgb: [number, number, number], count: number, alpha?: number]>): Uint8ClampedArray {
  const total = runs.reduce((n, r) => n + r[1], 0)
  const out = new Uint8ClampedArray(total * 4)
  let i = 0
  for (const [[r, g, b], count, a = 255] of runs) for (let k = 0; k < count; k++) { out[i++] = r; out[i++] = g; out[i++] = b; out[i++] = a }
  return out
}
const hue = (hex: string) => rgbToHsl(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)).h
const hexRgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]

describe('extractCrestPalette', () => {
  it('a single saturated colour: that hue, darkened stops, white plate and transparent pixels ignored', () => {
    const p = extractCrestPalette(pixels([[[200, 30, 40], 400], [[255, 255, 255], 600], [[0, 0, 0], 300, 0]]))
    expect(p.v).toBe(CREST_PALETTE_VERSION)
    expect(Math.abs(hue(p.primary) - hue('#c81e28'))).toBeLessThan(8)
    expect(p.stops.map(hue).every((h) => Math.abs(h - hue(p.primary)) < 8)).toBe(true)
    expect(whiteContrast(hexRgb(p.stops[2]))).toBeGreaterThan(4.5)
  })
  it('sky blue + gold (Lazio-style): blue carries the background, gold becomes the glow', () => {
    const p = extractCrestPalette(pixels([[[110, 180, 230], 500], [[230, 180, 40], 450]]))
    expect(hue(p.primary)).toBeGreaterThan(180) // blue family, although gold has almost as many pixels
    expect(hue(p.glow)).toBeGreaterThan(35); expect(hue(p.glow)).toBeLessThan(75)
  })
  it('gold only (Kilkenny-style black & amber): warm near-black base, gold glow, never olive', () => {
    const p = extractCrestPalette(pixels([[[235, 180, 30], 500], [[10, 10, 10], 500]]))
    expect(hue(p.glow)).toBeGreaterThan(35); expect(hue(p.glow)).toBeLessThan(75)
    const [, , l] = Object.values(rgbToHsl(...hexRgb(p.stops[0])))
    expect(l).toBeLessThan(0.3) // dark base, not a darkened yellow
  })
  it('black & white crest: graphite, never a category colour', () => {
    expect(extractCrestPalette(pixels([[[20, 20, 20], 300], [[250, 250, 250], 300], [[128, 128, 128], 300]]))).toEqual(GRAPHITE)
  })
  it('only transparent pixels: graphite as well', () => {
    expect(extractCrestPalette(pixels([[[200, 30, 40], 300, 10]]))).toEqual(GRAPHITE)
  })
  it('is deterministic', () => {
    const px = pixels([[[30, 90, 200], 300], [[220, 40, 40], 200]])
    expect(extractCrestPalette(px)).toEqual(extractCrestPalette(px))
  })
})

describe('one picker for every surface', () => {
  it('the legacy single colour is derived from the same palette and reads white text at 4.5:1', () => {
    const px = pixels([[[235, 180, 30], 500], [[10, 10, 10], 500]])
    const color = dominantCrestColor(px)
    expect(color).toBe(colorFromPalette(extractCrestPalette(px)))
    expect(whiteContrast(hexRgb(color as string))).toBeGreaterThanOrEqual(4.5)
    const h = rgbToHsl(...hexRgb(color as string))
    expect(h.l).toBeLessThan(0.3) // a gold crest no longer gives an olive card
  })
  it('too few usable pixels → null (not a crest); monochrome → null for cards, graphite for covers', () => {
    expect(dominantCrestColor(pixels([[[200, 30, 40], 5]]))).toBeNull()
    const mono = pixels([[[20, 20, 20], 300], [[250, 250, 250], 300]])
    expect(dominantCrestColor(mono)).toBeNull()
    expect(extractCrestPalette(mono)).toEqual(GRAPHITE)
  })
})

describe('coverBackground / isCurrentPalette', () => {
  it('renders the two-layer gradient and falls back to Hockia violet', () => {
    expect(coverBackground(null)).toMatch(/radial-gradient.*#a78bfa61.*linear-gradient\(135deg, #7c3aed/)
  })
  it('accepts only the current version with the right shape', () => {
    expect(isCurrentPalette(GRAPHITE)).toBe(true)
    expect(isCurrentPalette({ ...GRAPHITE, v: 1 })).toBe(false)
    expect(isCurrentPalette(null)).toBe(false)
  })
})
