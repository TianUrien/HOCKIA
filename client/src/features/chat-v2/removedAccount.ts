import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

/** Shown word for word in the chat and in the in-app notice (server copy). */
export const REMOVED_ACCOUNT_NOTICE =
  "An account that messaged you has been removed for spam. Hockia will never ask you for money. Don't send money, crypto or personal details to people you haven't met, and be careful if someone asks to move to WhatsApp or another app. If something feels off, tap Report."

const cache = new Map<string, boolean>()

/** Test seam: forget what earlier renders learned. */
export function resetRemovedAccountCache(): void {
  cache.clear()
}

/**
 * Is the other member of this conversation an account Hockia removed? The
 * server only answers "yes" to someone who has a conversation with that
 * account. One small read per participant per session; any failure (an older
 * backend, offline) reads as "no".
 */
export function useIsRemovedAccount(participantId: string | null | undefined, enabled = true): boolean {
  const id = enabled && participantId ? participantId : null
  const [removed, setRemoved] = useState<boolean>(() => (id ? cache.get(id) ?? false : false))
  useEffect(() => {
    if (!id) { setRemoved(false); return }
    const hit = cache.get(id)
    if (hit !== undefined) { setRemoved(hit); return }
    setRemoved(false)
    let cancelled = false
    try {
      void Promise.resolve(supabase.rpc('is_removed_account', { p_profile_id: id }))
        .then((result) => {
          if (!result || result.error) return
          const value = result.data === true
          cache.set(id, value)
          if (!cancelled) setRemoved(value)
        })
        .catch(() => { /* reads as "no" */ })
    } catch {
      /* reads as "no" */
    }
    return () => { cancelled = true }
  }, [id])
  return removed
}
