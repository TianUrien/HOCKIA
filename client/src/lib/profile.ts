import { useAuthStore } from './auth'
import { logger } from './logger'

// Pure helpers re-exported from profileHelpers so callers can import either
// the auth-coupled `invalidateProfile` (this file) or the pure helpers
// (profileHelpers.ts) without dragging the supabase init chain through tests.
export { derivePublicContactEmail, getFirstName, greetingName } from './profileHelpers'

interface InvalidateProfileOptions {
  userId?: string
  reason?: string
}

/**
 * Central helper to bust the profile cache and refetch the latest copy.
 * Falls back to the currently authenticated user when no id is provided.
 */
export async function invalidateProfile({ userId, reason }: InvalidateProfileOptions = {}) {
  const { user, fetchProfile } = useAuthStore.getState()
  const targetUserId = userId ?? user?.id

  if (!targetUserId) {
    logger.warn('[PROFILE] Tried to invalidate profile without user id', { reason })
    return
  }

  if (reason) {
    logger.debug('[PROFILE] Invalidating profile cache', { userId: targetUserId, reason })
  }

  await fetchProfile(targetUserId, { force: true })
}
