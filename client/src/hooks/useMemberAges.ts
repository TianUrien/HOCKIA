import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'

/**
 * Server-computed ages for the people on screen (Community photo cards:
 * "22 · 🇦🇷 Buenos Aires"). One `get_profile_ages` call per page of ids —
 * never the birth date, which stays private. A member without a known age is
 * simply missing from the map and the card hides the age (Figma spec).
 */
const CHUNK = 200

export function useMemberAges(ids: string[]): Map<string, number> {
  const key = useMemo(() => [...new Set(ids)].sort(), [ids])

  const { data } = useQuery({
    queryKey: ['member-ages', key],
    enabled: key.length > 0,
    staleTime: 10 * 60_000,
    // Loading the next page keeps the ages already on screen.
    placeholderData: (previous) => previous,
    queryFn: async () => {
      const out = new Map<string, number>()
      for (let i = 0; i < key.length; i += CHUNK) {
        const { data: rows, error } = await supabase.rpc('get_profile_ages', { p_ids: key.slice(i, i + CHUNK) })
        if (error) {
          logger.debug('[useMemberAges] read failed', error)
          continue
        }
        for (const r of rows ?? []) {
          if (typeof r.age === 'number') out.set(r.profile_id, r.age)
        }
      }
      return out
    },
  })

  return data ?? EMPTY
}

const EMPTY = new Map<string, number>()
