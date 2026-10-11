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
 * Dominant colour from RGBA pixels (e.g. a 48×48 canvas read), already
 * darkened for white text. Returns "#rrggbb" or null.
 */
export function dominantCrestColor(pixels: ArrayLike<number>): string | null {
  const buckets = new Map<number, { n: number; weight: number; r: number; g: number; b: number }>()
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2], a = pixels[i + 3]
    if (a < 128) continue
    const max = Math.max(r, g, b), min = Math.min(r, g, b)
    if (min > 225) continue // near-white: the JPEG square, highlights
    if (max < 40) continue // near-black: outlines, text
    const sat = max === 0 ? 0 : (max - min) / max
    if (sat < 0.22) continue // greys
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5)
    const bucket = buckets.get(key) ?? { n: 0, weight: 0, r: 0, g: 0, b: 0 }
    bucket.n += 1
    bucket.weight += sat
    bucket.r += r; bucket.g += g; bucket.b += b
    buckets.set(key, bucket)
  }
  let best: { n: number; weight: number; r: number; g: number; b: number } | null = null
  for (const bucket of buckets.values()) if (!best || bucket.weight > best.weight) best = bucket
  // A handful of stray pixels is not a crest colour.
  if (!best || best.n < 12) return null
  const avg: [number, number, number] = [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)]
  return toHex(darkenForWhiteText(avg))
}

const SAMPLE = 48

/** Browser only: read an image (URL with CORS, or a File/Blob) and pick its colour. */
export async function extractCrestColor(source: string | Blob): Promise<string | null> {
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
    return dominantCrestColor(ctx.getImageData(0, 0, SAMPLE, SAMPLE).data)
  } catch {
    return null
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl)
  }
}
