/**
 * useMyPulse — owner-side hook for the Hockia Pulse / Movement Layer.
 *
 * Fetches the active (non-dismissed) pulse items for the signed-in user
 * and exposes mark-* mutations with optimistic updates. Wraps the v5-plan
 * helper RPCs (get_my_pulse, mark_pulse_seen/clicked/dismissed/...).
 *
 * The four lifecycle timestamps (seen / clicked / action_completed /
 * dismissed) form a funnel — analytics measures each step, so we use
 * COALESCE-style optimistic stamping on the client too: if the timestamp
 * is already set, we don't overwrite it. Mirrors the SQL idempotency.
 *
 * Phase 1B.2: hook + frontend surface ship without any card types yet.
 * Card types start landing in 1B.3 (Snapshot Gain Celebration first).
 */
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'
import type { Database } from '@/lib/database.types'

export type PulseItem = Database['public']['Tables']['user_pulse_items']['Row']

interface UseMyPulseResult {
  items: PulseItem[]
  isLoading: boolean
  error: string | null
  refetch: () => Promise<void>
  markSeen: (ids: string[]) => Promise<void>
  markClicked: (id: string) => Promise<void>
  markDismissed: (id: string) => Promise<void>
  markActionCompleted: (id: string) => Promise<void>
}

const DEFAULT_LIMIT = 20

export function useMyPulse(): UseMyPulseResult {
  const userId = useAuthStore((state) => state.user?.id)
  const [items, setItems] = useState<PulseItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refetch = useCallback(async () => {
    if (!userId) {
      setItems([])
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)
    try {
      const { data, error: rpcError } = await supabase.rpc('get_my_pulse', { p_limit: DEFAULT_LIMIT })
      if (rpcError) throw rpcError
      setItems((data as PulseItem[]) ?? [])
    } catch (err) {
      // Supabase RPC errors are plain objects { message, code, … } — not
      // Error instances — so we duck-type for `.message` rather than
      // bailing through `err instanceof Error`. Same pattern as the
      // existing useSearchAppearances handler.
      const message =
        (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string')
          ? err.message
          : 'Failed to load pulse items'
      logger.error('[useMyPulse] fetch failed', err)
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }, [userId])

  useEffect(() => {
    void refetch()
  }, [refetch])

  // ── Lifecycle mutations ──────────────────────────────────────────────
  // All four mutations apply optimistically client-side first, then call
  // the RPC. On RPC failure we log + leave the optimistic update in place
  // (the next refetch reconciles). Server timestamps win on read.

  const markSeen = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return
      const now = new Date().toISOString()

      // Optimistic: stamp seen_at on any item still NULL.
      setItems((prev) =>
        prev.map((item) =>
          ids.includes(item.id) && !item.seen_at ? { ...item, seen_at: now } : item,
        ),
      )

      try {
        const { error: rpcError } = await supabase.rpc('mark_pulse_seen', { p_pulse_ids: ids })
        if (rpcError) throw rpcError
      } catch (err) {
        // Non-fatal: the next refetch will reconcile if the RPC genuinely failed.
        // Keeping the optimistic stamp avoids re-firing seen tracking on every render.
        logger.error('[useMyPulse] markSeen failed', err)
      }
    },
    [],
  )

  const markClicked = useCallback(async (id: string) => {
    const now = new Date().toISOString()

    setItems((prev) =>
      prev.map((item) =>
        item.id === id
          ? { ...item, clicked_at: item.clicked_at ?? now, seen_at: item.seen_at ?? now }
          : item,
      ),
    )

    try {
      const { error: rpcError } = await supabase.rpc('mark_pulse_clicked', { p_pulse_id: id })
      if (rpcError) throw rpcError
    } catch (err) {
      logger.error('[useMyPulse] markClicked failed', err)
    }
  }, [])

  const markDismissed = useCallback(async (id: string) => {
    // Optimistic: remove from the visible list immediately. The frontend
    // filters dismissed items out of the feed, so the user sees instant
    // disappearance. The next refetch confirms.
    const previous = items
    setItems((prev) => prev.filter((item) => item.id !== id))

    try {
      const { error: rpcError } = await supabase.rpc('mark_pulse_dismissed', { p_pulse_id: id })
      if (rpcError) throw rpcError
    } catch (err) {
      logger.error('[useMyPulse] markDismissed failed', err)
      // On failure, restore the item so the user knows the action didn't land.
      setItems(previous)
    }
  }, [items])

  const markActionCompleted = useCallback(async (id: string) => {
    const now = new Date().toISOString()

    setItems((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              action_completed_at: item.action_completed_at ?? now,
              clicked_at: item.clicked_at ?? now,
              seen_at: item.seen_at ?? now,
            }
          : item,
      ),
    )

    try {
      const { error: rpcError } = await supabase.rpc('mark_pulse_action_completed', { p_pulse_id: id })
      if (rpcError) throw rpcError
    } catch (err) {
      logger.error('[useMyPulse] markActionCompleted failed', err)
    }
  }, [])

  return {
    items,
    isLoading,
    error,
    refetch,
    markSeen,
    markClicked,
    markDismissed,
    markActionCompleted,
  }
}
