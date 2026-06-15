/**
 * percent — count → percentage-of-denominator helper for admin metrics.
 *
 * The Admin Portal shows raw counts everywhere; the founder asked that
 * every metric also carry "X% of <denominator>" so volume is read with
 * context (e.g. "20 completed profile · 18% of total users"). This is the
 * single source of truth for that division so rounding + the divide-by-zero
 * guard stay consistent across every page.
 *
 * Returns null when the denominator is missing / zero (no meaningful
 * percentage) — callers should hide the percentage line in that case, which
 * the StatCard `percent` prop does automatically.
 */
export function pct(
  numerator: number | null | undefined,
  denominator: number | null | undefined,
  decimals = 0,
): number | null {
  if (numerator == null || denominator == null || denominator <= 0) return null
  const factor = 10 ** decimals
  return Math.round((numerator / denominator) * 100 * factor) / factor
}
