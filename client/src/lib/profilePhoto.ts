import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { optimizeAvatarImage, optimizeImage } from '@/lib/imageOptimization'

/**
 * A person's profile photo is stored twice (2026-10-23, migration 20261023120000):
 * - avatar_url: a 1440 px square, for the round avatars everywhere;
 * - avatar_full_url: the same photo in its own shape, up to 2048 px, for
 *   full-screen views (the Community member deck).
 * Write both in the same profiles update. A writer that only sets avatar_url
 * gets avatar_full_url cleared by the database, never a stale full photo.
 */
export interface ProfilePhotoUrls {
  avatarUrl: string
  /** null when the full-shape upload failed: the square still works everywhere. */
  avatarFullUrl: string | null
}

const FULL_OPTIONS = { maxWidth: 2048, maxHeight: 2048, maxSizeMB: 3, quality: 0.85, mimeType: 'image/jpeg' }

/** The profile-row fields for a new photo. */
export function profilePhotoFields(urls: ProfilePhotoUrls): { avatar_url: string; avatar_full_url: string | null } {
  return { avatar_url: urls.avatarUrl, avatar_full_url: urls.avatarFullUrl }
}

/**
 * Upload both files under the member's own folder; returns their public URLs.
 * `full: false` (crests, logos) and PNG sources (often transparent: JPEG would
 * put them on black) upload the square only.
 */
export async function uploadProfilePhoto(userId: string, file: File, { full = true }: { full?: boolean } = {}): Promise<ProfilePhotoUrls> {
  const stamp = Date.now()
  const square = await optimizeAvatarImage(file)
  const ext = square.name.split('.').pop() || 'jpg'
  const path = `${userId}/avatar_${stamp}.${ext}`
  const { error } = await supabase.storage.from('avatars').upload(path, square, { upsert: true, cacheControl: '31536000' })
  if (error) throw error
  const avatarUrl = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl

  let avatarFullUrl: string | null = null
  if (!full || file.type === 'image/png') return { avatarUrl, avatarFullUrl }
  try {
    const fullFile = await optimizeImage(file, FULL_OPTIONS)
    const fullPath = `${userId}/avatar_full_${stamp}.jpg`
    const { error: fullError } = await supabase.storage.from('avatars').upload(fullPath, fullFile, { contentType: 'image/jpeg', upsert: true, cacheControl: '31536000' })
    if (fullError) throw fullError
    avatarFullUrl = supabase.storage.from('avatars').getPublicUrl(fullPath).data.publicUrl
  } catch (err) {
    logger.warn('[profilePhoto] full-shape upload failed; keeping the square only', err)
  }
  return { avatarUrl, avatarFullUrl }
}
