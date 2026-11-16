import { extractErrorMessage } from '@/lib/utils'
import { tProfile } from '@/i18n/ns/profile'

/**
 * Founder ruling: every blocked / hidden friend-request case reads the same,
 * whoever blocked whom — never the raw database text.
 */
export const FRIEND_REQUEST_BLOCKED_MESSAGE = "This person isn't accepting requests."

/** The blocked line in the interface language (the constant above is its English text). */
export function friendRequestBlockedMessage(): string {
  return tProfile('friendshipErrors.blocked')
}

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
  if (isFriendRequestBlockedError(error)) return friendRequestBlockedMessage()
  const msg = extractErrorMessage(error, fallback)
  // Never echo other raw trigger text either.
  return /blocked|not available/i.test(msg) ? friendRequestBlockedMessage() : msg
}

/** Toast colour for a friend-request failure: the blocked line is a quiet
 *  grey info toast (founder ruling), anything else stays an error. */
export function friendRequestToastType(message: string): 'neutral' | 'error' {
  return message === FRIEND_REQUEST_BLOCKED_MESSAGE || message === friendRequestBlockedMessage() ? 'neutral' : 'error'
}
