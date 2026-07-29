/**
 * Read hooks for the precomputed publisher_responsiveness table (Task 2).
 *
 * The table is tiny (one row per publisher with recent resolved
 * applications, refreshed daily at 02:30 UTC), publicly readable, and
 * absence of a row/tier IS the neutral state — so both readers resolve to
 * null quietly and the badge renders nothing.
 */
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { queryClient } from '@/lib/queryClient'
import { qk } from '@/lib/queryKeys'
import type { ResponsivenessTier } from '@/components/ResponsivenessBadge'

// Values only move on the daily snapshot — a long client freshness
// window is safe.
const STALE_TIME = 10 * 60_000

/** Tier for ONE publisher (club profile hero). */
export function usePublisherResponsiveness(publisherId: string | null | undefined): ResponsivenessTier | null {
  const id = publisherId ?? null
  const { data, error } = useQuery({
    queryKey: qk.publisherTier(id),
    enabled: !!id,
    staleTime: STALE_TIME,
    queryFn: async () => {
      const { data: row } = await supabase
        .from('publisher_responsiveness')
        .select('tier')
        .eq('publisher_id', id as string)
        .maybeSingle()
      return (row?.tier as ResponsivenessTier | null) ?? null
    },
  })
  // Neutral on any failure — never block a profile.
  if (error) return null
  return data ?? null
}

/** Tiers for MANY publishers at once (opportunity cards) — one query per page.
 *  Non-hook helper: fetchQuery gives the same dedupe + freshness window
 *  through the app-wide QueryClient. */
export async function fetchResponsivenessTiers(
  publisherIds: string[],
): Promise<Map<string, ResponsivenessTier>> {
  const ids = Array.from(new Set(publisherIds.filter(Boolean))).sort()
  if (ids.length === 0) return new Map()
  try {
    return await queryClient.fetchQuery({
      queryKey: qk.publisherTierBatch(ids),
      staleTime: STALE_TIME,
      queryFn: async () => {
        const { data } = await supabase
          .from('publisher_responsiveness')
          .select('publisher_id, tier')
          .in('publisher_id', ids)
          .not('tier', 'is', null)
        const map = new Map<string, ResponsivenessTier>()
        for (const row of data ?? []) {
          if (row.tier) map.set(row.publisher_id, row.tier as ResponsivenessTier)
        }
        return map
      },
    })
  } catch {
    return new Map() // neutral on failure
  }
}
