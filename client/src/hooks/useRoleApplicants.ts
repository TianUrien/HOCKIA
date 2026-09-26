import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import type { Vacancy } from '@/lib/supabase'
import { DEFAULT_EXPIRY_DAYS, fitTarget, type FitComponents, type FitState } from '@/lib/clubRecruiting'
import { heldDecision } from '@/lib/pendingDecisions'

/**
 * Applicants of one role for its publishing club (Figma 04 Club ·
 * Applicants 324:411, DEV NOTE 327:555). Fit comes from compute_club_fit,
 * which only answers for the owning club or coach (hotfix 2026-09-24) —
 * this hook is only mounted on the club's own screens.
 */
export interface Applicant {
  applicationId: string
  status: string
  appliedAt: string | null
  updatedAt: string | null
  metadata: Record<string, unknown>
  viewed: boolean
  fit: { state: FitState; components: FitComponents } | null
  person: {
    id: string
    fullName: string
    avatarUrl: string | null
    role: string | null
    position: string | null
    secondaryPosition: string | null
    nationalityCountryId: number | null
    nationality2CountryId: number | null
    baseLocation: string | null
    playingCategory: string | null
    lastActiveAt: string | null
    currentClub: string | null
    currentWorldClubId: string | null
  }
}

export interface RoleApplicants {
  loading: boolean
  error: string | null
  role: Vacancy | null
  applicants: Applicant[]
  expiryDays: number
  refresh: () => void
  /** Optimistic local status change (held decision) without a refetch. */
  setLocalStatus: (applicationId: string, status: string) => void
}

type Row = {
  id: string; status: string; applied_at: string | null; updated_at: string | null; metadata: unknown
  applicant: {
    id: string; full_name: string | null; avatar_url: string | null; role: string | null; position: string | null; secondary_position: string | null
    nationality_country_id: number | null; nationality2_country_id: number | null; base_location: string | null; playing_category: string | null
    last_active_at: string | null; current_club: string | null; current_world_club_id: string | null
  } | null
}

const cache = new Map<string, { at: number; value: Omit<RoleApplicants, 'refresh' | 'setLocalStatus' | 'loading' | 'error'> }>()
const TTL = 30_000

// Decisions are held for the Undo window before they're written, so the list
// reflects them locally: a patch updates the cache and every mounted list.
const listeners = new Set<(roleId: string, applicationId: string, status: string) => void>()

export function patchRoleApplicantStatus(roleId: string, applicationId: string, status: string): void {
  const hit = cache.get(roleId)
  if (hit) {
    hit.value = { ...hit.value, applicants: hit.value.applicants.map((a) => (a.applicationId === applicationId ? { ...a, status, updatedAt: new Date().toISOString() } : a)) }
    hit.at = Date.now()
  }
  listeners.forEach((fn) => fn(roleId, applicationId, status))
}

/** Mark an application opened by this club (drops its "New" dot). */
export function markRoleApplicantViewed(roleId: string, applicationId: string): void {
  const hit = cache.get(roleId)
  if (hit) hit.value = { ...hit.value, applicants: hit.value.applicants.map((a) => (a.applicationId === applicationId ? { ...a, viewed: true } : a)) }
}

export function peekRoleApplicants(roleId: string) {
  const hit = cache.get(roleId)
  return hit && Date.now() - hit.at < TTL ? hit.value : null
}

export function useRoleApplicants(roleId: string | null | undefined, clubId: string | null | undefined): RoleApplicants {
  const seeded = roleId ? peekRoleApplicants(roleId) : null
  const [state, setState] = useState<Omit<RoleApplicants, 'refresh' | 'setLocalStatus'>>({
    loading: !seeded, error: null, role: seeded?.role ?? null, applicants: seeded?.applicants ?? [], expiryDays: seeded?.expiryDays ?? DEFAULT_EXPIRY_DAYS,
  })
  const [nonce, setNonce] = useState(0)
  const refresh = useCallback(() => { if (roleId) cache.delete(roleId); setNonce((n) => n + 1) }, [roleId])
  const setLocalStatus = useCallback((applicationId: string, status: string) => {
    if (roleId) patchRoleApplicantStatus(roleId, applicationId, status)
  }, [roleId])

  useEffect(() => {
    const fn = (rid: string, applicationId: string, status: string) => {
      if (rid !== roleId) return
      setState((s) => ({ ...s, applicants: s.applicants.map((a) => (a.applicationId === applicationId ? { ...a, status, updatedAt: new Date().toISOString() } : a)) }))
    }
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  }, [roleId])

  useEffect(() => {
    if (!roleId || !clubId) return
    let cancelled = false
    void (async () => {
      const [{ data: role, error: roleErr }, { data: rows, error: appErr }, { data: settings }] = await Promise.all([
        supabase.from('opportunities').select('*').eq('id', roleId).eq('club_id', clubId).maybeSingle(),
        supabase
          .from('opportunity_applications')
          .select(`id, status, applied_at, updated_at, metadata,
            applicant:applicant_id ( id, full_name, avatar_url, role, position, secondary_position, nationality_country_id, nationality2_country_id, base_location, playing_category, last_active_at, current_club, current_world_club_id )`)
          .eq('opportunity_id', roleId),
        supabase.from('application_response_settings').select('expiry_days').limit(1).maybeSingle(),
      ])
      if (cancelled) return
      if (roleErr || appErr) logger.debug('[useRoleApplicants] read failed', roleErr ?? appErr)
      if (!role) { setState((s) => ({ ...s, loading: false, error: 'This role isn’t yours or no longer exists.' })); return }
      const list = ((rows ?? []) as unknown as Row[]).filter((r) => r.applicant && r.status !== 'withdrawn')
      const ids = list.map((r) => r.id)
      const target = fitTarget((role as Vacancy).gender)
      const [{ data: views }, fits] = await Promise.all([
        ids.length ? supabase.from('application_views').select('application_id').eq('viewer_id', clubId).in('application_id', ids) : Promise.resolve({ data: [] }),
        Promise.all(list.map(async (r) => {
          if (r.status === 'no_response' || !target) return [r.id, null] as const
          const { data } = await supabase.rpc('compute_club_fit', { p_owner_id: clubId, p_player_id: r.applicant!.id, p_target: target, p_region: null as unknown as string, p_opportunity_id: roleId })
          const row = (data as { state: FitState; components: FitComponents }[] | null)?.[0] ?? null
          return [r.id, row ? { state: row.state, components: row.components } : null] as const
        })),
      ])
      if (cancelled) return
      const viewed = new Set(((views ?? []) as { application_id: string }[]).map((v) => v.application_id))
      const fitById = new Map(fits)
      const applicants: Applicant[] = list.map((r) => {
        const a = r.applicant!
        return {
          applicationId: r.id,
          status: r.status,
          appliedAt: r.applied_at,
          updatedAt: r.updated_at,
          metadata: r.metadata && typeof r.metadata === 'object' && !Array.isArray(r.metadata) ? (r.metadata as Record<string, unknown>) : {},
          viewed: viewed.has(r.id),
          fit: fitById.get(r.id) ?? null,
          person: {
            id: a.id, fullName: a.full_name?.trim() || 'Hockia member', avatarUrl: a.avatar_url, role: a.role, position: a.position, secondaryPosition: a.secondary_position,
            nationalityCountryId: a.nationality_country_id, nationality2CountryId: a.nationality2_country_id, baseLocation: a.base_location,
            playingCategory: a.playing_category, lastActiveAt: a.last_active_at, currentClub: a.current_club, currentWorldClubId: a.current_world_club_id,
          },
        }
      })
      for (const a of applicants) {
        const held = heldDecision(a.applicationId)
        if (held) a.status = held.kind === 'decline' ? 'rejected' : held.status
      }
      const value = { role: role as Vacancy, applicants, expiryDays: (settings as { expiry_days?: number } | null)?.expiry_days ?? DEFAULT_EXPIRY_DAYS }
      cache.set(roleId, { at: Date.now(), value })
      setState({ loading: false, error: null, ...value })
    })().catch((err) => {
      logger.debug('[useRoleApplicants] failed', err)
      if (!cancelled) setState((s) => ({ ...s, loading: false, error: 'Couldn’t load applicants. Pull to try again.' }))
    })
    return () => { cancelled = true }
  }, [roleId, clubId, nonce])

  return { ...state, refresh, setLocalStatus }
}
