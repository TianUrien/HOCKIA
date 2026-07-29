import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { qk } from '@/lib/queryKeys'

/**
 * Posted-opportunity counts for a recruiter (club or coach owner).
 *
 * IMPORTANT — no extra query: useCoachPostedOpportunityCounts is the ONE
 * fetch behind qk.coachPostedOpportunities, shared by
 * CoachPostedOpportunitiesCard (reads open + applicants) and the club
 * #recruitment-summary card (also reads pending). Under requestCache the
 * two surfaces shared a string key with two different fetch shapes; React
 * Query makes the superset queryFn canonical so whichever consumer mounts
 * first seeds the same complete result.
 *
 * Counts mirror the management surface exactly: open = opportunities with
 * status='open'; applicants/pending summed across the recruiter's OPEN
 * opportunities only (p_include_closed=false).
 */
export interface ClubRecruitmentCounts {
  /** Opportunities with status='open'. */
  open: number
  /** Total applicants across open opportunities. */
  applicants: number
  /** Pending (not-yet-actioned) applicants across open opportunities. */
  pending: number
}

export function useCoachPostedOpportunityCounts(ownerId: string | null | undefined): {
  counts: ClubRecruitmentCounts | null
  loading: boolean
  error: unknown
} {
  const id = ownerId ?? null
  const { data, isPending, error } = useQuery({
    queryKey: qk.coachPostedOpportunities(id),
    enabled: !!id,
    staleTime: 30_000,
    queryFn: async (): Promise<ClubRecruitmentCounts> => {
      const openRes = await supabase
        .from('opportunities')
        .select('id', { count: 'exact', head: true })
        .eq('club_id', id as string)
        .eq('status', 'open')
      if (openRes.error) throw openRes.error

      // Same RPC the vacancies tab uses; returns rows + applicant counts,
      // so the numbers match what the recruiter sees inside the
      // management surface.
      const appsRes = await supabase.rpc('fetch_club_opportunities_with_counts', {
        p_club_id: id as string,
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
  })

  useEffect(() => {
    if (error) logger.error('[useCoachPostedOpportunityCounts] fetch failed', error)
  }, [error])

  return {
    counts: data ?? null,
    loading: !!id && isPending,
    error: error ?? null,
  }
}

/**
 * Club #recruitment-summary card contract — same data, error → zeros so
 * the summary never renders NaN or blocks the dashboard.
 */
export function useClubRecruitmentCounts(ownerId: string | null | undefined): {
  counts: ClubRecruitmentCounts | null
  loading: boolean
} {
  const { counts, loading, error } = useCoachPostedOpportunityCounts(ownerId)
  if (error) {
    return { counts: { open: 0, applicants: 0, pending: 0 }, loading: false }
  }
  return { counts, loading }
}
