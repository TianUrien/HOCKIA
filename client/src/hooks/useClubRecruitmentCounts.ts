import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { requestCache } from '@/lib/requestCache'
import { logger } from '@/lib/logger'

/**
 * useClubRecruitmentCounts — open opportunities + applicant totals for a
 * club owner, for the #recruitment-summary card.
 *
 * IMPORTANT — no extra query: this reuses the EXACT cache key + fetch shape
 * of CoachPostedOpportunitiesCard (`coach-posted-opportunities-card-<id>`),
 * via requestCache.dedupe. The summary card renders ABOVE the bento, so its
 * fetch runs first and caches the SUPERSET (open + total + pending); the
 * existing posted-opportunities tile then dedupes onto the same cached
 * result (it only reads open + total, ignoring the extra `pending`). The
 * shared coach card is left untouched — coaches are unaffected.
 *
 * Counts mirror the tile exactly: open = opportunities with status='open';
 * applicants/pending summed across the club's OPEN opportunities only
 * (p_include_closed=false), so the numbers match what the recruiter sees
 * inside the management surface.
 */
export interface ClubRecruitmentCounts {
  /** Opportunities with status='open'. */
  open: number
  /** Total applicants across open opportunities. */
  applicants: number
  /** Pending (not-yet-actioned) applicants across open opportunities. */
  pending: number
}

export function useClubRecruitmentCounts(ownerId: string | null | undefined): {
  counts: ClubRecruitmentCounts | null
  loading: boolean
} {
  const [counts, setCounts] = useState<ClubRecruitmentCounts | null>(null)
  const [loading, setLoading] = useState<boolean>(Boolean(ownerId))

  useEffect(() => {
    if (!ownerId) {
      setCounts(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    // SAME key as CoachPostedOpportunitiesCard → one shared fetch, deduped.
    const cacheKey = `coach-posted-opportunities-card-${ownerId}`
    ;(async () => {
      try {
        const result = await requestCache.dedupe<ClubRecruitmentCounts>(
          cacheKey,
          async () => {
            const openRes = await supabase
              .from('opportunities')
              .select('id', { count: 'exact', head: true })
              .eq('club_id', ownerId)
              .eq('status', 'open')
            if (openRes.error) throw openRes.error

            const appsRes = await supabase.rpc('fetch_club_opportunities_with_counts', {
              p_club_id: ownerId,
              p_include_closed: false,
              p_limit: 200,
            })
            if (appsRes.error) throw appsRes.error
            const rows = (appsRes.data ?? []) as Array<{
              applicant_count?: number | null
              pending_count?: number | null
            }>
            const applicants = rows.reduce((s, r) => s + (r.applicant_count ?? 0), 0)
            const pending = rows.reduce((s, r) => s + (r.pending_count ?? 0), 0)
            return { open: openRes.count ?? 0, applicants, pending }
          },
          30000,
        )
        if (cancelled) return
        // Tolerate a cache entry seeded by the tile's narrower fetch (no
        // `pending`): fall back to 0 so we never render NaN.
        setCounts({
          open: result.open ?? 0,
          applicants: result.applicants ?? 0,
          pending: result.pending ?? 0,
        })
        setLoading(false)
      } catch (err) {
        if (cancelled) return
        logger.error('[useClubRecruitmentCounts] fetch failed', err)
        setCounts({ open: 0, applicants: 0, pending: 0 })
        setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [ownerId])

  return { counts, loading }
}
