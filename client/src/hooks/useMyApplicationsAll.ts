import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'

const ACTIVE_STATUSES = new Set(['pending', 'shortlisted', 'maybe'])

export interface MyApplicationRow {
  id: string
  opportunityId: string
  status: string
  appliedAt: string
  /** Opportunity fields (null when the role is no longer readable). */
  title: string | null
  position: string | null
  gender: string | null
  opportunityType: string | null
  roleOpen: boolean
  country: string | null
  club: { id: string; name: string; avatarUrl: string | null; role: string | null } | null
  /** Active = the club can still answer; closed = an outcome or a closed role. */
  active: boolean
  /** Declined with a note from the club (Figma 04 Club · Decline): shown as "Read the club's note". */
  hasClubNote: boolean
}

/**
 * Every application of the signed-in member, for the My applications
 * screen (Figma 101:353 / 115:1382). Closed applications keep their outcome
 * in words; the applicant SELECT policy keeps closed roles readable.
 */
export function useMyApplicationsAll() {
  const userId = useAuthStore((s) => s.user?.id ?? null)
  const [rows, setRows] = useState<MyApplicationRow[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!userId) { setRows([]); setLoading(false); return }
    const { data, error } = await supabase
      .from('opportunity_applications')
      .select('id, opportunity_id, status, applied_at, ai_feedback, opportunities(id, title, position, gender, opportunity_type, status, location_country, club_id, profiles!opportunities_club_id_fkey(id, full_name, avatar_url, role))')
      .eq('applicant_id', userId)
      .order('applied_at', { ascending: false })
    if (error) {
      logger.debug('[my-applications] fetch failed', error.message)
      setRows([])
      setLoading(false)
      return
    }
    type OppJoin = {
      id: string; title: string | null; position: string | null; gender: string | null; opportunity_type: string | null
      status: string | null; location_country: string | null; club_id: string | null
      profiles: { id: string; full_name: string | null; avatar_url: string | null; role: string | null } | null
    } | null
    const mapped: MyApplicationRow[] = (data ?? []).map((r) => {
      const opp = r.opportunities as unknown as OppJoin
      const roleOpen = opp?.status === 'open'
      const status = r.status as string
      return {
        id: r.id as string,
        opportunityId: r.opportunity_id as string,
        status,
        appliedAt: r.applied_at as string,
        title: opp?.title ?? null,
        position: opp?.position ?? null,
        gender: opp?.gender ?? null,
        opportunityType: opp?.opportunity_type ?? null,
        roleOpen,
        country: opp?.location_country ?? null,
        club: opp?.profiles ? { id: opp.profiles.id, name: opp.profiles.full_name ?? 'Club', avatarUrl: opp.profiles.avatar_url, role: opp.profiles.role } : null,
        active: roleOpen && ACTIVE_STATUSES.has(status),
        hasClubNote: (() => {
          const fb = (r as { ai_feedback?: unknown }).ai_feedback
          if (!fb || typeof fb !== 'object' || Array.isArray(fb)) return false
          const f = fb as Record<string, unknown>
          return status === 'rejected' && f.status === 'rejected' && f.source === 'club' && typeof f.message === 'string' && f.message.trim().length > 0
        })(),
      }
    })
    setRows(mapped)
    setLoading(false)
  }, [userId])

  useEffect(() => { void refresh() }, [refresh])

  return { rows, loading, refresh }
}
