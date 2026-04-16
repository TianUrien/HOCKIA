import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'

/**
 * Hook that maintains a live set of blocked user IDs.
 * Used to filter blocked users' content from feeds, search, etc.
 * (Apple Guideline 1.2 — blocked content must be removed instantly)
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
      const { data } = await (supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types
        .from('user_blocks' as any)
        .select('blocked_id')
        .eq('blocker_id', user.id)) as { data: { blocked_id: string }[] | null }
      if (data) {
        setBlockedIds(new Set(data.map(r => r.blocked_id)))
      }
    } catch {
      // Fail open — don't block the feed on errors
    }
  }, [user])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { blockedIds, refresh }
}
