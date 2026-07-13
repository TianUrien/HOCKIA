import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'

/**
 * Per-role health for the caller's OPEN opportunities (club Pulse, Home V2
 * Phase 2) via get_my_roles_health — views (hidden/test/self-fenced
 * server-side), applicant totals, and the "new" signal (pending applications
 * the club has never opened; same application_views ledger ApplicantCard
 * writes).
 */
export interface RoleHealth {
  opportunity_id: string
  title: string
  position: string | null
  created_at: string
  views_7d: number
  views_prior_7d: number
  applicant_count: number
  pending_count: number
  new_count: number
}

export interface RolesHealthTotals {
  openRoles: number
  pending: number
  newApplicants: number
}

export function aggregateRolesHealth(roles: readonly RoleHealth[]): RolesHealthTotals {
  return {
    openRoles: roles.length,
    pending: roles.reduce((n, r) => n + r.pending_count, 0),
    newApplicants: roles.reduce((n, r) => n + r.new_count, 0),
  }
}

export function useRolesHealth(enabled: boolean) {
  const userId = useAuthStore((s) => s.user?.id)
  const [roles, setRoles] = useState<RoleHealth[]>([])
  const [loading, setLoading] = useState(enabled)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!enabled || !userId) {
      setRoles([])
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setFailed(false)
    void (async () => {
      const { data, error } = await supabase.rpc('get_my_roles_health')
      if (cancelled) return
      if (error) {
        logger.debug('[roles-health] fetch failed', error.message)
        // A transient failure must NOT read as "quiet week": consumers
        // collapse on `failed` instead of rendering zero-states (a club with
        // real pending applicants must never be told there's nothing to do).
        setRoles([])
        setFailed(true)
      } else {
        setRoles(Array.isArray(data) ? (data as unknown as RoleHealth[]) : [])
      }
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [enabled, userId])

  return { roles, totals: aggregateRolesHealth(roles), loading, failed }
}
