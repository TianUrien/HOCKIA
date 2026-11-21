/**
 * Role outcome: what the recruiter says happened to a role (founder ruling
 * 2026-11-21, docs/product/proposals/recruiter-satisfaction.md, phase 2).
 *
 * Asked when the recruiter closes a role, and for a role that closed on its
 * own through a one-line banner they can answer or close. Closing it asks
 * once more 14 days later and then never again. The answer is private
 * measurement data (table role_outcome_answers, recruiter and admins only):
 * it publishes nothing and notifies nobody. A public signing still goes
 * through the signing flow.
 */
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { trackDbEvent } from '@/lib/trackDbEvent'

export type RoleOutcome = 'filled_hockia' | 'filled_elsewhere' | 'still_looking' | 'stopped_looking' | 'skipped'
export type RoleOutcomeVia = 'close' | 'expiry'

/** The four answers a recruiter can give after a role closed on its own, in the order shown. */
export const EXPIRY_OUTCOMES = ['filled_hockia', 'filled_elsewhere', 'still_looking', 'stopped_looking'] as const

/** A closed question comes back once, this many days later. */
export const REASK_AFTER_DAYS = 14
/** After this many closes the role is never asked about again. */
export const MAX_DISMISSALS = 2

export interface OutcomeApplicant {
  applicationId: string
  name: string
}

export interface RoleToAsk {
  id: string
  closed_reason?: string | null
  closed_at?: string | null
}

/** What is on record for a role: an answer, or how often the question was closed. */
export interface RoleOutcomeState {
  outcome: RoleOutcome
  dismissCount: number
  answeredAt: string
}

/** May this role be asked about now? Never answered, or closed once at least 14 days ago. */
export function canAskAbout(state: RoleOutcomeState | undefined, now = new Date()): boolean {
  if (!state) return true
  if (state.outcome !== 'skipped' || state.dismissCount >= MAX_DISMISSALS) return false
  // Closing the manual close sheet without saying with whom is not a banner dismissal: ask once.
  if (state.dismissCount === 0) return true
  return now.getTime() - new Date(state.answeredAt).getTime() >= REASK_AFTER_DAYS * 86_400_000
}

/**
 * The role to ask about: the most recently closed one that closed on its own
 * ('expired') and can be asked about now. One at a time; null when there is none.
 */
export function nextRoleToAsk<T extends RoleToAsk>(closed: T[], states: ReadonlyMap<string, RoleOutcomeState>, now = new Date()): T | null {
  const waiting = closed.filter((r) => r.closed_reason === 'expired' && canAskAbout(states.get(r.id), now))
  if (waiting.length === 0) return null
  return [...waiting].sort((a, b) => (b.closed_at ?? '').localeCompare(a.closed_at ?? ''))[0]
}

/** The answer a manual close records: Filled asks with whom; Not filled means they stopped looking. */
export function closeOutcome(closed: 'filled' | 'withdrawn', filledWith: 'hockia' | 'elsewhere' | null): RoleOutcome {
  if (closed === 'withdrawn') return 'stopped_looking'
  if (filledWith === 'hockia') return 'filled_hockia'
  if (filledWith === 'elsewhere') return 'filled_elsewhere'
  return 'skipped'
}

/** What this recruiter has on record per role. null = could not tell, so nothing is asked. */
export async function fetchRoleOutcomeStates(recruiterId: string): Promise<Map<string, RoleOutcomeState> | null> {
  try {
    const { data, error } = await supabase.from('role_outcome_answers').select('opportunity_id, outcome, dismiss_count, answered_at').eq('recruiter_id', recruiterId)
    if (error || !data) {
      if (error) logger.debug('[roleOutcome] answers failed', error)
      return null
    }
    return new Map(data.map((r) => [r.opportunity_id, { outcome: r.outcome as RoleOutcome, dismissCount: r.dismiss_count ?? 0, answeredAt: r.answered_at }]))
  } catch {
    return null
  }
}

/** The role's applicants the recruiter can name as the person they signed (hidden profiles drop out, like the applicants list). */
export async function fetchOutcomeApplicants(roleId: string): Promise<OutcomeApplicant[]> {
  try {
    const { data, error } = await supabase
      .from('opportunity_applications')
      .select('id, applicant:applicant_id ( full_name )')
      .eq('opportunity_id', roleId)
      .neq('status', 'withdrawn' as never)
      .order('applied_at', { ascending: true })
    if (error || !data) return []
    return (data as unknown as { id: string; applicant: { full_name: string | null } | null }[])
      .filter((r) => r.applicant?.full_name?.trim())
      .map((r) => ({ applicationId: r.id, name: (r.applicant?.full_name ?? '').trim() }))
      .sort((x, y) => x.name.localeCompare(y.name))
  } catch {
    return []
  }
}

/**
 * Record the answer (one row per role; answering again replaces it). Best
 * effort: a failure never blocks closing a role. Returns whether it was saved.
 * `dismissCount`: how many times the banner has now been closed (0 for a real answer).
 */
export async function saveRoleOutcome(input: { roleId: string; recruiterId: string; outcome: RoleOutcome; via: RoleOutcomeVia; hiredApplicationId?: string | null; dismissCount?: number }): Promise<boolean> {
  const hired = input.outcome === 'filled_hockia' ? input.hiredApplicationId ?? null : null
  const dismissCount = input.outcome === 'skipped' ? Math.min(MAX_DISMISSALS, Math.max(0, input.dismissCount ?? 0)) : 0
  try {
    const { error } = await supabase.from('role_outcome_answers').upsert(
      { opportunity_id: input.roleId, recruiter_id: input.recruiterId, outcome: input.outcome, asked_via: input.via, hired_application_id: hired, dismiss_count: dismissCount, answered_at: new Date().toISOString() },
      { onConflict: 'opportunity_id' },
    )
    if (error) throw error
  } catch (err) {
    logger.error('[roleOutcome] save failed', err)
    return false
  }
  // The person is never in the event: only whether one was named.
  trackDbEvent('role_outcome_answered', 'opportunity', input.roleId, { via: input.via, outcome: input.outcome, named_person: hired !== null, dismiss_count: dismissCount })
  return true
}

/** Recorded when the question is put in front of the recruiter. */
export function trackRoleOutcomeAsked(roleId: string, via: RoleOutcomeVia): void {
  trackDbEvent('role_outcome_asked', 'opportunity', roleId, { via })
}
