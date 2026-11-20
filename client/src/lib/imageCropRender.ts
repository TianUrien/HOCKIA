/**
 * Canvas side of the crop step: load the picked file, sample it for
 * `analyseImage`, and render the chosen crop to the square that is stored.
 * The geometry comes from `imageFit.ts`.
 */
import { withImageExtension } from '@/lib/imageOptimization'
import { analyseImage, drawRect, outputMimeType, outputSide, type Crop, type ImageAnalysis, type ImageKind } from '@/lib/imageFit'

const SAMPLE_SIDE = 96

export interface LoadedImage {
  element: HTMLImageElement
  /** Object URL for showing the image; revoke it with `releaseImage`. */
  url: string
  width: number
  height: number
}

/**
 * Decode the file. Browsers apply the EXIF orientation when they decode an
 * `<img>`, so `naturalWidth` / `naturalHeight` and every later draw are
 * already upright (the native picker corrects it before we get the file).
 */
export function loadImageFile(file: File): Promise<LoadedImage> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const element = new Image()
    element.style.imageOrientation = 'from-image'
    element.onload = () => {
      if (!element.naturalWidth || !element.naturalHeight) {
        URL.revokeObjectURL(url)
        reject(new Error('Image has no size'))
        return
      }
      resolve({ element, url, width: element.naturalWidth, height: element.naturalHeight })
    }
    element.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load image'))
    }
    element.src = url
  })
}

export function releaseImage(image: LoadedImage | null): void {
  if (image) URL.revokeObjectURL(image.url)
}

/** Edge and artwork analysis from a small copy of the image. */
export function sampleImage(image: LoadedImage): ImageAnalysis {
  const long = Math.max(image.width, image.height)
  const w = Math.max(2, Math.round((image.width / long) * SAMPLE_SIDE))
  const h = Math.max(2, Math.round((image.height / long) * SAMPLE_SIDE))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return analyseImage([], 0, 0)
  ctx.drawImage(image.element, 0, 0, w, h)
  return analyseImage(ctx.getImageData(0, 0, w, h).data, w, h)
}

/** Draw the crop to its stored square and return it as a file. */
export async function renderCrop(
  image: LoadedImage,
  crop: Crop,
  options: { kind: ImageKind; background: string | null; sourceType: string; name: string },
): Promise<File> {
  const side = outputSide(image.width, image.height, crop.zoom, options.kind)
  const canvas = document.createElement('canvas')
  canvas.width = side
  canvas.height = side
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Failed to get canvas context')
  const mimeType = outputMimeType(options.sourceType, options.background)
  // JPEG has no transparency: canvas would put clear pixels on black.
  const fill = options.background ?? (mimeType === 'image/jpeg' ? 'rgb(255, 255, 255)' : null)
  if (fill) {
    ctx.fillStyle = fill
    ctx.fillRect(0, 0, side, side)
  }
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  const { dx, dy, dw, dh } = drawRect(crop, image.width, image.height, side)
  ctx.drawImage(image.element, dx, dy, dw, dh)
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Failed to create blob from canvas'))), mimeType, 0.92)
  })
  return new File([blob], withImageExtension(options.name, mimeType), { type: mimeType })
}
