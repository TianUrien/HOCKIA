import { getImageUrl, getImageSrcSet, type ImageSize } from '@/lib/imageUrl'

/**
 * Photos already on screen, and photos warmed before anyone looks at them.
 *
 * Supabase renders a resized variant on its first request in each CDN region
 * (1 to 2 s measured in production, 2026-11-28) and serves it from the edge
 * after that (under 0.1 s). Two things follow:
 *
 * - A photo the grid already decoded should never be fetched again to show a
 *   placeholder: `rememberLoaded` keeps the exact URL the browser picked
 *   (`currentSrc`, so the srcset choice matches), and the Community preview
 *   paints it at once while the full-screen variant loads.
 * - A new upload should not leave its first viewer to pay the render:
 *   `warmUploadedPhoto` requests the variants the app shows, right after the
 *   upload, from the uploader's device.
 */

const loaded = new Map<string, string>()

/** The grid decoded `raw` from `currentSrc`. */
export function rememberLoaded(raw: string | null | undefined, currentSrc: string | null | undefined): void {
  if (!raw || !currentSrc) return
  loaded.set(raw, currentSrc)
}

/** The URL of a variant of `raw` already in the browser cache, if any. */
export function loadedVariant(raw: string | null | undefined): string | null {
  return raw ? loaded.get(raw) ?? null : null
}

const requested = new Set<string>()

/** Start downloading (and decoding) one URL once; best effort. */
export function preloadUrl(src: string | null | undefined): void {
  if (!src || typeof Image === 'undefined' || requested.has(src)) return
  requested.add(src)
  const img = new Image()
  img.decoding = 'async'
  img.src = src
  void img.decode?.().catch(() => undefined)
}

/** Download a stored photo at the size the app will show it. */
export function preloadPhoto(raw: string | null | undefined, size: ImageSize): void {
  if (!raw) return
  preloadUrl(getImageUrl(raw, size) ?? raw)
}

/** Every variant the app shows for a member photo: grid tile (both srcset widths) and full screen. */
const PHOTO_SIZES: ImageSize[] = ['gallery', 'immersive']
/** Profile photos also show as avatars. */
const AVATAR_SIZES: ImageSize[] = ['avatar-sm', 'avatar-md', 'avatar-lg', 'avatar-xl', 'gallery', 'immersive']

function variantUrls(raw: string, sizes: ImageSize[]): string[] {
  const urls: string[] = []
  for (const size of sizes) {
    const set = getImageSrcSet(raw, size)
    if (set) urls.push(...set.split(',').map((part) => part.trim().split(' ')[0]))
    else {
      const one = getImageUrl(raw, size)
      // Not a Supabase storage URL: there is no render to warm.
      if (one && one !== raw) urls.push(one)
    }
  }
  return [...new Set(urls)]
}

/**
 * Ask Supabase for the variants of a photo that was just uploaded, so the
 * render happens now rather than on a member's first look. Fire and forget:
 * the responses are discarded and failures are ignored.
 */
export function warmUploadedPhoto(raw: string | null | undefined, kind: 'photo' | 'avatar' = 'photo'): void {
  if (!raw || typeof fetch === 'undefined') return
  for (const url of variantUrls(raw, kind === 'avatar' ? AVATAR_SIZES : PHOTO_SIZES)) {
    void fetch(url, { mode: 'no-cors', credentials: 'omit' }).catch(() => undefined)
  }
}

/** Test hook. */
export function __resetImageWarm(): void {
  loaded.clear()
  requested.clear()
}
