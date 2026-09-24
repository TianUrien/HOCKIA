import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import type { Vacancy } from '@/lib/supabase'
import { DEFAULT_EXPIRY_DAYS, pipelineOf, type Pipeline } from '@/lib/clubRecruiting'

/**
 * Data for the club's Opportunities tab (Figma 04 Club 324:264, DEV NOTE
 * 327:547): the club's roles, each role's pipeline (pending → To review,
 * shortlisted, rejected → Declined, maybe, no_response → closed), the
 * pending applied_at dates for the amber notice, the expiry window from
 * application_response_settings, and the Shortlist count = saved players +
 * applicants shortlisted on this club's roles, one per player.
 */
export type ClubRole = Vacancy & {
  pipeline: Pipeline
  pendingAppliedAt: string[]
}

export interface ClubRolesData {
  loading: boolean
  open: ClubRole[]
  closed: ClubRole[]
  expiryDays: number
  shortlistCount: number
  refresh: () => void
}

export function useClubRoles(clubId: string | null | undefined): ClubRolesData {
  const [state, setState] = useState<Omit<ClubRolesData, 'refresh'>>({ loading: true, open: [], closed: [], expiryDays: DEFAULT_EXPIRY_DAYS, shortlistCount: 0 })
  const [nonce, setNonce] = useState(0)
  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    if (!clubId) return
    let cancelled = false
    void (async () => {
      const [{ data: roles, error }, { data: settings }, { data: saved }] = await Promise.all([
        supabase.from('opportunities').select('*').eq('club_id', clubId).in('status', ['open', 'closed']).order('created_at', { ascending: false }),
        supabase.from('application_response_settings').select('expiry_days').limit(1).maybeSingle(),
        supabase.from('saved_profiles').select('saved_profile_id').eq('owner_id', clubId),
      ])
      if (error) logger.debug('[useClubRoles] roles failed', error)
      const list = (roles ?? []) as Vacancy[]
      const ids = list.map((r) => r.id)
      const { data: apps } = ids.length
        ? await supabase.from('opportunity_applications').select('opportunity_id, applicant_id, status, applied_at').in('opportunity_id', ids)
        : { data: [] as { opportunity_id: string; applicant_id: string; status: string; applied_at: string | null }[] }
      if (cancelled) return
      const byRole = new Map<string, { status: string; applied_at: string | null }[]>()
      for (const a of (apps ?? []) as { opportunity_id: string; applicant_id: string; status: string; applied_at: string | null }[]) {
        const arr = byRole.get(a.opportunity_id) ?? []
        arr.push(a)
        byRole.set(a.opportunity_id, arr)
      }
      const withPipeline: ClubRole[] = list.map((r) => {
        const rows = byRole.get(r.id) ?? []
        return {
          ...r,
          pipeline: pipelineOf(rows.map((x) => x.status)),
          pendingAppliedAt: rows.filter((x) => x.status === 'pending' && x.applied_at).map((x) => x.applied_at as string),
        }
      })
      const shortlisted = new Set<string>([
        ...((saved ?? []) as { saved_profile_id: string }[]).map((s) => s.saved_profile_id),
        ...((apps ?? []) as { applicant_id: string; status: string }[]).filter((a) => a.status === 'shortlisted').map((a) => a.applicant_id),
      ])
      setState({
        loading: false,
        // Roles with applicants waiting first, oldest waiting first; then newest.
        open: withPipeline.filter((r) => r.status === 'open').sort((a, b) => {
          const oa = a.pendingAppliedAt.length ? a.pendingAppliedAt.reduce((x, y) => (x < y ? x : y)) : null
          const ob = b.pendingAppliedAt.length ? b.pendingAppliedAt.reduce((x, y) => (x < y ? x : y)) : null
          if (oa && ob) return oa.localeCompare(ob)
          if (oa) return -1
          if (ob) return 1
          return (b.created_at ?? '').localeCompare(a.created_at ?? '')
        }),
        closed: withPipeline.filter((r) => r.status === 'closed'),
        expiryDays: (settings as { expiry_days?: number } | null)?.expiry_days ?? DEFAULT_EXPIRY_DAYS,
        shortlistCount: shortlisted.size,
      })
    })().catch((err) => {
      logger.debug('[useClubRoles] failed', err)
      if (!cancelled) setState((s) => ({ ...s, loading: false }))
    })
    return () => { cancelled = true }
  }, [clubId, nonce])

  return { ...state, refresh }
}
