import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { withTimeout } from '@/lib/retry'
import { toHappeningMoves, type HappeningMove } from '@/lib/happeningNow'
import type { HomeFeedItem } from '@/types/homeFeed'

/**
 * Market moves for the Pulse "Happening now" module, via the dedicated
 * get_market_moves RPC (a type-filtered home_feed_items read).
 *
 * Why not sample the merged feed: movement items are a MINORITY of feed rows
 * — the first 50 get_home_feed items are routinely all text posts +
 * references, so any client-side sample renders the module empty (Tian's QA
 * caught exactly that). The RPC filters server-side and applies the standing
 * fences itself (hidden authors, test accounts, bidirectional blocks).
 *
 * Query key nests under 'home-feed' so the existing pull-to-refresh
 * invalidation (prefix match) refreshes this too.
 */

const MAX_MOVES = 5

export function useHappeningNow(): { moves: HappeningMove[]; isLoading: boolean } {
  const query = useQuery<HomeFeedItem[]>({
    queryKey: ['home-feed', 'happening-now'],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await withTimeout(
        async () => await supabase.rpc('get_market_moves', { p_limit: MAX_MOVES }),
        10_000,
      )
      if (error) throw error
      return Array.isArray(data) ? (data as unknown as HomeFeedItem[]) : []
    },
  })

  const moves = useMemo(() => toHappeningMoves(query.data ?? [], MAX_MOVES), [query.data])

  return { moves, isLoading: query.isLoading }
}
