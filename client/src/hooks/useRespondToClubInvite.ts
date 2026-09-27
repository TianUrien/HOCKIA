import { useCallback } from 'react'
import { useNotificationStore } from '@/lib/notifications'
import { useToastStore } from '@/lib/toast'
import {
  CLUB_INVITE_ACCEPTED_MESSAGE,
  CLUB_INVITE_DECLINED_MESSAGE,
  CLUB_INVITE_ERROR_MESSAGE,
  CLUB_INVITE_UNAVAILABLE_MESSAGE,
} from '@/lib/clubInviteCopy'

/**
 * Accept / decline a squad invitation with the shared toasts. Every surface
 * (phone Requests, phone Activity, desktop drawer) goes through this, so the
 * copy and the "no longer available" handling never drift apart.
 */
export function useRespondToClubInvite() {
  const respondToClubInvite = useNotificationStore((s) => s.respondToClubInvite)
  const pendingClubInviteId = useNotificationStore((s) => s.pendingClubInviteId)
  // Whole-store read (not a selector) so it matches the drawer's existing usage.
  const { addToast } = useToastStore()

  const respond = useCallback(
    async (clubMemberId: string, action: 'accept' | 'decline'): Promise<boolean> => {
      const result = await respondToClubInvite({ clubMemberId, action })
      if (result === 'unavailable') {
        addToast(CLUB_INVITE_UNAVAILABLE_MESSAGE, 'neutral')
        return false
      }
      if (result !== true) {
        addToast(CLUB_INVITE_ERROR_MESSAGE, 'error')
        return false
      }
      addToast(action === 'accept' ? CLUB_INVITE_ACCEPTED_MESSAGE : CLUB_INVITE_DECLINED_MESSAGE, 'success')
      return true
    },
    [respondToClubInvite, addToast],
  )

  return { respond, pendingId: pendingClubInviteId }
}
