/**
 * A club crest's dominant colour for the Community "Cover=Crest" card (Figma
 * Card / Club wide): the background gradient starts from this colour, so it is
 * darkened until white text on it reaches 4.5:1 (WCAG AA).
 *
 * Picking: near-white (the JPEG square around many crests), near-black
 * outlines, greys and transparent pixels are ignored; the rest is bucketed by
 * colour and the most common saturated bucket wins. No usable pixel → null
 * (the card keeps the brand purple).
 */

import { GRAPHITE, extractCrestPalette, type CrestPalette } from './crestPalette'

const WHITE_CONTRAST = 4.5

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** Contrast of white text on this colour. */
export function whiteContrast(rgb: [number, number, number]): number {
  return 1.05 / (luminance(rgb) + 0.05)
}

/** Darken (keeping the hue) until white text reaches 4.5:1. */
export function darkenForWhiteText(rgb: [number, number, number]): [number, number, number] {
  let out = rgb
  for (let i = 0; i < 40 && whiteContrast(out) < WHITE_CONTRAST; i += 1) {
    out = out.map((v) => Math.floor(v * 0.94)) as [number, number, number]
  }
  return out
}

export function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}`
}

/**
 * The crest's single colour for the Community / Home cards ("#rrggbb", darkened
 * for white text). Since the Opportunities v2 unification (2026-10-16) it is
 * derived from the same palette every surface uses: the light end of the
 * palette gradient, darkened until white text reaches 4.5:1. Gold-heavy crests
 * therefore get a warm dark base (never olive), black & white crests graphite.
 * Returns null only when there are too few usable pixels to be a crest.
 */
export function dominantCrestColor(pixels: ArrayLike<number>): string | null {
  // Usable = opaque and not the white plate; a handful of stray pixels is not a crest.
  let usable = 0
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] >= 200 && !(pixels[i] >= 235 && pixels[i + 1] >= 235 && pixels[i + 2] >= 235)) usable += 1
  }
  if (usable < 12) return null
  return colorFromPalette(extractCrestPalette(pixels))
}

/**
 * The single card colour a palette implies (same rule as dominantCrestColor).
 * A monochrome crest (graphite palette) gives null: Community cards keep the
 * brand purple as before, while covers use the graphite palette directly.
 */
export function colorFromPalette(palette: CrestPalette): string | null {
  if (palette.stops[0] === GRAPHITE.stops[0]) return null
  const rgb = hexToRgb(palette.stops[0])
  return toHex(darkenForWhiteText(rgb))
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const SAMPLE = 48

export interface CrestColors { color: string; palette: CrestPalette }

/** Browser only: read an image (URL with CORS, or a File/Blob) once and derive both the card colour and the cover palette. */
export async function extractCrestColors(source: string | Blob): Promise<CrestColors | null> {
  const pixels = await readCrestPixels(source)
  if (!pixels) return null
  const color = dominantCrestColor(pixels)
  if (!color) return null
  return { color, palette: extractCrestPalette(pixels) }
}

/** Browser only: the single card colour (kept for existing callers). */
export async function extractCrestColor(source: string | Blob): Promise<string | null> {
  return (await extractCrestColors(source))?.color ?? null
}

async function readCrestPixels(source: string | Blob): Promise<Uint8ClampedArray | null> {
  if (typeof document === 'undefined') return null
  const objectUrl = typeof source === 'string' ? null : URL.createObjectURL(source)
  try {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.decoding = 'async'
    const loaded = new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('crest image failed to load'))
    })
    img.src = objectUrl ?? (source as string)
    await loaded
    const canvas = document.createElement('canvas')
    canvas.width = SAMPLE
    canvas.height = SAMPLE
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, SAMPLE, SAMPLE)
    return ctx.getImageData(0, 0, SAMPLE, SAMPLE).data
  } catch {
    return null
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl)
  }
}
