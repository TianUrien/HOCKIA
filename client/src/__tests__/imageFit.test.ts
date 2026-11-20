import { describe, expect, it } from 'vitest'
import {
  CONTENT_FILL, analyseImage, clampCrop, coverZoom, cropBackground, drawRect, drawnSize, initialCrop, isSmallImage,
  outputMimeType, outputSide, zoomBounds, zoomTo,
} from '@/lib/imageFit'

type Pixel = [number, number, number, number]
/** Build RGBA pixels from a function of (x, y). */
function pixels(width: number, height: number, at: (x: number, y: number) => Pixel): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(at(x, y), (y * width + x) * 4)
  return data
}
const CLEAR: Pixel = [0, 0, 0, 0]
const WHITE: Pixel = [255, 255, 255, 255]
const BLUE: Pixel = [20, 60, 200, 255]
const RED: Pixel = [200, 30, 30, 255]

describe('analyseImage', () => {
  it('reads a transparent logo and finds its artwork box', () => {
    // 40 × 40, red artwork in the middle 20 × 10.
    const data = pixels(40, 40, (x, y) => (x >= 10 && x < 30 && y >= 15 && y < 25 ? RED : CLEAR))
    const a = analyseImage(data, 40, 40)
    expect(a.transparent).toBe(true)
    expect(a.blankBackground).toBe(true)
    expect(a.content).toEqual({ x: 0.25, y: 0.375, w: 0.5, h: 0.25 })
  })

  it('treats an opaque logo on white as a blank background and trims it', () => {
    const data = pixels(40, 20, (x, y) => (x >= 8 && x < 32 && y >= 5 && y < 15 ? BLUE : WHITE))
    const a = analyseImage(data, 40, 20)
    expect(a.transparent).toBe(false)
    expect(a.uniformEdge).toBe(true)
    expect(a.blankBackground).toBe(true)
    expect(a.content).toEqual({ x: 0.2, y: 0.25, w: 0.6, h: 0.5 })
  })

  it('reads the edge colour of an opaque logo on a flat colour', () => {
    const data = pixels(30, 30, (x, y) => (x > 10 && x < 20 && y > 10 && y < 20 ? WHITE : BLUE))
    const a = analyseImage(data, 30, 30)
    expect(a.uniformEdge).toBe(true)
    expect(a.blankBackground).toBe(false)
    expect(a.edgeColor).toEqual([20, 60, 200])
    expect(a.content).toEqual({ x: 0, y: 0, w: 1, h: 1 })
  })

  it('does not call a photo uniform', () => {
    const data = pixels(30, 30, (x, y) => [(x * 8) % 256, (y * 8) % 256, ((x + y) * 5) % 256, 255])
    const a = analyseImage(data, 30, 30)
    expect(a.uniformEdge).toBe(false)
    expect(a.blankBackground).toBe(false)
  })

  it('keeps an app icon with clear rounded corners opaque', () => {
    const data = pixels(40, 40, (x, y) => ((x < 2 || x > 37) && (y < 2 || y > 37) ? CLEAR : BLUE))
    expect(analyseImage(data, 40, 40).transparent).toBe(false)
  })

  it('flags a fully transparent image as empty', () => {
    const a = analyseImage(pixels(30, 30, () => CLEAR), 30, 30)
    expect(a.transparent).toBe(true)
    expect(a.empty).toBe(true)
  })

  it('flags an all-white image as empty', () => {
    expect(analyseImage(pixels(30, 30, () => WHITE), 30, 30).empty).toBe(true)
  })

  it('does not flag artwork, a flat colour or a photo as empty', () => {
    expect(analyseImage(pixels(40, 40, (x, y) => (x >= 10 && x < 30 && y >= 15 && y < 25 ? RED : CLEAR)), 40, 40).empty).toBe(false)
    expect(analyseImage(pixels(30, 30, () => BLUE), 30, 30).empty).toBe(false)
    expect(analyseImage(pixels(30, 30, (x, y) => [(x * 8) % 256, (y * 8) % 256, ((x + y) * 5) % 256, 255]), 30, 30).empty).toBe(false)
    // One faint mark is still artwork.
    expect(analyseImage(pixels(30, 30, (x, y) => (x === 15 && y === 15 ? RED : CLEAR)), 30, 30).empty).toBe(false)
  })

  it('survives an empty sample', () => {
    expect(analyseImage([], 0, 0).content).toEqual({ x: 0, y: 0, w: 1, h: 1 })
  })
})

describe('initialCrop', () => {
  const opaqueSquare = analyseImage(pixels(20, 20, () => BLUE), 20, 20)
  const photo = analyseImage(pixels(30, 30, (x, y) => [(x * 8) % 256, (y * 8) % 256, ((x + y) * 5) % 256, 255]), 30, 30)

  it('fills the tile with a square opaque logo', () => {
    expect(initialCrop(opaqueSquare, 800, 800, 'logo')).toEqual({ zoom: 1, x: 0, y: 0 })
  })

  it('shows a wide logo on a flat colour whole instead of cutting its ends', () => {
    const crop = initialCrop(opaqueSquare, 1200, 400, 'logo')
    expect(crop).toEqual({ zoom: 1, x: 0, y: 0 })
    // The whole width is inside the square; the rest is completed with the edge colour.
    expect(drawnSize(1200, 400, crop.zoom)).toEqual({ w: 1, h: 1 / 3 })
    expect(cropBackground(opaqueSquare, 'logo')).toBe('rgb(20, 60, 200)')
  })

  it('trims a transparent logo and gives it the same breathing room every time', () => {
    const data = pixels(40, 40, (x, y) => (x >= 10 && x < 30 && y >= 15 && y < 25 ? RED : CLEAR))
    const a = analyseImage(data, 40, 40)
    const crop = initialCrop(a, 400, 400, 'crest')
    // Artwork is half the width: zoomed so it takes CONTENT_FILL of the tile, centred.
    expect(crop.zoom).toBeCloseTo(CONTENT_FILL / 0.5)
    expect(crop.x).toBeCloseTo(0)
    expect(crop.y).toBeCloseTo(0)
    expect(cropBackground(a, 'crest')).toBeNull()
  })

  it('centres off-centre artwork', () => {
    // Artwork in the left half only.
    const data = pixels(40, 40, (x, y) => (x >= 4 && x < 20 && y >= 12 && y < 28 ? RED : CLEAR))
    const a = analyseImage(data, 40, 40)
    const crop = initialCrop(a, 400, 400, 'logo')
    const rect = drawRect(crop, 400, 400, 100)
    const artworkCentre = rect.dx + (a.content.x + a.content.w / 2) * rect.dw
    expect(artworkCentre).toBeCloseTo(50)
  })

  it('fills from the centre for a photo, for organisations and people alike', () => {
    expect(initialCrop(photo, 1600, 900, 'logo')).toEqual({ zoom: 1600 / 900, x: 0, y: 0 })
    expect(initialCrop(photo, 900, 1600, 'person')).toEqual({ zoom: 1600 / 900, x: 0, y: 0 })
  })

  it('never pads a person, even on a blank background', () => {
    const a = analyseImage(pixels(20, 20, () => WHITE), 20, 20)
    expect(initialCrop(a, 500, 1000, 'person').zoom).toBe(2)
  })
})

describe('crop limits', () => {
  it('keeps a person photo covering the circle', () => {
    expect(zoomBounds(1000, 500, 'person').min).toBe(2)
    const crop = clampCrop({ zoom: 1, x: 5, y: 5 }, 1000, 500, 'person')
    expect(crop.zoom).toBe(2)
    // Twice as wide as the square: it may slide half a side each way, not at all vertically.
    expect(crop.x).toBe(0.5)
    expect(crop.y).toBe(0)
  })

  it('lets a logo sit smaller than its tile but keeps it inside', () => {
    const crop = clampCrop({ zoom: 0.1, x: -3, y: 0.1 }, 400, 400, 'logo')
    expect(crop.zoom).toBe(0.5)
    expect(crop.x).toBe(-0.25)
    expect(crop.y).toBe(0.1)
  })

  it('zooms about the centre', () => {
    const next = zoomTo({ zoom: 2, x: 0.2, y: -0.1 }, 4, 400, 400, 'logo')
    expect(next).toEqual({ zoom: 4, x: 0.4, y: -0.2 })
  })

  it('replaces broken numbers', () => {
    expect(clampCrop({ zoom: NaN, x: NaN, y: Infinity }, 400, 400, 'logo')).toEqual({ zoom: 0.5, x: 0, y: 0 })
  })

  it('reports the cover zoom', () => {
    expect(coverZoom(300, 300)).toBe(1)
    expect(coverZoom(300, 100)).toBe(3)
  })
})

describe('output', () => {
  it('never upscales a small upload', () => {
    expect(outputSide(120, 120, 1, 'logo')).toBe(120)
    // Padded to 80 %: the square is larger than the artwork, still at source resolution.
    expect(outputSide(120, 120, 0.8, 'logo')).toBe(150)
  })

  it('caps the stored square per kind', () => {
    expect(outputSide(4000, 4000, 1, 'logo')).toBe(1024)
    expect(outputSide(4000, 4000, 1, 'crest')).toBe(1024)
    expect(outputSide(4000, 3000, 4000 / 3000, 'person')).toBe(1440)
  })

  it('stores fewer pixels when zoomed in, not invented ones', () => {
    expect(outputSide(800, 800, 2, 'logo')).toBe(400)
  })

  it('places the image on the canvas', () => {
    expect(drawRect({ zoom: 1, x: 0, y: 0 }, 1200, 400, 300)).toEqual({ dx: 0, dy: 100, dw: 300, dh: 100 })
    expect(drawRect({ zoom: 2, x: 0.25, y: 0 }, 400, 400, 100)).toEqual({ dx: -25, dy: -50, dw: 200, dh: 200 })
  })

  it('warns under 320 px on the short side', () => {
    expect(isSmallImage(319, 2000)).toBe(true)
    expect(isSmallImage(320, 320)).toBe(false)
  })

  it('keeps PNG for a logo with transparency or a PNG source, JPEG otherwise', () => {
    expect(outputMimeType('image/jpeg', null, 'logo')).toBe('image/png')
    expect(outputMimeType('image/png', 'rgb(255, 255, 255)', 'crest')).toBe('image/png')
    expect(outputMimeType('image/jpeg', 'rgb(255, 255, 255)', 'logo')).toBe('image/jpeg')
  })

  it("always stores a person's photo as JPEG, whatever was picked", () => {
    expect(outputMimeType('image/png', 'rgb(255, 255, 255)', 'person')).toBe('image/jpeg')
    expect(outputMimeType('image/png', null, 'person')).toBe('image/jpeg')
  })
})
