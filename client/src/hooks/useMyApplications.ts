import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'

/**
 * The player's own applications, for the Pulse "Your applications" module
 * (Home redesign V2). Closes the anxiety loop the brief calls non-negotiable:
 * 103 of 114 applications sit pending because status was only ever visible
 * INSIDE each opportunity's detail. This is the list that never existed.
 *
 * Non-terminal first (in-review / pending / viewed), newest first. Terminal
 * outcomes (rejected/withdrawn) are excluded — the module is about live
 * anxiety, not history.
 */
export interface MyApplication {
  id: string
  opportunity_id: string
  status: string
  applied_at: string
  opportunity_title: string
  club_name: string | null
  viewed_by_club: boolean
  /** False when the joined opportunity is unreadable (hidden club or truly
   *  deleted) — the row renders as "no longer available", not a dead link.
   *  Closed roles stay readable via the applicant SELECT policy. */
  available: boolean
}

const ACTIVE_STATUSES = ['pending', 'shortlisted', 'maybe'] as const

export function useMyApplications(enabled: boolean) {
  const userId = useAuthStore((s) => s.user?.id)
  const [applications, setApplications] = useState<MyApplication[]>([])
  const [loading, setLoading] = useState(enabled)

  useEffect(() => {
    if (!enabled || !userId) {
      setApplications([])
      setLoading(false)
      return
    }
    let cancelled = false
    void (async () => {
      // The club (via opportunities.club_id) is the profile joined for the
      // name; the FK is disambiguated because opportunities has two.
      const { data, error } = await supabase
        .from('opportunity_applications')
        .select('id, opportunity_id, status, applied_at, opportunities(title, profiles!opportunities_club_id_fkey(full_name))')
        .eq('applicant_id', userId)
        .in('status', [...ACTIVE_STATUSES])
        .order('applied_at', { ascending: false })
        .limit(10)
      if (cancelled) return
      if (error) {
        logger.debug('[my-applications] fetch failed', error.message)
        setApplications([])
        setLoading(false)
        return
      }
      const rows = (data ?? []).map((r) => {
        const opp = r.opportunities as { title?: string; profiles?: { full_name?: string } } | null
        return {
          id: r.id as string,
          opportunity_id: r.opportunity_id as string,
          status: r.status as string,
          applied_at: r.applied_at as string,
          opportunity_title: opp?.title ?? 'Role no longer available',
          club_name: opp?.profiles?.full_name ?? null,
          viewed_by_club: false,
          available: opp != null,
        }
      })

      // "Viewed by club" = an application_views row exists. Second query so
      // the join stays simple; only for the ids we're showing.
      if (rows.length > 0) {
        const { data: views } = await supabase
          .from('application_views')
          .select('application_id')
          .in('application_id', rows.map((r) => r.id))
        if (!cancelled && views) {
          const seen = new Set(views.map((v) => v.application_id as string))
          for (const r of rows) r.viewed_by_club = seen.has(r.id)
        }
      }

      if (!cancelled) {
        setApplications(rows)
        setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [enabled, userId])

  return { applications, loading }
}
