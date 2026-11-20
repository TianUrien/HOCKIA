import { supabase } from './supabase'
import { logger } from './logger'
import { orgOriginalUrl } from './orgImage'

const PUBLIC_OBJECT_PREFIX = '/storage/v1/object/public/'

type DeleteArgs = {
  bucket: string
  /** Optional path relative to the bucket (e.g. user-id/file.png) */
  path?: string | null
  /** Public URL pointing to the object; used when path is unknown */
  publicUrl?: string | null
  /** Helpful text to surface in logs when deletions fail */
  context?: string
}

/**
 * Extracts the bucket-relative path from a Supabase public URL. Handles both modern and
 * legacy URL shapes (with or without the /storage/v1/object/public prefix).
 */
export const extractStoragePath = (url: string | null | undefined, bucket: string): string | null => {
  if (!url) return null

  try {
    const parsed = new URL(url)
    url = parsed.pathname + parsed.search
  } catch (error) {
    // Not a full URL, fall back to the provided string
    void error
  }

  const normalized = url.replace(/\?.*/, '')
  const publicMarker = `${PUBLIC_OBJECT_PREFIX}${bucket}/`
  const fallbackMarker = `${bucket}/`

  if (normalized.includes(publicMarker)) {
    return normalized.slice(normalized.indexOf(publicMarker) + publicMarker.length)
  }

  if (normalized.includes(fallbackMarker)) {
    return normalized.slice(normalized.indexOf(fallbackMarker) + fallbackMarker.length)
  }

  return null
}

/**
 * Removes a single object from Supabase Storage. Returns true when a deletion attempt was
 * made (and logged) so callers can continue without throwing user-facing errors when cleanup
 * fails silently.
 */
export const deleteStorageObject = async ({ bucket, path, publicUrl, context }: DeleteArgs): Promise<boolean> => {
  const targetPath = path ?? extractStoragePath(publicUrl, bucket)
  if (!targetPath) {
    logger.debug('[storage] No valid path to delete', { bucket, context })
    return false
  }

  // A fitted crest or logo has its picked file kept next to it (lib/orgImage.ts):
  // the two go together on every path, so no caller can leave the original behind.
  const companion = orgOriginalUrl(targetPath)
  const paths = companion ? [targetPath, companion] : [targetPath]

  try {
    const { error } = await supabase.storage.from(bucket).remove(paths)
    if (error) {
      throw error
    }

    logger.debug('[storage] Deleted object', { bucket, path: targetPath, companion, context })
    return true
  } catch (error) {
    logger.error('[storage] Failed to delete object', { bucket, path: targetPath, context, error })
    return false
  }
}
