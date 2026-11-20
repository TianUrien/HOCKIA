import { uploadProfilePhoto, type ProfilePhotoUrls } from '@/lib/profilePhoto'
import { uploadOrgImage } from '@/lib/orgImageUpload'
import type { ImageKind } from '@/lib/imageFit'

/** Which kind of identity image a role uploads: clubs a crest, brands a logo, everyone else a photo. */
export function imageKindForRole(role: string | null | undefined): ImageKind {
  const r = role?.toLowerCase()
  return r === 'club' ? 'crest' : r === 'brand' ? 'logo' : 'person'
}

/**
 * Store the square from the crop step. People also keep the photo in its own
 * shape (`avatar_full_url`); crests and logos keep the picked file next to
 * the fitted square (see lib/orgImage.ts).
 */
export async function uploadIdentityImage(userId: string, kind: ImageKind, file: File, square: File): Promise<ProfilePhotoUrls> {
  if (kind === 'person') return uploadProfilePhoto(userId, file, { square })
  return { avatarUrl: await uploadOrgImage(userId, kind, square, file), avatarFullUrl: null }
}
