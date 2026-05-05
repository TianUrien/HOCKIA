/**
 * Shared per-(owner, friend) dismissal store for the
 * "ask Maria for a reference?" nudge. Used by both surfaces:
 *
 *   - Dashboard: RecentlyConnectedCard
 *   - Pulse feed: FriendshipReferencePulseCard
 *
 * Both surfaces ultimately ask the same question about the same pair, so
 * a dismissal on one should suppress the other. Storage is localStorage
 * (per-device) — same key shape RecentlyConnectedCard used historically
 * so existing dismissals carry over.
 *
 * 14-day cooldown per pair. Browsers that block localStorage simply
 * re-show the prompt — acceptable.
 */
import { logger } from '@/lib/logger'

const DISMISS_KEY_PREFIX = 'hockia-recently-connected-dismiss:'
export const DISMISS_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000

export function getReferenceNudgeDismissKey(ownerId: string, friendId: string): string {
  // Owner-scoped so dismissals don't leak across sign-ins on shared browsers.
  return `${DISMISS_KEY_PREFIX}${ownerId}:${friendId}`
}

export function isReferenceNudgeDismissed(
  ownerId: string,
  friendId: string,
  now: number = Date.now(),
): boolean {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false
    const raw = window.localStorage.getItem(getReferenceNudgeDismissKey(ownerId, friendId))
    if (!raw) return false
    const ts = Date.parse(raw)
    if (Number.isNaN(ts)) return false
    return now - ts < DISMISS_COOLDOWN_MS
  } catch {
    return false
  }
}

export function recordReferenceNudgeDismiss(ownerId: string, friendId: string): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    window.localStorage.setItem(
      getReferenceNudgeDismissKey(ownerId, friendId),
      new Date().toISOString(),
    )
  } catch (err) {
    logger.error('[referenceNudgeDismissal] failed to persist dismissal', err)
  }
}
