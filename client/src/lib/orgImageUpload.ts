import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { imageFileExtension, optimizeImage } from '@/lib/imageOptimization'
import { deleteStorageObject } from '@/lib/storage'
import { orgImagePaths, type OrgImageKind } from '@/lib/orgImage'

const BUCKET = 'avatars'
const CACHE = '31536000'
/** The kept original: its own shape, at most 2048 px, same type as the square. */
const ORIGINAL_OPTIONS = { maxWidth: 2048, maxHeight: 2048, maxSizeMB: 3, quality: 0.9 }

/**
 * Store a fitted crest or logo under the owner's folder and return its public
 * URL. The picked file is kept next to it; if that second upload fails the
 * square still works everywhere.
 */
export async function uploadOrgImage(ownerId: string, kind: OrgImageKind, square: File, original: File): Promise<string> {
  const ext = imageFileExtension(square)
  const paths = orgImagePaths(ownerId, kind, Date.now(), ext)
  const { error } = await supabase.storage.from(BUCKET).upload(paths.fitted, square, { contentType: square.type, upsert: true, cacheControl: CACHE })
  if (error) throw error
  try {
    const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg'
    const kept = await optimizeImage(original, { ...ORIGINAL_OPTIONS, mimeType })
    const { error: keptError } = await supabase.storage.from(BUCKET).upload(paths.original, kept, { contentType: mimeType, upsert: true, cacheControl: CACHE })
    if (keptError) throw keptError
  } catch (err) {
    logger.warn('[orgImage] original not kept; the fitted square is stored', err)
  }
  return supabase.storage.from(BUCKET).getPublicUrl(paths.fitted).data.publicUrl
}

/**
 * Remove a replaced crest or logo. The original kept with it goes in the same
 * call: deleteStorageObject removes the pair for any fitted file.
 */
export function deleteOrgImage(publicUrl: string | null | undefined, context: string): void {
  if (!publicUrl) return
  void deleteStorageObject({ bucket: BUCKET, publicUrl, context })
}
