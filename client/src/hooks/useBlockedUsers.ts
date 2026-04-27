import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'

/**
 * Hook that maintains a live set of "blocked" user IDs as the bidirectional
 * union of both block directions:
 *   - users this user has blocked
 *   - users who have blocked this user
 *
 * Matches the semantics of public.is_blocked_pair on the server, which
 * is what enqueue_notification + the home feed RPC use. Bidirectional
 * hiding closes the harassment vector where X blocks me but I keep
 * tracking X's content unaware. (Apple Guideline 1.2)
 */
export function useBlockedUsers() {
  const { user } = useAuthStore()
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set())

  const refresh = useCallback(async () => {
    if (!user) {
      setBlockedIds(new Set())
      return
    }
    try {
      // Two queries instead of an OR-filter so RLS evaluates each path
      // independently — `OR (blocker_id = u OR blocked_id = u)` would
      // also scan the entire user_blocks table even with the index.
      const [blockedByMeRes, blockingMeRes] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types
        (supabase.from('user_blocks' as any).select('blocked_id').eq('blocker_id', user.id)),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types
        (supabase.from('user_blocks' as any).select('blocker_id').eq('blocked_id', user.id)),
      ])
      const blockedByMe = blockedByMeRes.data as { blocked_id: string }[] | null
      const blockingMe = blockingMeRes.data as { blocker_id: string }[] | null
      const set = new Set<string>()
      blockedByMe?.forEach(r => set.add(r.blocked_id))
      blockingMe?.forEach(r => set.add(r.blocker_id))
      setBlockedIds(set)
    } catch {
      // Fail open — don't block the feed on errors
    }
  }, [user])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { blockedIds, refresh }
}
