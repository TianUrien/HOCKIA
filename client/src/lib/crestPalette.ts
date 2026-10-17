/**
 * Club colours from the crest — the ONE extractor for every surface (Home role
 * covers, Community club cards, Opportunities covers; founder ruling
 * 2026-10-16: unify). Design hand-off: Figma "OP · Handoff — Club colours from
 * the crest" (page 05 · Opportunities), reference implementation by the design
 * session, tested on six crests.
 *
 * Pipeline
 *   1. A club uploads / changes its crest → the phone reads the pixels once
 *      (lib/crestColor.ts) and saves `color` + `palette` to club_crest_colors
 *      (world_club_crest_colors for directory crests, written by admins).
 *   2. Covers read the stored palette → coverBackground(). Null → HOCKIA_FALLBACK.
 *   3. The admin backfill recomputes rows whose palette is missing or older
 *      than CREST_PALETTE_VERSION.
 *
 * Pure and deterministic: same crest → same palette. No DOM, no dependencies.
 */

export type CrestPalette = {
  /** Schema + algorithm version; bump to make the backfill recompute. */
  v: number
  source: 'auto' | 'manual'
  /** Dominant crest colour. */
  primary: string
  /** Second colour (different hue), used as the glow. */
  secondary: string
  /** Gradient light → dark; white text sits on the dark end. */
  stops: [string, string, string]
  glow: string
}

export const CREST_PALETTE_VERSION = 2

export const HOCKIA_FALLBACK: CrestPalette = {
  v: CREST_PALETTE_VERSION, source: 'auto', primary: '#6c2bd9', secondary: '#a78bfa',
  stops: ['#6c2bd9', '#4c1d95', '#1e0b45'], glow: '#a78bfa',
}

/** Black & white crests: neutral, never the category colour. */
export const GRAPHITE: CrestPalette = {
  v: CREST_PALETTE_VERSION, source: 'auto', primary: '#3a3a42', secondary: '#8e8e99',
  stops: ['#3a3a42', '#1c1c22', '#0b0b0e'], glow: '#8e8e99',
}

type HSL = { h: number; s: number; l: number } // h 0..360, s/l 0..1

export function rgbToHsl(r: number, g: number, b: number): HSL {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return { h: h * 60, s, l }
}

export function hslToHex({ h, s, l }: HSL): string {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return '#' + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('')
}

const isYellow = (h: number) => h >= 35 && h <= 75

/**
 * RGBA pixels (any size; 48–64 px square is plenty) → palette.
 * Browser (canvas getImageData) and Node/Deno (decoded PNG/JPEG) alike.
 */
export function extractCrestPalette(rgba: Uint8ClampedArray | Uint8Array | ArrayLike<number>): CrestPalette {
  // 1. bucket opaque, non-plate pixels into 24-step RGB cells
  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>()
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2], a = rgba[i + 3]
    if (a < 200) continue // transparent background
    const { l } = rgbToHsl(r, g, b)
    if (l > 0.93 || l < 0.06) continue // white plate / black outlines
    const key = ((r / 24) | 0) * 4096 + ((g / 24) | 0) * 64 + ((b / 24) | 0)
    const c = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 }
    c.r += r; c.g += g; c.b += b; c.n++
    buckets.set(key, c)
  }
  const ranked = [...buckets.values()]
    .map((c) => { const r = c.r / c.n, g = c.g / c.n, b = c.b / c.n; return { hex: hslToHex(rgbToHsl(r, g, b)), hsl: rgbToHsl(r, g, b), n: c.n } })
    .sort((a, b) => b.n - a.n)

  // 2. chromatic buckets grouped into 30° hue families (weight = count × saturation).
  //    Yellows / golds turn olive or brown when darkened, so they never carry the
  //    background: 25% weight for the gradient, and they become the glow instead.
  const chromatic = ranked.filter((c) => c.hsl.s >= 0.3)
  if (chromatic.length === 0) return GRAPHITE
  type Fam = { bg: number; raw: number; best: (typeof chromatic)[number] }
  const families = new Map<number, Fam>()
  for (const c of chromatic) {
    const f = Math.round(c.hsl.h / 30) % 12
    const raw = c.n * c.hsl.s
    const bg = raw * (isYellow(c.hsl.h) ? 0.25 : 1)
    const cur = families.get(f)
    if (!cur) families.set(f, { bg, raw, best: c })
    else { cur.bg += bg; cur.raw += raw; if (raw > cur.best.n * cur.best.hsl.s) cur.best = c }
  }
  const byBg = [...families.values()].sort((a, b) => b.bg - a.bg)
  const primary = byBg[0].best
  const glowFam = [...families.values()].filter((f) => f !== byBg[0]).sort((a, b) => b.raw - a.raw)[0]
  const second = glowFam && glowFam.raw >= byBg[0].raw * 0.12 ? glowFam.best
    : ranked.find((c) => c !== primary && c.hsl.s < 0.3 && c.hsl.l > 0.6)
  const glowHsl = second ? second.hsl : { ...primary.hsl, l: 0.75 }

  // 2b. only yellows/golds (black & amber crests): warm near-black base, gold glow.
  if (isYellow(primary.hsl.h)) {
    const h = primary.hsl.h
    return {
      v: CREST_PALETTE_VERSION, source: 'auto', primary: primary.hex, secondary: primary.hex,
      stops: [hslToHex({ h, s: 0.18, l: 0.22 }), hslToHex({ h, s: 0.16, l: 0.12 }), hslToHex({ h, s: 0.14, l: 0.06 })],
      glow: hslToHex({ ...primary.hsl, l: Math.max(primary.hsl.l, 0.5) }),
    }
  }

  // 3. gradient from the primary hue, darkened so white text reads at the bottom
  const s = Math.min(primary.hsl.s, 0.85)
  const stops: [string, string, string] = [
    hslToHex({ h: primary.hsl.h, s: s * 0.9, l: 0.46 }),
    hslToHex({ h: primary.hsl.h, s, l: 0.27 }),
    hslToHex({ h: primary.hsl.h, s, l: 0.11 }),
  ]
  return { v: CREST_PALETTE_VERSION, source: 'auto', primary: primary.hex, secondary: hslToHex(glowHsl), stops, glow: hslToHex(glowHsl) }
}

/** The generated cover background (pair with the crest watermark and the bottom scrim). */
export function coverBackground(p: CrestPalette | null | undefined): string {
  const c = p ?? HOCKIA_FALLBACK
  return `radial-gradient(120% 90% at 18% 22%, ${c.glow}61, transparent 60%), ` +
    `linear-gradient(135deg, ${c.stops[0]} 0%, ${c.stops[1]} 55%, ${c.stops[2]} 100%)`
}

/** A stored value is usable when it has the current version and the right shape. */
export function isCurrentPalette(p: unknown): p is CrestPalette {
  if (!p || typeof p !== 'object') return false
  const o = p as Record<string, unknown>
  return o.v === CREST_PALETTE_VERSION && typeof o.primary === 'string' && Array.isArray(o.stops) && o.stops.length === 3 && typeof o.glow === 'string'
}
