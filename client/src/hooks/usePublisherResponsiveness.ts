/**
 * Read hook for the precomputed publisher_responsiveness table (Task 2).
 *
 * The table is tiny (one row per publisher with recent resolved
 * applications, refreshed daily at 02:30 UTC) and absence of a row/tier IS
 * the neutral state — the reader resolves to null quietly.
 *
 * Founder ruling 2026-09-25: the public "Responds within ~X" badge is gone
 * everywhere (players never see reply-time estimates; the club's own hero
 * no longer shows it either). The only remaining reader is the club's own
 * Pulse nudge (ApplicantsToReview). A future badge would be computed
 * server-side.
 */
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { qk } from '@/lib/queryKeys'

export type ResponsivenessTier = 'fast' | 'week' | 'two_weeks'

// Values only move on the daily snapshot — a long client freshness
// window is safe.
const STALE_TIME = 10 * 60_000

/** Tier for ONE publisher (the club's own Pulse nudge). */
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
