import { useEffect } from 'react'
import { useAuthStore } from '@/lib/auth'
import { useOpportunityNotificationStore } from '@/lib/opportunityNotifications'

export function useOpportunityNotifications() {
  const userId = useAuthStore(state => state.user?.id ?? null)
  const role = useAuthStore(state => state.profile?.role ?? null)
  const count = useOpportunityNotificationStore(state => state.count)
  const lastSeenAt = useOpportunityNotificationStore(state => state.lastSeenAt)
  const initialize = useOpportunityNotificationStore(state => state.initialize)
  const markSeen = useOpportunityNotificationStore(state => state.markSeen)
  const refresh = useOpportunityNotificationStore(state => state.refresh)
  const subscribe = useOpportunityNotificationStore(state => state.subscribe)
  const unsubscribe = useOpportunityNotificationStore(state => state.unsubscribe)

  // Only players/coaches can apply to opportunities today (vacancy RLS enforces
  // role + opportunity_type match). Gate here so umpires/clubs/brands don't
  // poll the RPC, hit opportunity_inbox_state (406 for never-applied users),
  // or see a "new opportunities" badge for vacancies they can't act on.
  const eligibleUserId = role === 'player' || role === 'coach' ? userId : null

  // Track subscriber count for proper interval cleanup
  useEffect(() => {
    subscribe()
    return () => {
      unsubscribe()
    }
  }, [subscribe, unsubscribe])

  // Initialize when userId changes
  useEffect(() => {
    void initialize(eligibleUserId)
  }, [initialize, eligibleUserId])

  return {
    count,
    lastSeenAt,
    markSeen,
    refresh
  }
}
