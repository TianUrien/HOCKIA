/**
 * Native image picker for Capacitor iOS/Android apps.
 *
 * On native platforms, uses @capacitor/camera which properly handles
 * camera permissions, the native photo picker, and image capture.
 *
 * On web, returns null so callers fall back to standard HTML file input.
 */
import { Capacitor } from '@capacitor/core'
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera'
import { logger } from './logger'

export interface NativeImageResult {
  /** Base64-encoded image data (without the data URI prefix) */
  base64: string
  /** MIME type (e.g. image/jpeg) */
  mimeType: string
  /** Constructed File object ready for upload */
  file: File
}

/** Returns true when running inside Capacitor native shell (iOS/Android). */
export const isNativePlatform = (): boolean => Capacitor.isNativePlatform()

/**
 * Open the native image picker (camera + gallery).
 * Returns a File object on success, or null if the user cancelled.
 * Throws on unexpected errors.
 */
export async function pickImageNative(source?: 'camera' | 'photos' | 'prompt'): Promise<NativeImageResult | null> {
  if (!isNativePlatform()) return null

  try {
    const cameraSource =
      source === 'camera' ? CameraSource.Camera
        : source === 'photos' ? CameraSource.Photos
          : CameraSource.Prompt // Shows both options

    const photo = await Camera.getPhoto({
      quality: 92,
      allowEditing: true,
      resultType: CameraResultType.Base64,
      source: cameraSource,
      // Profile photos and crests: big enough for the full-screen Community photo (was 1024).
      width: 2048,
      height: 2048,
      correctOrientation: true,
      presentationStyle: 'popover', // Required for iPad — fullScreen can crash
    })

    if (!photo.base64String) {
      return null
    }

    const mimeType = photo.format === 'png' ? 'image/png' : 'image/jpeg'
    const extension = photo.format === 'png' ? 'png' : 'jpg'

    // Convert base64 to File object for consistent handling with web uploads
    const byteCharacters = atob(photo.base64String)
    const byteNumbers = new Uint8Array(byteCharacters.length)
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i)
    }
    const blob = new Blob([byteNumbers], { type: mimeType })
    const file = new File([blob], `photo.${extension}`, { type: mimeType })

    return {
      base64: photo.base64String,
      mimeType,
      file,
    }
  } catch (err: unknown) {
    // User cancelled — not an error
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('cancelled') || message.includes('canceled') || message.includes('User cancelled')) {
      return null
    }
    logger.error('[nativeImagePicker] Error picking image:', err)
    throw err
  }
}
