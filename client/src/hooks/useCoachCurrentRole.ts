import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

/**
 * A coach's "Current role" (D2 key fact; profiles.coach_current_role, added
 * by 20260928250000). The owner's own row already carries it (profiles_self
 * select *); visitors' profile fetches use a fixed column list, so it is read
 * here on its own. Before the migration is on an environment the column is
 * missing (42703 / PGRST204) — that reads as "no role", never an error.
 */
export function useCoachCurrentRole(profile: { id?: string | null; role?: string | null; coach_current_role?: string | null } | null, enabled = true) {
  const onRow = !!profile && 'coach_current_role' in profile
  const { data } = useQuery({
    queryKey: ['coach-current-role', profile?.id ?? null],
    enabled: enabled && !!profile?.id && profile.role === 'coach' && !onRow,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async (): Promise<string | null> => {
      const { data: row, error } = await supabase
        .from('profiles')
        .select('coach_current_role')
        .eq('id', profile?.id as string)
        .maybeSingle()
      if (error) return null
      return (row as { coach_current_role: string | null } | null)?.coach_current_role ?? null
    },
  })
  return onRow ? profile?.coach_current_role ?? null : data ?? null
}
