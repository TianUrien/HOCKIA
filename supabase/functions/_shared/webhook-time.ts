/** Cloudflare Stream webhook: largest accepted age (and future skew) of the signed timestamp. */
export const WEBHOOK_MAX_SKEW_SECONDS = 300

/** True when the signed `time` (unix seconds) is within ±maxSkew of now. */
export function isFreshWebhookTimestamp(
  timeSeconds: number,
  nowMs: number = Date.now(),
  maxSkewSeconds: number = WEBHOOK_MAX_SKEW_SECONDS,
): boolean {
  if (!Number.isFinite(timeSeconds)) return false
  return Math.abs(nowMs / 1000 - timeSeconds) <= maxSkewSeconds
}
