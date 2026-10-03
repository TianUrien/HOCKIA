import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { qk } from '@/lib/queryKeys'
import { isMissingBackendError } from '@/lib/missingBackend'
import type { WeekViewerRow } from '@/lib/pulseWeek'

/**
 * Data for the player Pulse "Your week v2" (Figma 42:276) that no existing
 * hook provides. Everything else the screen shows comes from hooks the Home
 * "Your week" card and the old Pulse already use (useWeeklyVisibility,
 * useMyApplications, useMyPulse, useNotificationStore, useTrustedReferences).
 */

const STALE_MS = 60_000

/**
 * "Who looked at you": club and coach viewers of the owner's profile in the
 * last 7 days, via get_my_week_viewers (owner-only SECURITY DEFINER; anonymous
 * browsers arrive masked, players never arrive). Where the RPC is not
 * deployed yet the list is simply empty.
 */
export function useWeekViewers(enabled: boolean) {
  const userId = useAuthStore((s) => s.user?.id ?? null)
  const query = useQuery({
    queryKey: qk.weekViewers(userId),
    enabled: enabled && !!userId,
    staleTime: STALE_MS,
    queryFn: async (): Promise<WeekViewerRow[]> => {
      const { data, error } = await supabase.rpc('get_my_week_viewers', { p_days: 7 })
      if (error) {
        if (!isMissingBackendError(error)) logger.debug('[week-viewers] failed', error.message)
        return []
      }
      return (Array.isArray(data) ? data : []).map((r) => ({
        viewer_id: r.viewer_id ?? null,
        full_name: r.full_name ?? null,
        role: r.role ?? null,
        username: r.username ?? null,
        avatar_url: r.avatar_url ?? null,
        country_id: typeof r.country_id === 'number' ? r.country_id : null,
        is_hidden: r.is_hidden === true,
        viewed_at: r.viewed_at,
      }))
    },
  })
  return { viewers: query.data ?? [], loading: enabled && !!userId && query.isPending }
}

export interface NewRolesThisWeek {
  total: number
  /** Of those, roles that ask for the owner's position. */
  forPosition: number
}

/**
 * "New roles": open roles for the owner's role type (player / coach) posted
 * in the last 7 days, and how many of them ask for the owner's position.
 * Counts only — no scores, no applicant numbers (opportunityCopy rule).
 * Test-account clubs are hidden from real accounts off staging, like the
 * Opportunities list does.
 */
export function useNewRolesThisWeek(enabled: boolean, forRole: 'player' | 'coach', position: string | null | undefined) {
  const userId = useAuthStore((s) => s.user?.id ?? null)
  const viewerIsTest = useAuthStore((s) => s.profile?.is_test_account ?? false)
  const query = useQuery({
    queryKey: qk.newRolesThisWeek(userId, forRole),
    enabled: enabled && !!userId,
    staleTime: STALE_MS,
    queryFn: async () => {
      const since = new Date(Date.now() - 7 * 86_400_000).toISOString()
      const { data, error } = await supabase
        .from('opportunities')
        .select('id, position, created_at, club:profiles!opportunities_club_id_fkey(is_test_account)')
        .eq('status', 'open')
        .eq('opportunity_type', forRole)
        .neq('club_id', userId as string)
        .gte('created_at', since)
        .limit(200)
      if (error) {
        logger.debug('[new-roles-this-week] failed', error.message)
        return [] as Array<{ position: string | null; test: boolean }>
      }
      return ((data ?? []) as unknown as Array<{ position: string | null; club: { is_test_account: boolean | null } | null }>).map((r) => ({
        position: r.position,
        test: r.club?.is_test_account === true,
      }))
    },
  })
  const isStaging = import.meta.env.VITE_SUPABASE_URL?.includes('ivjkdaylalhsteyyclvl') ?? false
  const rows = (query.data ?? []).filter((r) => isStaging || viewerIsTest || !r.test)
  const want = position?.trim().toLowerCase() || null
  const forPosition = want ? rows.filter((r) => r.position?.trim().toLowerCase() === want).length : 0
  return {
    roles: { total: rows.length, forPosition } satisfies NewRolesThisWeek,
    loading: enabled && !!userId && query.isPending,
  }
}
