import { extractErrorMessage } from '@/lib/utils'

/**
 * Founder ruling: every blocked / hidden friend-request case reads the same,
 * whoever blocked whom — never the raw database text.
 */
export const FRIEND_REQUEST_BLOCKED_MESSAGE = "This person isn't accepting requests."

// The friendship trigger's refusals (enforce_friendship_not_blocked):
// a block in either direction, or an account that can't be contacted
// (age gate, frozen, not onboarded).
const BLOCKED_PATTERNS = [
  /friend request to a user you have blocked/i,
  /who has blocked you/i,
  /user is not available right now/i,
  /not available right now/i,
]

export function isFriendRequestBlockedError(error: unknown): boolean {
  if (!error) return false
  const raw = typeof error === 'string'
    ? error
    : typeof error === 'object' && error !== null && typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message: string }).message
      : ''
  return BLOCKED_PATTERNS.some((re) => re.test(raw))
}

/** The toast for a failed send / accept: the blocked line, or a friendly fallback. */
export function friendRequestErrorMessage(error: unknown, fallback: string): string {
  if (isFriendRequestBlockedError(error)) return FRIEND_REQUEST_BLOCKED_MESSAGE
  const msg = extractErrorMessage(error, fallback)
  // Never echo other raw trigger text either.
  return /blocked|not available/i.test(msg) ? FRIEND_REQUEST_BLOCKED_MESSAGE : msg
}
