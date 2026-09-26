import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { isMissingBackendError } from '@/lib/missingBackend'
import { useProfileStrength } from '@/hooks/useProfileStrength'
import type { Profile } from '@/lib/supabase'

/**
 * The owner's profile completeness (D2). One number everywhere: the server's
 * score from get_my_profile_completeness() — the same
 * profiles.profile_completeness_pct Community shows and ranks by — plus the
 * player's checklist parts.
 *
 * Where the RPC isn't deployed yet (pre-migration environment), the old
 * client-side useProfileStrength percentage is used instead so the card still
 * renders; `source` says which one you got.
 */
export interface CompletenessPart {
  key: string
  weight: number
  done: boolean
  bonus?: boolean
}

export interface ProfileCompleteness {
  percentage: number
  parts: CompletenessPart[] | null
  source: 'server' | 'fallback'
  loading: boolean
}

export function parseCompleteness(raw: unknown): { pct: number; parts: CompletenessPart[] | null } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as { pct?: unknown; parts?: unknown }
  const pct = typeof obj.pct === 'number' && Number.isFinite(obj.pct) ? Math.max(0, Math.min(100, Math.round(obj.pct))) : null
  if (pct === null) return null
  const parts = Array.isArray(obj.parts)
    ? obj.parts
        .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
        .map((p) => ({ key: String(p.key ?? ''), weight: Number(p.weight ?? 0), done: p.done === true, bonus: p.bonus === true || undefined }))
    : null
  return { pct, parts }
}

export function useProfileCompleteness(enabled = true): ProfileCompleteness {
  const profile = useAuthStore((s) => s.profile) as Profile | null
  const profileId = profile?.id ?? null
  const { data, isLoading } = useQuery({
    queryKey: ['profile-completeness', profileId, profile?.profile_completeness_pct ?? null],
    enabled: enabled && !!profileId,
    staleTime: 60_000,
    retry: (count, err) => !isMissingBackendError(err) && count < 1,
    queryFn: async () => {
      const { data: raw, error } = await supabase.rpc('get_my_profile_completeness')
      if (error) {
        if (isMissingBackendError(error)) return { unavailable: true as const }
        throw error
      }
      return { unavailable: false as const, value: parseCompleteness(raw) }
    },
  })
  const serverValue = data && !data.unavailable ? data.value : null
  const useFallback = !isLoading && (data === undefined || data.unavailable || serverValue === null)
  // The fallback calculator only runs when the server score is unavailable.
  const fallback = useProfileStrength(enabled && useFallback ? profile : null)

  if (serverValue) return { percentage: serverValue.pct, parts: serverValue.parts, source: 'server', loading: false }
  if (!useFallback) return { percentage: 0, parts: null, source: 'server', loading: true }
  return { percentage: fallback.percentage, parts: null, source: 'fallback', loading: fallback.loading }
}
