/**
 * Image URL utility for serving right-sized images via Supabase Image Transformations.
 *
 * Instead of downloading a full 1200×1200 image for a 40px avatar,
 * this appends transform query params so Supabase resizes on the edge.
 *
 * Requires Image Transformations to be enabled in Supabase Dashboard
 * (Settings > Storage > Image Transformations).
 */

const SUPABASE_STORAGE_PATH = '/storage/v1/object/public/'
const SUPABASE_RENDER_PATH = '/storage/v1/render/image/public/'

export type ImageSize =
  | 'avatar-sm'   // 40px display (nav, feed card headers)
  | 'avatar-md'   // 80px display (profile cards, messages)
  | 'avatar-lg'   // 160px display (profile header)
  | 'avatar-xl'   // 240px display (profile hero, preview)
  | 'feed-thumb'  // Grid tiles in feed media grid
  | 'feed-full'   // Full-width feed image (single image post)
  | 'card-thumb'  // Small thumbnails in cards, lists
  | 'gallery'     // Gallery grid tiles
  | 'lightbox'    // Full-screen lightbox view
  | 'original'    // No transform — raw uploaded file

interface SizeConfig {
  width: number
  quality: number
}

// Widths account for 2× device pixel ratio. Qualities are tuned per surface:
// small, most-viewed avatars stay crisp (the Community card / list avatar is
// the app's most-seen image — premium feel matters there); larger hero/media
// presets were already high. WebP (added below) is sharper-per-byte than JPEG,
// so these look as good or better at a smaller size.
const SIZE_CONFIG: Record<ImageSize, SizeConfig> = {
  'avatar-sm':  { width: 80,   quality: 72 },
  'avatar-md':  { width: 160,  quality: 72 },
  'avatar-lg':  { width: 320,  quality: 75 },
  'avatar-xl':  { width: 480,  quality: 80 },
  'feed-thumb': { width: 400,  quality: 70 },
  'feed-full':  { width: 800,  quality: 80 },
  'card-thumb': { width: 200,  quality: 65 },
  'gallery':    { width: 400,  quality: 70 },
  'lightbox':   { width: 1200, quality: 85 },
  'original':   { width: 0,    quality: 0 },
}

/**
 * Transform a Supabase Storage public URL to serve a resized variant.
 *
 * @param url - The original public storage URL (or null/undefined)
 * @param size - The preset size to serve
 * @returns Transformed URL, or original URL if not a Supabase storage URL, or null
 *
 * @example
 * ```ts
 * getImageUrl(avatarUrl, 'avatar-sm')
 * // → https://xxx.supabase.co/storage/v1/render/image/public/avatars/uid/file.jpg?width=80&resize=contain&quality=60
 * ```
 */
export function getImageUrl(
  url: string | null | undefined,
  size: ImageSize = 'original'
): string | null {
  if (!url) return null
  if (size === 'original') return url

  // Only transform Supabase storage URLs
  if (!url.includes(SUPABASE_STORAGE_PATH)) return url

  const config = SIZE_CONFIG[size]
  const renderUrl = url.replace(SUPABASE_STORAGE_PATH, SUPABASE_RENDER_PATH)
  // IMPORTANT: Supabase's webp render FLATTENS the alpha channel (it composites
  // transparency onto a white background), so a webp transform turns a
  // transparent PNG logo into a white box on any tinted/colored surface. PNG
  // sources may carry transparency → omit format and let the render return PNG
  // (alpha preserved, still right-sized). JPEG/other sources are never
  // transparent → request webp for the ~30% size win. If a transform ever
  // fails, StorageImage.fallbackSrc falls back to the original full-size file.
  const isPng = url.split('?')[0].toLowerCase().endsWith('.png')
  const formatParam = isPng ? '' : '&format=webp'
  return `${renderUrl}?width=${config.width}&resize=contain&quality=${config.quality}${formatParam}`
}

/** Map Avatar component sizes to ImageSize presets */
export const AVATAR_SIZE_MAP: Record<string, ImageSize> = {
  sm: 'avatar-sm',
  md: 'avatar-sm',   // md displays at 40px, same as sm
  lg: 'avatar-md',   // lg displays at 64px
  xl: 'avatar-lg',   // xl displays at 96px
}
