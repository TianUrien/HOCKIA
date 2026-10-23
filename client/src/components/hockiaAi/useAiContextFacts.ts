import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { isRecruiterProfile } from '@/lib/hockiaAi'
import type { AiContextFacts } from '@/lib/hockiaAiContext'
import { useHockiaAiSheet } from './hockiaAiSheetStore'

type Profile = { id: string; role?: string | null; coach_recruits_for_team?: boolean | null } | null

/** One read per role, for the sheet's context chip. A failed read stays null (no count shown). */
async function readFacts(profile: NonNullable<Profile>): Promise<AiContextFacts> {
  if (isRecruiterProfile(profile)) {
    // Same source as Home's roles health; its counts exclude hidden applicants.
    const { data, error } = await supabase.rpc('get_my_roles_health')
    if (error || !Array.isArray(data)) return {}
    const roles = data as unknown as { pending_count?: number }[]
    return { openRoles: roles.length, pendingApplicants: roles.reduce((n, r) => n + (r.pending_count ?? 0), 0) }
  }
  if (profile.role === 'brand') {
    const { data: brand, error } = await supabase.rpc('get_my_brand')
    const brandId = (brand as { id?: string } | null)?.id
    if (error || !brandId) return {}
    const { data: products, error: pErr } = await supabase.rpc('get_brand_products', { p_brand_id: brandId })
    return pErr || !Array.isArray(products) ? {} : { products: products.length }
  }
  if (profile.role === 'umpire') {
    const { count, error } = await supabase.from('umpire_appointments').select('id', { count: 'exact', head: true }).eq('user_id', profile.id)
    return error || count === null ? {} : { appointments: count }
  }
  return {}
}

/**
 * Facts for the Hockia AI context chip, read when the sheet opens. The
 * candidate coach's open count comes from the Opportunities list itself
 * (pageFacts), so the chip always matches what the coach sees there.
 */
export function useAiContextFacts(open: boolean): AiContextFacts {
  const profile = useAuthStore((s) => s.profile) as Profile
  const pageFacts = useHockiaAiSheet((s) => s.pageFacts)
  const [facts, setFacts] = useState<AiContextFacts>({})
  const id = profile?.id ?? null
  const role = profile?.role ?? null
  const recruits = profile?.coach_recruits_for_team ?? null

  useEffect(() => {
    if (!open || !id) return
    let cancelled = false
    readFacts({ id, role, coach_recruits_for_team: recruits })
      .then((f) => { if (!cancelled) setFacts(f) })
      .catch((err) => { logger.warn('[useAiContextFacts] read failed', err) })
    return () => { cancelled = true }
  }, [open, id, role, recruits])

  return { ...facts, ...pageFacts }
}
