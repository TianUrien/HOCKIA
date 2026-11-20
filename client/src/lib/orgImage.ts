/**
 * Club crests and brand logos fitted by the crop step (2026-11-20).
 *
 * A fitted file is a finished square: the artwork is already centred, padded
 * or extended, so every tile shows it edge to edge and clips it with its own
 * radius. Files uploaded before the crop step are a centre crop of whatever
 * was picked, so they keep the older treatment (fitted inside the tile).
 *
 * The marker is in the file name, so it travels with the URL every surface
 * already receives: no column, and older app builds are not affected.
 *   <owner>/<kind>_fit_<stamp>.<ext>   the square that is shown
 *   <owner>/<kind>_orig_<stamp>.<ext>  the picked file in its own shape, kept for a later re-crop
 */
const FIT_MARK = '_fit_'
const ORIGINAL_MARK = '_orig_'
const FITTED = /\/(crest|logo)_fit_\d+\.(png|jpe?g)$/i

export type OrgImageKind = 'crest' | 'logo'

function pathOf(url: string): string {
  return url.split(/[?#]/)[0]
}

/** True for a crest or logo stored by the crop step. */
export function isFittedOrgImage(url: string | null | undefined): boolean {
  return Boolean(url) && FITTED.test(pathOf(url as string))
}

export function orgImagePaths(ownerId: string, kind: OrgImageKind, stamp: number, ext: 'png' | 'jpg'): { fitted: string; original: string } {
  return {
    fitted: `${ownerId}/${kind}${FIT_MARK}${stamp}.${ext}`,
    original: `${ownerId}/${kind}${ORIGINAL_MARK}${stamp}.${ext}`,
  }
}

/** The kept original that belongs to a fitted URL (same folder, stamp and extension), or null. */
export function orgOriginalUrl(url: string | null | undefined): string | null {
  if (!url || !isFittedOrgImage(url)) return null
  const path = pathOf(url)
  const cut = path.lastIndexOf(FIT_MARK)
  return `${path.slice(0, cut)}${ORIGINAL_MARK}${path.slice(cut + FIT_MARK.length)}`
}

/** The one shape for a crest or logo tile: a rounded square, radius 25 % of its side. */
export const ORG_SHAPE = 'rounded-[25%]'

/**
 * Classes for the image inside a crest or logo tile (the tile is `relative`,
 * `overflow-hidden` and white). Fitted: edge to edge, clipped by the tile.
 * Older upload: inside the tile, whole, with rounded corners of its own.
 */
export function orgImageClass(url: string | null | undefined): string {
  return isFittedOrgImage(url)
    ? 'absolute inset-0 h-full w-full object-cover'
    : 'absolute inset-[8%] h-[84%] w-[84%] rounded-[18%] object-contain'
}
