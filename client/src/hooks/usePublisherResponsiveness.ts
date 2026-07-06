/**
 * Read hooks for the precomputed publisher_responsiveness table (Task 2).
 *
 * The table is tiny (one row per publisher with recent resolved
 * applications, refreshed daily at 02:30 UTC), publicly readable, and
 * absence of a row/tier IS the neutral state — so both hooks resolve to
 * null quietly and the badge renders nothing.
 */
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { requestCache } from '@/lib/requestCache'
import type { ResponsivenessTier } from '@/components/ResponsivenessBadge'

// Values only move on the daily snapshot — a long client TTL is safe.
const TTL = 10 * 60_000

/** Tier for ONE publisher (club profile hero). */
export function usePublisherResponsiveness(publisherId: string | null | undefined): ResponsivenessTier | null {
  const [tier, setTier] = useState<ResponsivenessTier | null>(null)

  useEffect(() => {
    if (!publisherId) {
      setTier(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const result = await requestCache.dedupe(
          `publisher-responsiveness-${publisherId}`,
          async () => {
            const { data } = await supabase
              .from('publisher_responsiveness')
              .select('tier')
              .eq('publisher_id', publisherId)
              .maybeSingle()
            return (data?.tier as ResponsivenessTier | null) ?? null
          },
          TTL,
        )
        if (!cancelled) setTier(result)
      } catch {
        if (!cancelled) setTier(null) // neutral on any failure — never block a profile
      }
    })()
    return () => {
      cancelled = true
    }
  }, [publisherId])

  return tier
}

/** Tiers for MANY publishers at once (opportunity cards) — one query per page. */
export async function fetchResponsivenessTiers(
  publisherIds: string[],
): Promise<Map<string, ResponsivenessTier>> {
  const ids = Array.from(new Set(publisherIds.filter(Boolean))).sort()
  if (ids.length === 0) return new Map()
  try {
    return await requestCache.dedupe(
      `publisher-responsiveness-batch-${ids.join(',')}`,
      async () => {
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
      TTL,
    )
  } catch {
    return new Map() // neutral on failure
  }
}
