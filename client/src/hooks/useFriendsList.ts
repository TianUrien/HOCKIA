import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'

/**
 * The people behind the "Friends" number (Figma Friends / Friends — public).
 *
 *   own    → the owner's accepted profile_friend_edges (RLS: own rows)
 *   public → get_profile_connections — members-only, block- and
 *            hidden-profile-fenced; the same list the count comes from
 *
 * Both are enriched with one profiles read so every row can say
 * "Player · Forward · 🇦🇷 🇮🇹" (roles are always visible).
 */
export type FriendPerson = {
  id: string
  fullName: string | null
  username: string | null
  avatarUrl: string | null
  role: string | null
  position: string | null
  coachSpecialization: string | null
  coachSpecializationCustom: string | null
  umpireLevel: string | null
  countryIds: number[]
  connectedAt: string | null
}

const PAGE = 100
const MAX_PAGES = 5

type Detail = {
  id: string; full_name: string | null; username: string | null; avatar_url: string | null; role: string | null
  position: string | null; coach_specialization: string | null; coach_specialization_custom: string | null
  umpire_level: string | null; nationality_country_id: number | null; nationality2_country_id: number | null
}

async function loadIds(profileId: string, mode: 'own' | 'public'): Promise<{ id: string; connectedAt: string | null }[]> {
  if (mode === 'own') {
    const { data, error } = await supabase
      .from('profile_friend_edges')
      .select('friend_id, accepted_at')
      .eq('profile_id', profileId)
      .eq('status', 'accepted')
      .order('accepted_at', { ascending: false })
    if (error) throw error
    return (data ?? []).filter((e) => e.friend_id).map((e) => ({ id: e.friend_id as string, connectedAt: e.accepted_at }))
  }
  const out: { id: string; connectedAt: string | null }[] = []
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, error } = await supabase.rpc('get_profile_connections', { p_profile_id: profileId, p_limit: PAGE, p_offset: page * PAGE })
    if (error) throw error
    const rows = data ?? []
    for (const r of rows) out.push({ id: r.id, connectedAt: r.connected_at })
    const total = rows[0]?.total_count ?? 0
    if (rows.length < PAGE || (page + 1) * PAGE >= total) break
  }
  return out
}

export function useFriendsList(profileId: string | null | undefined, mode: 'own' | 'public', enabled = true) {
  const [people, setPeople] = useState<FriendPerson[]>([])
  const [loading, setLoading] = useState(Boolean(profileId) && enabled)
  const [failed, setFailed] = useState(false)
  const [nonce, setNonce] = useState(0)
  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    if (!profileId || !enabled) { setLoading(false); return }
    let cancelled = false
    setLoading(true)
    setFailed(false)
    void (async () => {
      const ids = await loadIds(profileId, mode)
      let details = new Map<string, Detail>()
      if (ids.length > 0) {
        const { data, error } = await supabase
          .from('profiles')
          .select('id, full_name, username, avatar_url, role, position, coach_specialization, coach_specialization_custom, umpire_level, nationality_country_id, nationality2_country_id')
          .in('id', ids.map((i) => i.id))
        if (error) throw error
        details = new Map(((data ?? []) as Detail[]).map((d) => [d.id, d]))
      }
      if (cancelled) return
      setPeople(
        ids.flatMap(({ id, connectedAt }) => {
          const d = details.get(id)
          if (!d) return []
          return [{
            id, connectedAt,
            fullName: d.full_name, username: d.username, avatarUrl: d.avatar_url, role: d.role,
            position: d.position, coachSpecialization: d.coach_specialization, coachSpecializationCustom: d.coach_specialization_custom,
            umpireLevel: d.umpire_level,
            countryIds: [d.nationality_country_id, d.role === 'club' ? null : d.nationality2_country_id].filter((n): n is number => typeof n === 'number'),
          }]
        }),
      )
      setLoading(false)
    })().catch((err) => {
      logger.error('[useFriendsList] failed', err)
      if (!cancelled) { setFailed(true); setLoading(false) }
    })
    return () => { cancelled = true }
  }, [profileId, mode, enabled, nonce])

  return { people, loading, failed, refresh }
}
