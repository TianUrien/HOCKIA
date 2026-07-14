import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { requestCache } from '@/lib/requestCache'
import { logger } from '@/lib/logger'
import { useAuthStore } from '@/lib/auth'
import { prefetchWorldClubLogos } from './useWorldClubLogo'
import { useRecruitingScope } from './useRecruitingScope'
import { computeScopedVerdicts, isInScope, type ScopedCandidateRow } from '@/lib/scopedVerdicts'

/**
 * The club Pulse match layer (Home V2 Phase 2): fetch a wide
 * availability-ranked pool of OPEN candidates (p_only_open — the hero claims
 * "available", so unlike the Community scoped rail the pool is restricted to
 * open-to-X profiles; the grid remains the full universe) and run the SAME
 * shared verdict composition (lib/scopedVerdicts). Exposes:
 *  - fitCount: candidates in scope (tier pursue/consider) — the hero number;
 *  - matches: top rail candidates (out-of-scope tier 'pass' EXCLUDED, same
 *    rule as the community rail — a non-keeper is never a top candidate for
 *    a goalkeeper search).
 * Pool follows the scope's target role (coach-seeking context → coach pool).
 *
 * The verdict engine's competition-proximity component reads the module-level
 * clubLeagueCache SYNCHRONOUSLY — Community pages warm it, Home does not, so
 * the fetch effect warms it here for the viewer's club + the pool's clubs
 * BEFORE the pool lands in state. Without this, a cold Home load computes
 * fits with a null viewer band (−40% weight) and the hero number would
 * change after visiting Community (audit finding H1).
 */
type PoolRow = ScopedCandidateRow & {
  full_name: string | null
  avatar_url: string | null
  profile_completeness_pct: number | null
}

export interface ScopedMatch {
  id: string
  full_name: string | null
  avatar_url: string | null
  position: string | null
  role: string
  /** Match % — verdict.strength × 100, the same number the grid shows. */
  pct: number
  inScope: boolean
}

const POOL_LIMIT = 100
const RAIL_SIZE = 8

export function useScopedMatches(enabled: boolean) {
  const { scope, loading: scopeLoading } = useRecruitingScope()
  const viewerWorldClubId = useAuthStore((s) => s.profile?.current_world_club_id ?? null)
  // A recruiting coach's own profile is in the coach pool (open_to_coach
  // defaults true), so without this they'd rank/count as a candidate in their
  // OWN "Available now" rail and inflate the hero fitCount.
  const viewerId = useAuthStore((s) => s.profile?.id ?? null)
  const [pool, setPool] = useState<PoolRow[]>([])
  const [fetching, setFetching] = useState(enabled)
  const poolRole = scope?.targetRole === 'coach' ? 'coach' : 'player'
  const hasScope = scope != null

  useEffect(() => {
    if (!enabled || !hasScope) {
      setPool([])
      setFetching(false)
      return
    }
    let cancelled = false
    // Re-arm on every real fetch start (deps can flip hasScope true AFTER a
    // first no-scope pass — without this the hero would render the empty
    // variant while the pool is still in flight).
    setFetching(true)
    void (async () => {
      try {
        const rows = await requestCache.dedupe<PoolRow[]>(`club-pulse-pool-${poolRole}`, async () => {
          const { data, error } = await supabase.rpc('get_top_community_members', {
            p_role: poolRole,
            p_limit: POOL_LIMIT,
            p_sort: 'availability_activity',
            p_only_open: true,
          })
          if (error) throw error
          return (data ?? []) as PoolRow[]
        })
        // Warm the league-band cache BEFORE the pool reaches state, so the
        // verdict memo's first computation already sees the bands (H1).
        const clubIds = [viewerWorldClubId, ...rows.map((m) => m.current_world_club_id)]
          .filter((id): id is string => Boolean(id))
        if (clubIds.length > 0) await prefetchWorldClubLogos(clubIds)
        if (!cancelled) setPool(rows)
      } catch (err) {
        logger.debug('[scoped-matches] pool fetch failed', err)
        if (!cancelled) setPool([])
      } finally {
        if (!cancelled) setFetching(false)
      }
    })()
    return () => { cancelled = true }
  }, [enabled, hasScope, poolRole, viewerWorldClubId])

  const { fitCount, matches } = useMemo(() => {
    if (!scope || pool.length === 0) return { fitCount: 0, matches: [] as ScopedMatch[] }
    // Never surface or count the viewer themself in their own recruiting rail.
    const candidates = viewerId ? pool.filter((m) => m.id !== viewerId) : pool
    if (candidates.length === 0) return { fitCount: 0, matches: [] as ScopedMatch[] }
    const verdicts = computeScopedVerdicts(candidates, scope)
    const kept = candidates.filter((m) => {
      const v = verdicts.get(m.id)
      return v != null && v.tier !== 'pass'
    })
    kept.sort((a, b) => {
      const va = verdicts.get(a.id)
      const vb = verdicts.get(b.id)
      const sa = isInScope(va) ? 1 : 0
      const sb = isInScope(vb) ? 1 : 0
      if (sa !== sb) return sb - sa
      const ra = va?.strength ?? 0
      const rb = vb?.strength ?? 0
      if (rb !== ra) return rb - ra
      const pa = a.profile_completeness_pct ?? 0
      const pb = b.profile_completeness_pct ?? 0
      if (pb !== pa) return pb - pa
      return a.id.localeCompare(b.id)
    })
    return {
      fitCount: kept.filter((m) => isInScope(verdicts.get(m.id))).length,
      matches: kept.slice(0, RAIL_SIZE).map((m) => ({
        id: m.id,
        full_name: m.full_name,
        avatar_url: m.avatar_url,
        position: m.position,
        role: m.role,
        pct: Math.round((verdicts.get(m.id)?.strength ?? 0) * 100),
        inScope: isInScope(verdicts.get(m.id)),
      })),
    }
  }, [pool, scope, viewerId])

  // Loading until BOTH the context store settled (else a scoped club flashes
  // the no-scope onboarding hero) and any in-flight pool fetch resolved.
  return { loading: scopeLoading || fetching, hasScope, poolRole, fitCount, matches }
}
