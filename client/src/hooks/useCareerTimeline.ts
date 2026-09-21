import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import type { Database } from '@/lib/database.types'

/**
 * The complete career timeline (Figma Career — own / public). Same query
 * and order the profile preview and the legacy Journey tab use — newest
 * first — so the three surfaces can never disagree.
 */
type Row = Database['public']['Tables']['career_history']['Row'] & {
  world_club: { id: string; club_name: string; avatar_url: string | null; country: { flag_emoji: string | null } | null } | null
}

export type CareerTimelineEntry = {
  id: string
  entryType: string | null
  clubName: string
  positionRole: string | null
  divisionLeague: string | null
  locationCity: string | null
  locationCountry: string | null
  startDate: string | null
  endDate: string | null
  years: string | null
  highlights: string[]
  representedCountryId: number | null
  crestUrl: string | null
  clubFlag: string | null
}

export function useCareerTimeline(profileId: string | null | undefined) {
  const [entries, setEntries] = useState<CareerTimelineEntry[]>([])
  const [loading, setLoading] = useState(Boolean(profileId))
  const [failed, setFailed] = useState(false)
  const [nonce, setNonce] = useState(0)
  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    if (!profileId) { setLoading(false); return }
    let cancelled = false
    setLoading(true)
    setFailed(false)
    void (async () => {
      const { data, error } = await supabase
        .from('career_history')
        .select('*, world_club:world_clubs!career_history_world_club_id_fkey(id, club_name, avatar_url, country:countries(flag_emoji))')
        .eq('user_id', profileId)
        .order('start_date', { ascending: false, nullsFirst: false })
        .order('display_order', { ascending: false })
      if (cancelled) return
      if (error) {
        logger.error('[useCareerTimeline] failed', error)
        setFailed(true)
        setLoading(false)
        return
      }
      setEntries(((data ?? []) as unknown as Row[]).map((r) => ({
        id: r.id,
        entryType: r.entry_type,
        clubName: r.club_name,
        positionRole: r.position_role,
        divisionLeague: r.division_league,
        locationCity: r.location_city,
        locationCountry: r.location_country,
        startDate: r.start_date,
        endDate: r.end_date,
        years: r.years,
        highlights: Array.isArray(r.highlights) ? r.highlights.filter((h): h is string => typeof h === 'string' && h.trim().length > 0) : [],
        representedCountryId: r.represented_country_id,
        crestUrl: r.world_club?.avatar_url ?? null,
        clubFlag: r.world_club?.country?.flag_emoji ?? null,
      })))
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [profileId, nonce])

  return { entries, loading, failed, refresh }
}
