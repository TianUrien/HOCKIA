/** Most dots shown at once under a carousel (Instagram-style). */
export const MAX_DOTS = 5

/**
 * Which dots to draw for `count` items with `index` current: all of them up
 * to MAX_DOTS, else a MAX_DOTS-wide window that keeps the current dot as
 * central as the ends allow. `end` is exclusive.
 */
export function dotWindow(count: number, index: number): { start: number; end: number } {
  if (count <= MAX_DOTS) return { start: 0, end: count }
  const start = Math.min(Math.max(index - Math.floor(MAX_DOTS / 2), 0), count - MAX_DOTS)
  return { start, end: start + MAX_DOTS }
}
