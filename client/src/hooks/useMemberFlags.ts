import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { useCountries, type Country } from '@/hooks/useCountries'

type FlagRow = { id: string; nationality_country_id: number | null }

/**
 * Country per profile id for a page of search rows. `search_content` does
 * not return nationality, so the flag on a Search v2 row comes from one
 * batched read of `profiles.nationality_country_id` for the ids on screen
 * (the same column Friends and Squad rows read), joined to the cached
 * countries list. A failed read means no flags, never a broken row.
 */
export function useMemberFlags(ids: string[]): Record<string, Country | undefined> {
  const { countries } = useCountries()
  const key = useMemo(() => [...new Set(ids)].sort(), [ids])

  const { data } = useQuery({
    queryKey: ['member-flags', key],
    queryFn: async (): Promise<FlagRow[]> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, nationality_country_id')
        .in('id', key)
      if (error) {
        logger.warn('[useMemberFlags] read failed', error)
        return []
      }
      return (data ?? []) as FlagRow[]
    },
    enabled: key.length > 0,
    staleTime: 5 * 60_000,
  })

  return useMemo(() => {
    const out: Record<string, Country | undefined> = {}
    for (const row of data ?? []) {
      out[row.id] = row.nationality_country_id == null ? undefined : countries.find((c) => c.id === row.nationality_country_id)
    }
    return out
  }, [data, countries])
}
