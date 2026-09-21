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
let cached: { at: number; counts: Map<string, number> } | null = null
let inflight: Promise<Map<string, number>> | null = null

async function load(): Promise<Map<string, number>> {
  const { data, error } = await supabase.from('opportunities').select('club_id').eq('status', 'open')
  if (error) throw error
  const counts = new Map<string, number>()
  for (const row of data ?? []) {
    if (row.club_id) counts.set(row.club_id, (counts.get(row.club_id) ?? 0) + 1)
  }
  return counts
}

export function openRolesLabel(count: number | null | undefined): string | null {
  if (!count || count <= 0) return null
  return count === 1 ? '1 open role' : `${count} open roles`
}

export function useOpenRoleCounts(): Map<string, number> {
  const [counts, setCounts] = useState<Map<string, number>>(() => cached?.counts ?? new Map())

  useEffect(() => {
    if (cached && Date.now() - cached.at < TTL) { setCounts(cached.counts); return }
    let cancelled = false
    inflight ??= load().finally(() => { inflight = null })
    inflight.then((next) => {
      cached = { at: Date.now(), counts: next }
      if (!cancelled) setCounts(next)
    }).catch((err) => logger.debug('[useOpenRoleCounts] failed', err))
    return () => { cancelled = true }
  }, [])

  return counts
}
