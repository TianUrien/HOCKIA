import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'

/**
 * Open opportunities per publisher (Community "Recruiting", founder ruling
 * 2026-09-21): open roles are the truth, the recruiting toggle is the
 * fallback. A club with two open roles reads "2 open roles" on its card and
 * matches the Recruiting filter even when its toggle is stale.
 *
 * One small read of the open opportunities the viewer may already see on
 * /opportunities (same RLS), cached for a minute for the whole session.
 */
const TTL = 60_000
type Loaded = { counts: Map<string, number>; positions: Map<string, string[]> }
let cached: ({ at: number } & Loaded) | null = null
let inflight: Promise<Loaded> | null = null

async function load(): Promise<Loaded> {
  const { data, error } = await supabase.from('opportunities').select('club_id, position, opportunity_type').eq('status', 'open')
  if (error) throw error
  const counts = new Map<string, number>()
  // The roles each publisher is recruiting for, in the order the club card
  // lists them ("Recruiting · Defender, Forward"); a coach role without a
  // position reads as the generic "coach" token.
  const positions = new Map<string, string[]>()
  for (const row of data ?? []) {
    if (!row.club_id) continue
    counts.set(row.club_id, (counts.get(row.club_id) ?? 0) + 1)
    const token = row.position ?? (row.opportunity_type === 'coach' ? 'coach' : null)
    if (!token) continue
    const list = positions.get(row.club_id) ?? []
    if (!list.includes(token)) list.push(token)
    positions.set(row.club_id, list)
  }
  return { counts, positions }
}

function useLoaded(): Loaded {
  const [loaded, setLoaded] = useState<Loaded>(() => cached ?? { counts: new Map(), positions: new Map() })

  useEffect(() => {
    if (cached && Date.now() - cached.at < TTL) { setLoaded(cached); return }
    let cancelled = false
    inflight ??= load().finally(() => { inflight = null })
    inflight.then((next) => {
      cached = { at: Date.now(), ...next }
      if (!cancelled) setLoaded(next)
    }).catch((err) => logger.debug('[useOpenRoleCounts] failed', err))
    return () => { cancelled = true }
  }, [])

  return loaded
}

export function openRolesLabel(count: number | null | undefined): string | null {
  if (!count || count <= 0) return null
  return count === 1 ? '1 open opportunity' : `${count} open opportunities`
}

export function useOpenRoleCounts(): Map<string, number> {
  return useLoaded().counts
}

/** Position tokens of each publisher's open roles (Community club card meta). */
export function useOpenRolePositions(): Map<string, string[]> {
  return useLoaded().positions
}
