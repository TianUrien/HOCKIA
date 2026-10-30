import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { isRecruiterProfile } from '@/lib/hockiaAi'
import { fetchMyOffers, liveCount } from '@/lib/brandOffers'
import { useMyGoal } from '@/hooks/useMemberGoal'
import { aiContextChip, goalChipLabel, type AiContextChip } from '@/lib/hockiaAiContext'
import { useHockiaAiSheet } from './hockiaAiSheetStore'

interface OwnCounts { myOpenRoles?: number | null; liveOffers?: number | null; matchesOfficiated?: number | null }

/** One read per role when the sheet opens. A failed read stays unknown (no count shown). */
async function readOwnCounts(id: string, role: string | null, recruiter: boolean): Promise<OwnCounts> {
  if (recruiter) {
    // Same source as Home's roles health (open roles only).
    const { data, error } = await supabase.rpc('get_my_roles_health')
    return error || !Array.isArray(data) ? {} : { myOpenRoles: data.length }
  }
  if (role === 'brand') return { liveOffers: liveCount(await fetchMyOffers()) }
  if (role === 'umpire') {
    const { count, error } = await supabase.from('umpire_appointments').select('id', { count: 'exact', head: true }).eq('user_id', id)
    return error || count === null ? {} : { matchesOfficiated: count }
  }
  return {}
}

/** The sheet's context chip for the signed-in member, or null. */
export function useAiContextChip(open: boolean): AiContextChip | null {
  const profile = useAuthStore((s) => s.profile)
  const entry = useHockiaAiSheet((s) => s.entry)
  const openOpportunities = useHockiaAiSheet((s) => s.openOpportunities)
  const { data: goal } = useMyGoal()
  const [counts, setCounts] = useState<OwnCounts>({})
  const id = profile?.id ?? null
  const role = profile?.role ?? null
  const recruiter = isRecruiterProfile(profile ? { role: profile.role, coach_recruits_for_team: profile.coach_recruits_for_team } : null)

  useEffect(() => {
    if (!open || !id) return
    let cancelled = false
    readOwnCounts(id, role, recruiter)
      .then((c) => { if (!cancelled) setCounts(c) })
      .catch((err) => { logger.warn('[useAiContextChip] read failed', err) })
    return () => { cancelled = true }
  }, [open, id, role, recruiter])

  if (!id) return null
  return aiContextChip({ role, recruiter, entry, goalLabel: goalChipLabel(role, goal), openOpportunities, ...counts })
}
