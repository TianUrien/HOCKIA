import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Vacancy } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { useCountries } from '@/hooks/useCountries'
import { checkOpportunityEligibility } from '@/lib/opportunityEligibility'
import { computeOpportunityMatch, MATCH_THRESHOLD } from '@/lib/opportunityMatch'
import { logger } from '@/lib/logger'

/**
 * Open player opportunities ranked for the signed-in player — the Pulse
 * "Opportunities for you" rail (Home redesign V2).
 *
 * Two modes (Q4 + empty-state rule §C):
 *  - 'matched'  ≥1 role scores ≥ MATCH_THRESHOLD → show those, best first,
 *               each with its transparent rule-based %.
 *  - 'newest'   nothing clears the bar → newest open roles WITHOUT a % —
 *               never a lonely "22% match".
 *
 * Excluded before ranking: roles the player already applied to, roles they
 * couldn't apply to at all (EU-passport / team-side via
 * checkOpportunityEligibility — the same predicate the apply flow uses),
 * lapsed deadlines, and (off-staging, for real accounts) test-account clubs.
 */

export interface OpportunityForYou {
  id: string
  title: string
  position: string | null
  gender: string | null
  application_deadline: string | null
  created_at: string
  club_id: string | null
  club_name: string | null
  club_avatar_url: string | null
  /** Rule-based match %, present only in 'matched' mode. */
  score: number | null
}

interface RawRow {
  id: string
  title: string
  position: string | null
  gender: string | null
  opportunity_type: string | null
  level_sought: string | null
  application_deadline: string | null
  eu_passport_required: boolean | null
  position_required: boolean | null
  created_at: string
  club: {
    id: string
    full_name: string | null
    avatar_url: string | null
    is_test_account: boolean | null
  } | null
}

const RAIL_SIZE = 6
const FETCH_POOL = 40

/** Days until a DATE-typed deadline (inclusive — closes at end of that day).
 *  Negative = passed. Mirrors OpportunityDetailView's daysLeft math. */
export function daysUntilDeadline(deadline: string | null, now: Date = new Date()): number | null {
  if (!deadline) return null
  const end = new Date(`${deadline}T23:59:59`)
  if (Number.isNaN(end.getTime())) return null
  return Math.floor((end.getTime() - now.getTime()) / 86_400_000)
}

export function useOpportunitiesForYou(enabled: boolean) {
  const userId = useAuthStore((s) => s.user?.id)
  const profile = useAuthStore((s) => s.profile)
  const { countries, loading: countriesLoading } = useCountries()
  const [rows, setRows] = useState<RawRow[]>([])
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(enabled)

  useEffect(() => {
    if (!enabled || !userId) {
      setRows([])
      setLoading(false)
      return
    }
    let cancelled = false
    void (async () => {
      const [oppsRes, appliedRes] = await Promise.all([
        supabase
          .from('opportunities')
          .select(
            'id, title, position, gender, opportunity_type, level_sought, application_deadline, eu_passport_required, position_required, created_at, club:profiles!opportunities_club_id_fkey(id, full_name, avatar_url, is_test_account)',
          )
          .eq('status', 'open')
          .eq('opportunity_type', 'player')
          .order('created_at', { ascending: false })
          .limit(FETCH_POOL),
        supabase
          .from('opportunity_applications')
          .select('opportunity_id')
          .eq('applicant_id', userId),
      ])
      if (cancelled) return
      if (oppsRes.error) {
        logger.debug('[opportunities-for-you] fetch failed', oppsRes.error.message)
        setRows([])
        setLoading(false)
        return
      }
      setRows((oppsRes.data ?? []) as unknown as RawRow[])
      setAppliedIds(
        new Set(((appliedRes.data ?? []) as { opportunity_id: string }[]).map((a) => a.opportunity_id)),
      )
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [enabled, userId])

  const result = useMemo((): { mode: 'matched' | 'newest'; items: OpportunityForYou[] } => {
    if (!profile) return { mode: 'newest', items: [] }

    // House pattern (OpportunitiesPage): test-account content is visible on
    // staging and to test accounts, hidden from real users elsewhere.
    const isStaging = import.meta.env.VITE_SUPABASE_URL?.includes('ivjkdaylalhsteyyclvl')
    const viewerIsTest = profile.is_test_account ?? false

    const candidates = rows.filter((r) => {
      if (appliedIds.has(r.id)) return false
      if (!isStaging && !viewerIsTest && r.club?.is_test_account) return false
      const days = daysUntilDeadline(r.application_deadline)
      if (days != null && days < 0) return false
      // Hard apply-gates (EU passport + team side) — the same predicate the
      // apply flow enforces; only those fields are read from the row.
      return checkOpportunityEligibility(r as unknown as Vacancy, profile, countries).eligible
    })

    const scored = candidates.map((r) => ({
      row: r,
      score: computeOpportunityMatch(
        {
          position: profile.position ?? null,
          secondary_position: profile.secondary_position ?? null,
          playing_category: profile.playing_category ?? null,
          gender: profile.gender ?? null,
          level_target: profile.level_target ?? null,
        },
        {
          position: r.position,
          gender: r.gender,
          level_sought: r.level_sought,
          position_required: r.position_required,
        },
      ),
    }))

    const toItem = (r: RawRow, score: number | null): OpportunityForYou => ({
      id: r.id,
      title: r.title,
      position: r.position,
      gender: r.gender,
      application_deadline: r.application_deadline,
      created_at: r.created_at,
      club_id: r.club?.id ?? null,
      club_name: r.club?.full_name ?? null,
      club_avatar_url: r.club?.avatar_url ?? null,
      score,
    })

    const matched = scored
      .filter((s): s is typeof s & { score: number } => s.score != null && s.score >= MATCH_THRESHOLD)
      .sort((a, b) => b.score - a.score || b.row.created_at.localeCompare(a.row.created_at))
      .slice(0, RAIL_SIZE)

    if (matched.length > 0) {
      return { mode: 'matched', items: matched.map((s) => toItem(s.row, s.score)) }
    }
    // Newest fallback: rows are already newest-first from the query.
    return { mode: 'newest', items: scored.slice(0, RAIL_SIZE).map((s) => toItem(s.row, null)) }
  }, [rows, appliedIds, profile, countries])

  return { loading: loading || countriesLoading, mode: result.mode, items: result.items }
}
