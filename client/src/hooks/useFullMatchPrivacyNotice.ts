import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { qk } from '@/lib/queryKeys'

export const FULL_MATCH_NOTICE_TYPE = 'full_match_privacy_default'

/**
 * The one-time "your full matches are now for clubs and coaches" notice.
 *
 * Stored server-side as a user_pulse_items row (one per player, inserted by
 * migration 20260926120000) so "seen" carries across phone, desktop and
 * native. get_my_pulse deliberately never returns this type (older app
 * builds would render an unknown card), so it is read directly here — RLS
 * limits user_pulse_items to the owner's own rows.
 */
export function useFullMatchPrivacyNotice() {
  const userId = useAuthStore((s) => s.user?.id ?? null)
  const isPlayer = useAuthStore((s) => s.profile?.role === 'player')
  const queryClient = useQueryClient()
  const { data } = useQuery({
    queryKey: qk.fullMatchPrivacyNotice(userId),
    enabled: !!userId && isPlayer,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data: row, error } = await supabase
        .from('user_pulse_items')
        .select('id')
        .eq('item_type', FULL_MATCH_NOTICE_TYPE)
        .is('dismissed_at', null)
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return (row as { id: string } | null)?.id ?? null
    },
  })

  /** Record the player's answer and hide the notice everywhere. `madePublic`
   *  also records the action (funnel: how many opened their full matches). */
  const resolveNotice = useCallback(async (madePublic: boolean) => {
    const k = qk.fullMatchPrivacyNotice(userId)
    const id = queryClient.getQueryData<string | null>(k) ?? null
    if (!id) return
    queryClient.setQueryData(k, null)
    try {
      if (madePublic) {
        const { error } = await supabase.rpc('mark_pulse_action_completed', { p_pulse_id: id })
        if (error) throw error
      }
      const { error } = await supabase.rpc('mark_pulse_dismissed', { p_pulse_id: id })
      if (error) throw error
    } catch (err) {
      logger.error('[useFullMatchPrivacyNotice] resolve failed', err)
    }
  }, [queryClient, userId])

  return { noticeId: data ?? null, resolveNotice }
}
