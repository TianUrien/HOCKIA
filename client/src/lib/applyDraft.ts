import { supabase, type Vacancy } from '@/lib/supabase'
import { logger } from '@/lib/logger'

/**
 * Hockia AI · "Prepare my application" (handoff A4 → A5). The note comes from
 * the apply-draft edge function (the member's own facts; template when the
 * model can't help); the role is read for the eligibility check. Nothing is
 * sent from here — submitApplication does that, on "Send application".
 */
/** Same labels as the Apply sheet. */
export const AVAILABILITY_LABELS: Record<string, string> = {
  full_season: 'Full season', half_season: 'Half season', short_term: 'Short term', flexible: 'Flexible',
}

export type ApplyDraft =
  | { kind: 'draft'; note: string; byAi: boolean; vacancy: Vacancy }
  | { kind: 'already'; appliedAt: string | null }
  | { kind: 'closed' }
  | { kind: 'error' }

export async function loadApplyDraft(opportunityId: string): Promise<ApplyDraft> {
  try {
    const [{ data: vacancy }, { data, error }] = await Promise.all([
      supabase.from('opportunities').select('*').eq('id', opportunityId).maybeSingle(),
      supabase.functions.invoke('apply-draft', { body: { opportunity_id: opportunityId } }),
    ])
    if (error) {
      const status = (error as { context?: { status?: number } }).context?.status
      return status === 404 ? { kind: 'closed' } : { kind: 'error' }
    }
    const res = data as { note?: string; source?: string; state?: string; applied_at?: string } | null
    if (res?.state === 'already_applied') return { kind: 'already', appliedAt: res.applied_at ?? null }
    if (!vacancy || (vacancy as Vacancy).status !== 'open') return { kind: 'closed' }
    return { kind: 'draft', note: res?.note ?? '', byAi: res?.source === 'ai', vacancy: vacancy as Vacancy }
  } catch (err) {
    logger.error('[applyDraft] load failed', err)
    return { kind: 'error' }
  }
}
