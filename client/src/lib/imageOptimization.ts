/**
 * Image optimization utility
 * Compresses and resizes images before upload to reduce bandwidth and storage costs
 */

import { logger } from './logger'

export interface OptimizeOptions {
  maxWidth?: number
  maxHeight?: number
  maxSizeMB?: number
  quality?: number
  mimeType?: string
  forceSquare?: boolean
  squareSize?: number
}

const DEFAULT_OPTIONS: Required<OptimizeOptions> = {
  maxWidth: 1200,
  maxHeight: 1200,
  maxSizeMB: 1,
  quality: 0.8, // 0-1 scale
  mimeType: 'image/jpeg',
  forceSquare: false,
  squareSize: 512,
}

/**
 * Optimize an image file before upload
 * Resizes if too large and compresses to target file size
 * 
 * @example
 * ```typescript
 * const file = event.target.files[0]
 * const optimized = await optimizeImage(file)
 * // Upload optimized file to Supabase
 * ```
 */
export async function optimizeImage(
  file: File,
  options: OptimizeOptions = {}
): Promise<File> {
  const opts = { ...DEFAULT_OPTIONS, ...options }

  // Preserve PNG (and its alpha) when the source is PNG and the caller didn't
  // force a type. Canvas → JPEG composites transparency onto BLACK, so a
  // transparent PNG logo/graphic would upload as a black-backed image.
  if (!options.mimeType && file.type === 'image/png') {
    opts.mimeType = 'image/png'
  }

  // Skip optimization for non-image files
  if (!file.type.startsWith('image/')) {
    logger.warn('File is not an image, skipping optimization:', file.type)
    return file
  }
  
  // Skip optimization for SVG (vector format, already small)
  if (file.type === 'image/svg+xml') {
    logger.debug('SVG detected, skipping optimization')
    return file
  }
  
  try {
    logger.debug(`Optimizing image: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`)
    
    // Load image
    const img = await loadImage(file)
    
    const shouldForceSquare = opts.forceSquare
    const canvas = document.createElement('canvas')
    let drawSourceX = 0
    let drawSourceY = 0
    let drawSourceWidth = img.width
    let drawSourceHeight = img.height

    if (shouldForceSquare) {
      const sourceSide = Math.min(img.width, img.height)
      const targetSide = Math.min(opts.squareSize, sourceSide)
      drawSourceX = (img.width - sourceSide) / 2
      drawSourceY = (img.height - sourceSide) / 2
      drawSourceWidth = sourceSide
      drawSourceHeight = sourceSide
      canvas.width = targetSide
      canvas.height = targetSide
    } else {
      const { width, height } = calculateDimensions(
        img.width,
        img.height,
        opts.maxWidth,
        opts.maxHeight
      )
      canvas.width = width
      canvas.height = height
    }
    const targetWidth = canvas.width
    const targetHeight = canvas.height

    // Resize and compress
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error('Failed to get canvas context')
    }
    
    // Draw resized image
    ctx.drawImage(
      img,
      drawSourceX,
      drawSourceY,
      drawSourceWidth,
      drawSourceHeight,
      0,
      0,
      targetWidth,
      targetHeight
    )
    
    // Convert to blob with compression
    const blob = await canvasToBlob(canvas, opts.mimeType, opts.quality)
    
    // If still too large, reduce quality further
    let finalBlob = blob
    let currentQuality = opts.quality
    const maxBytes = opts.maxSizeMB * 1024 * 1024
    
    while (finalBlob.size > maxBytes && currentQuality > 0.1) {
      currentQuality -= 0.1
      logger.debug(`Image still ${(finalBlob.size / 1024 / 1024).toFixed(2)} MB, reducing quality to ${currentQuality.toFixed(1)}`)
      finalBlob = await canvasToBlob(canvas, opts.mimeType, currentQuality)
    }
    
    // Create new file from blob
    const optimizedFile = new File(
      [finalBlob],
      file.name,
      { type: opts.mimeType }
    )
    
    const originalSize = file.size / 1024 / 1024
    const optimizedSize = optimizedFile.size / 1024 / 1024
    const savings = ((1 - optimizedSize / originalSize) * 100).toFixed(1)
    
    logger.info(
      `Image optimized: ${originalSize.toFixed(2)} MB → ${optimizedSize.toFixed(2)} MB (${savings}% reduction)`
    )
    
    return optimizedFile
  } catch (error) {
    logger.error('Error optimizing image, using original:', error)
    return file // Return original on error
  }
}

/**
 * Generate a small square thumbnail for timeline/list views.
 * Center-crops to square and resizes to the given size (default 128px).
 */
export async function generateThumbnail(
  file: File,
  options: { size?: number; quality?: number; mimeType?: string } = {}
): Promise<File> {
  const size = options.size ?? 128
  const quality = options.quality ?? 0.7
  const mimeType = options.mimeType ?? (file.type === 'image/png' ? 'image/png' : 'image/jpeg')

  try {
    const img = await loadImage(file)
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size

    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Failed to get canvas context')

    // Center-crop to square
    const sourceSide = Math.min(img.width, img.height)
    const sx = (img.width - sourceSide) / 2
    const sy = (img.height - sourceSide) / 2

    ctx.drawImage(img, sx, sy, sourceSide, sourceSide, 0, 0, size, size)

    const blob = await canvasToBlob(canvas, mimeType, quality)
    const ext = mimeType === 'image/png' ? 'png' : 'jpg'

    logger.debug(`Thumbnail generated: ${size}x${size}, ${(blob.size / 1024).toFixed(1)} KB`)

    return new File([blob], `thumb.${ext}`, { type: mimeType })
  } catch (error) {
    logger.error('Error generating thumbnail:', error)
    throw error
  }
}

export async function optimizeAvatarImage(file: File): Promise<File> {
  const isPng = file.type === 'image/png'
  return optimizeImage(file, {
    maxWidth: 1024,
    maxHeight: 1024,
    maxSizeMB: 1.5,
    quality: 0.92,
    mimeType: isPng ? 'image/png' : 'image/jpeg',
    forceSquare: true,
    squareSize: 512,
  })
}

// ============================================================================
// VIDEO UTILITIES
// ============================================================================

const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm']
const MAX_VIDEO_SIZE_MB = 100
const MAX_VIDEO_DURATION_SECONDS = 180

export function validateVideo(file: File): { valid: boolean; error?: string } {
  if (!file.name || file.name.length > 255) {
    return { valid: false, error: 'Invalid file name' }
  }

  const normalizedName = file.name.toLowerCase()
  const hasValidExtension =
    normalizedName.endsWith('.mp4') ||
    normalizedName.endsWith('.mov') ||
    normalizedName.endsWith('.webm')
  const hasValidMime = ALLOWED_VIDEO_TYPES.includes(file.type.toLowerCase())

  if (!hasValidExtension || !hasValidMime) {
    return { valid: false, error: 'Only MP4, MOV, or WebM videos are allowed.' }
  }

  const maxBytes = MAX_VIDEO_SIZE_MB * 1024 * 1024
  if (file.size > maxBytes) {
    return {
      valid: false,
      error: `Video is too large. Max ${MAX_VIDEO_SIZE_MB}MB.`,
    }
  }

  return { valid: true }
}

export function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    const url = URL.createObjectURL(file)

    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url)
      if (!isFinite(video.duration) || video.duration <= 0) {
        reject(new Error('Could not determine video duration'))
        return
      }
      resolve(video.duration)
    }

    video.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load video metadata'))
    }

    video.src = url
  })
}

export function getVideoDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    const url = URL.createObjectURL(file)

    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url)
      resolve({ width: video.videoWidth, height: video.videoHeight })
    }

    video.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load video metadata'))
    }

    video.src = url
  })
}

export async function extractVideoThumbnail(
  file: File,
  options: { seekTime?: number; quality?: number } = {}
): Promise<File> {
  const seekTime = options.seekTime ?? 1
  const quality = options.quality ?? 0.8

  return new Promise((resolve, reject) => {
    const video = document.createElement('video')
    video.preload = 'auto'
    video.muted = true
    video.playsInline = true
    const url = URL.createObjectURL(file)

    video.onloadeddata = () => {
      // Seek to the target time (or midpoint if video is shorter)
      video.currentTime = Math.min(seekTime, video.duration / 2)
    }

    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight

        const ctx = canvas.getContext('2d')
        if (!ctx) {
          URL.revokeObjectURL(url)
          reject(new Error('Failed to get canvas context'))
          return
        }

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        URL.revokeObjectURL(url)

        canvas.toBlob(
          (blob) => {
            if (blob) {
              logger.debug(`Video thumbnail extracted: ${canvas.width}x${canvas.height}, ${(blob.size / 1024).toFixed(1)} KB`)
              resolve(new File([blob], 'poster.jpg', { type: 'image/jpeg' }))
            } else {
              reject(new Error('Failed to create thumbnail blob'))
            }
          },
          'image/jpeg',
          quality
        )
      } catch (err) {
        URL.revokeObjectURL(url)
        reject(err)
      }
    }

    video.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load video for thumbnail extraction'))
    }

    video.src = url
  })
}

export async function validateVideoFull(file: File): Promise<{ valid: boolean; error?: string; duration?: number; width?: number; height?: number }> {
  const basic = validateVideo(file)
  if (!basic.valid) return basic

  try {
    const [duration, dimensions] = await Promise.all([
      getVideoDuration(file),
      getVideoDimensions(file),
    ])

    if (duration > MAX_VIDEO_DURATION_SECONDS) {
      return { valid: false, error: `Video must be ${MAX_VIDEO_DURATION_SECONDS / 60} minutes or less. Current: ${Math.ceil(duration)}s.` }
    }

    return { valid: true, duration, width: dimensions.width, height: dimensions.height }
  } catch {
    return { valid: false, error: 'Could not read video metadata. The file may be corrupted.' }
  }
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

/**
 * Load image from file
 */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load image'))
    }
    
    img.src = url
  })
}

/**
 * Calculate new dimensions while maintaining aspect ratio
 */
function calculateDimensions(
  originalWidth: number,
  originalHeight: number,
  maxWidth: number,
  maxHeight: number
): { width: number; height: number } {
  let width = originalWidth
  let height = originalHeight
  
  // Calculate aspect ratio
  const aspectRatio = width / height
  
  // Resize if too large
  if (width > maxWidth) {
    width = maxWidth
    height = width / aspectRatio
  }
  
  if (height > maxHeight) {
    height = maxHeight
    width = height * aspectRatio
  }
  
  return {
    width: Math.round(width),
    height: Math.round(height)
  }
}

/**
 * Convert canvas to blob
 */
function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob)
        } else {
          reject(new Error('Failed to create blob from canvas'))
        }
      },
      mimeType,
      quality
    )
  })
}

/**
 * Validate image file before upload
 */
export type ImageValidationOptions = {
  maxFileSizeMB: number
  allowedMimeTypes?: string[]
}

const DEFAULT_ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/jpg']

export function validateImage(file: File, options: ImageValidationOptions): { valid: boolean; error?: string } {
  const { maxFileSizeMB, allowedMimeTypes = DEFAULT_ALLOWED_MIME_TYPES } = options

  const normalizedName = file.name?.toLowerCase() ?? ''
  const hasValidExtension = normalizedName.endsWith('.jpg') || normalizedName.endsWith('.jpeg') || normalizedName.endsWith('.png')
  const hasValidMime = allowedMimeTypes.includes(file.type.toLowerCase())

  if (!hasValidExtension || !hasValidMime) {
    return { valid: false, error: 'Only JPG/JPEG or PNG images are allowed.' }
  }

  const maxBytes = maxFileSizeMB * 1024 * 1024
  if (file.size > maxBytes) {
    return {
      valid: false,
      error: `Please upload an image smaller than ${maxFileSizeMB} MB.`,
    }
  }

  if (!file.name || file.name.length > 255) {
    return { valid: false, error: 'Invalid file name' }
  }

  return { valid: true }
}
