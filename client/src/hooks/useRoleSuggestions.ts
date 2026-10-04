import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { isRecruitingViewer } from '@/lib/recruiterAccess'
import { isMissingBackendError } from '@/lib/missingBackend'
import { reportSupabaseError } from '@/lib/sentryHelpers'
import { parseRoleSuggestions, type RoleSuggestionsPayload } from '@/lib/roleSuggestions'

/**
 * D5 · Hockia suggests data (migration 20261004100000). get_role_suggestions
 * answers only the role's publisher and re-applies every people fence; this
 * hook never filters people itself. A role that was never computed (posted
 * before D5 shipped) gets one refresh_role_suggestions call — the server
 * limits it to once per 10 minutes per role. The RPCs not being deployed
 * yet reads as "no suggestions", never as a crash.
 */

// The D5 RPCs are newer than the generated types.
const db = supabase as unknown as SupabaseClient

export const roleSuggestionsKey = (roleId: string | null | undefined, viewerId: string | null | undefined) =>
  ['role-suggestions', roleId ?? null, viewerId ?? null] as const

export function useRoleSuggestions(roleId: string | null | undefined) {
  const viewer = useAuthStore((s) => s.profile)
  const viewerId = viewer?.id ?? null
  const enabled = !!roleId && !!viewerId && isRecruitingViewer(viewer)
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: roleSuggestionsKey(roleId, viewerId),
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<RoleSuggestionsPayload | null> => {
      const { data, error } = await db.rpc('get_role_suggestions', { p_opportunity_id: roleId })
      if (error) {
        if (isMissingBackendError(error)) return null
        reportSupabaseError('useRoleSuggestions.get', error)
        throw error
      }
      return parseRoleSuggestions(data)
    },
  })

  // First visit to a role that was never computed: compute once.
  const refreshed = useRef<string | null>(null)
  const data = query.data
  useEffect(() => {
    if (!enabled || !roleId || !data || data.computed_at || data.role.status !== 'open') return
    if (refreshed.current === roleId) return
    refreshed.current = roleId
    void (async () => {
      const { data: out, error } = await db.rpc('refresh_role_suggestions', { p_opportunity_id: roleId })
      if (error) { if (!isMissingBackendError(error)) reportSupabaseError('useRoleSuggestions.refresh', error); return }
      if ((out as { outcome?: string } | null)?.outcome === 'refreshed') void queryClient.invalidateQueries({ queryKey: roleSuggestionsKey(roleId, viewerId) })
    })()
  }, [enabled, roleId, viewerId, data, queryClient])

  return {
    data: data ?? null,
    suggestions: data?.suggestions ?? [],
    loading: enabled && query.isLoading,
    error: query.error ? true : false,
    refetch: query.refetch,
  }
}
