/**
 * How an uploaded photo, crest or logo is fitted into its square.
 *
 * Members upload whatever they have: a square logo on a colour, a transparent
 * crest with wide margins, a wide wordmark, a small file. This module decides
 * a good starting crop from the pixels and holds the geometry the crop screen
 * and the final render share, so the preview and the stored file always agree.
 *
 * Everything here is pure (plain numbers and pixel arrays); the canvas work
 * lives in `imageCropRender.ts`.
 *
 * Geometry: the stage is a square of side 1. At zoom 1 the whole image fits
 * inside it ("contain"). `x` and `y` are the distance of the image centre from
 * the stage centre, in stage sides.
 */

/** A person's photo (circle), a club crest or a brand logo (rounded squares). */
export type ImageKind = 'person' | 'crest' | 'logo'

export interface Crop {
  zoom: number
  x: number
  y: number
}

export interface ContentBox {
  /** Fractions of the image, 0 to 1. */
  x: number
  y: number
  w: number
  h: number
}

export interface ImageAnalysis {
  /** The image has a transparent background (its edge is mostly see-through). */
  transparent: boolean
  /** The edge is one flat colour, so the image can be extended with it. */
  uniformEdge: boolean
  edgeColor: [number, number, number]
  /** Transparent, or opaque on flat near-white: the artwork floats on nothing. */
  blankBackground: boolean
  /** Where the artwork is. The whole image unless the background is blank. */
  content: ContentBox
}

/** Shortest side under this many pixels looks soft on a profile header. */
export const MIN_SHARP_SIDE = 320
/** On a blank background the artwork's longest side takes this much of the tile. */
export const CONTENT_FILL = 0.8
/** Largest stored square: organisations 1024 px, people 1440 px (full-screen photo, 2026-10-23). */
export const MAX_SIDE: Record<ImageKind, number> = { person: 1440, crest: 1024, logo: 1024 }

const ALPHA_SOLID = 128
const ALPHA_VISIBLE = 16
const COLOUR_TOLERANCE = 24
const NEAR_WHITE = 238
const FULL: ContentBox = { x: 0, y: 0, w: 1, h: 1 }

export function isPerson(kind: ImageKind): boolean {
  return kind === 'person'
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

/**
 * Read the edge and the artwork box from RGBA pixels (a small downscaled
 * sample is enough: the crop screen passes about 96 px).
 */
export function analyseImage(rgba: ArrayLike<number>, width: number, height: number): ImageAnalysis {
  if (width < 2 || height < 2 || rgba.length < width * height * 4) {
    return { transparent: false, uniformEdge: false, edgeColor: [255, 255, 255], blankBackground: false, content: FULL }
  }
  const at = (px: number, py: number) => (py * width + px) * 4
  const edge: number[] = []
  for (let px = 0; px < width; px++) { edge.push(at(px, 0), at(px, height - 1)) }
  for (let py = 1; py < height - 1; py++) { edge.push(at(0, py), at(width - 1, py)) }

  const clear = edge.filter((i) => rgba[i + 3] < ALPHA_SOLID).length
  // Rounded app-icon corners are a few clear edge pixels; a transparent logo is mostly clear.
  const transparent = clear / edge.length >= 0.25

  let uniformEdge = false
  let edgeColor: [number, number, number] = [255, 255, 255]
  if (!transparent) {
    const solid = edge.filter((i) => rgba[i + 3] >= ALPHA_SOLID)
    edgeColor = [median(solid.map((i) => rgba[i])), median(solid.map((i) => rgba[i + 1])), median(solid.map((i) => rgba[i + 2]))]
    const close = solid.filter((i) => differs(rgba, i, edgeColor) === false).length
    uniformEdge = solid.length > 0 && close / solid.length >= 0.9
  }
  const nearWhite = edgeColor.every((c) => c >= NEAR_WHITE)
  const blankBackground = transparent || (uniformEdge && nearWhite)

  let content = FULL
  if (blankBackground) {
    let minX = width, minY = height, maxX = -1, maxY = -1
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const i = at(px, py)
        const ink = transparent ? rgba[i + 3] > ALPHA_VISIBLE : rgba[i + 3] > ALPHA_VISIBLE && differs(rgba, i, edgeColor)
        if (!ink) continue
        if (px < minX) minX = px
        if (px > maxX) maxX = px
        if (py < minY) minY = py
        if (py > maxY) maxY = py
      }
    }
    if (maxX >= minX && maxY >= minY) {
      content = { x: minX / width, y: minY / height, w: (maxX - minX + 1) / width, h: (maxY - minY + 1) / height }
    }
  }
  return { transparent, uniformEdge, edgeColor, blankBackground, content }
}

function differs(rgba: ArrayLike<number>, i: number, colour: [number, number, number]): boolean {
  return Math.abs(rgba[i] - colour[0]) > COLOUR_TOLERANCE
    || Math.abs(rgba[i + 1] - colour[1]) > COLOUR_TOLERANCE
    || Math.abs(rgba[i + 2] - colour[2]) > COLOUR_TOLERANCE
}

/** Zoom at which the image covers the whole square (1 for a square image). */
export function coverZoom(width: number, height: number): number {
  const short = Math.min(width, height)
  return short > 0 ? Math.max(width, height) / short : 1
}

export function zoomBounds(width: number, height: number, kind: ImageKind): { min: number; max: number } {
  const cover = coverZoom(width, height)
  // A person's photo always fills its circle; a logo may sit smaller than its tile.
  return isPerson(kind) ? { min: cover, max: cover * 4 } : { min: 0.5, max: Math.max(4, cover * 3) }
}

/** Size of the drawn image in stage sides. */
export function drawnSize(width: number, height: number, zoom: number): { w: number; h: number } {
  const long = Math.max(width, height, 1)
  return { w: (width / long) * zoom, h: (height / long) * zoom }
}

/** Keep the zoom in range and the image where it can still be seen in full use. */
export function clampCrop(crop: Crop, width: number, height: number, kind: ImageKind): Crop {
  const { min, max } = zoomBounds(width, height, kind)
  const zoom = Math.min(max, Math.max(min, Number.isFinite(crop.zoom) ? crop.zoom : min))
  const size = drawnSize(width, height, zoom)
  // Larger than the square: it must keep covering it. Smaller: it must stay inside it.
  const limit = (d: number) => Math.abs(d - 1) / 2
  const hold = (v: number, d: number) => Math.min(limit(d), Math.max(-limit(d), Number.isFinite(v) ? v : 0))
  return { zoom, x: hold(crop.x, size.w), y: hold(crop.y, size.h) }
}

/** The automatic fit: what the member sees first and gets if they change nothing. */
export function initialCrop(analysis: ImageAnalysis, width: number, height: number, kind: ImageKind): Crop {
  const cover: Crop = { zoom: coverZoom(width, height), x: 0, y: 0 }
  if (isPerson(kind)) return cover
  if (analysis.blankBackground) {
    // Trim the empty margin and give the artwork the same breathing room every time.
    const { content } = analysis
    const long = Math.max(width, height)
    const artwork = Math.max(content.w * width, content.h * height, 1)
    const zoom = (CONTENT_FILL * long) / artwork
    const centreX = (content.x + content.w / 2 - 0.5) * (width / long) * zoom
    const centreY = (content.y + content.h / 2 - 0.5) * (height / long) * zoom
    return clampCrop({ zoom, x: -centreX, y: -centreY }, width, height, kind)
  }
  // A flat colour edge: show the whole logo, the square is completed with that colour.
  if (analysis.uniformEdge) return { zoom: 1, x: 0, y: 0 }
  // A photo or full-bleed artwork: fill the square from the centre.
  return cover
}

/** Zoom about the stage centre: what is in the middle stays in the middle. */
export function zoomTo(crop: Crop, zoom: number, width: number, height: number, kind: ImageKind): Crop {
  const { min, max } = zoomBounds(width, height, kind)
  const next = Math.min(max, Math.max(min, zoom))
  const ratio = crop.zoom > 0 ? next / crop.zoom : 1
  return clampCrop({ zoom: next, x: crop.x * ratio, y: crop.y * ratio }, width, height, kind)
}

/**
 * What fills the square behind the image: null keeps it transparent (the tile
 * is white), otherwise a CSS colour.
 */
export function cropBackground(analysis: ImageAnalysis, kind: ImageKind): string | null {
  if (analysis.transparent && !isPerson(kind)) return null
  if (analysis.uniformEdge) return `rgb(${analysis.edgeColor[0]}, ${analysis.edgeColor[1]}, ${analysis.edgeColor[2]})`
  return 'rgb(255, 255, 255)'
}

/** Side of the stored square in pixels: never larger than the source shows (no upscaling). */
export function outputSide(width: number, height: number, zoom: number, kind: ImageKind): number {
  const shown = Math.max(width, height) / Math.max(zoom, 0.0001)
  return Math.max(1, Math.min(MAX_SIDE[kind], Math.round(shown)))
}

/** Where to draw the image on a square canvas of `side` pixels. */
export function drawRect(crop: Crop, width: number, height: number, side: number): { dx: number; dy: number; dw: number; dh: number } {
  const size = drawnSize(width, height, crop.zoom)
  const dw = size.w * side
  const dh = size.h * side
  return { dx: side / 2 + crop.x * side - dw / 2, dy: side / 2 + crop.y * side - dh / 2, dw, dh }
}

export function isSmallImage(width: number, height: number): boolean {
  return Math.min(width, height) < MIN_SHARP_SIDE
}

/** PNG keeps transparency and flat logo colours; photos stay JPEG. */
export function outputMimeType(sourceType: string, background: string | null): 'image/png' | 'image/jpeg' {
  return background === null || sourceType === 'image/png' ? 'image/png' : 'image/jpeg'
}
