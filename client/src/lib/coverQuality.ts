/**
 * Low-resolution covers (design audit 2026-10-21, Batch C; covers-and-crests
 * rule): a cover photo narrower than 600 px is upscaled into mush on a hero,
 * so it falls back to the crest-gradient cover instead. Checked on the
 * loaded image's natural width.
 */
export const MIN_COVER_WIDTH = 600

export function isLowResCover(naturalWidth: number | null | undefined): boolean {
  return typeof naturalWidth === 'number' && naturalWidth > 0 && naturalWidth < MIN_COVER_WIDTH
}
