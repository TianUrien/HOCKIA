import { supabase } from '@/lib/supabase'
import { SIGNING_LOCK_STATUSES, WAITING_APPLICATION_STATUSES } from '@/lib/roleLifecycle'

/**
 * How many applications on a role are still waiting on the club (read BEFORE a
 * close, so the toast only says "Applicants have been told." when someone was
 * told). A failed count reads as 0 — the toast then just says what happened.
 */
export async function countWaitingApplicants(roleId: string): Promise<number> {
  const { count, error } = await supabase
    .from('opportunity_applications')
    .select('id', { count: 'exact', head: true })
    .eq('opportunity_id', roleId)
    .in('status', [...WAITING_APPLICATION_STATUSES] as never)
  if (error) return 0
  return count ?? 0
}

/**
 * Which of these roles have a signing (confirmed or waiting for the player), so
 * "Delete permanently" is off for them. The server refuses the delete anyway
 * (BEFORE DELETE trigger); this only keeps the menu honest. A failed read
 * returns an empty set (never blocks the list) — the refusal is then mapped from the delete error.
 */
export async function fetchRolesWithSigning(roleIds: string[]): Promise<Set<string>> {
  if (roleIds.length === 0) return new Set()
  try {
    const { data, error } = await supabase
      .from('opportunity_applications')
      .select('opportunity_id')
      .in('opportunity_id', roleIds)
      .in('status', [...SIGNING_LOCK_STATUSES] as never)
    if (error || !data) return new Set()
    return new Set((data as { opportunity_id: string }[]).map((r) => r.opportunity_id))
  } catch {
    return new Set()
  }
}

/** Waiting applications a close can answer with a note: the ones a club may still
 *  decline (application-feedback refuses offered / accepted — a close as filled
 *  moves those to "Role filled" on the server). Oldest first. */
export const TELLABLE_STATUSES = ['pending', 'shortlisted', 'maybe'] as const

export interface WaitingApplicant { applicationId: string; firstName: string | null }

export async function fetchTellableApplicants(roleId: string): Promise<WaitingApplicant[]> {
  const { data, error } = await supabase
    .from('opportunity_applications')
    .select('id, applied_at, applicant:applicant_id ( full_name )')
    .eq('opportunity_id', roleId)
    .in('status', [...TELLABLE_STATUSES] as never)
    .order('applied_at', { ascending: true })
  if (error || !data) return []
  return (data as unknown as { id: string; applicant: { full_name: string | null } | null }[]).map((r) => ({
    applicationId: r.id,
    firstName: r.applicant?.full_name?.trim().split(/\s+/)[0] || null,
  }))
}

/**
 * Club speed CS6: tell everyone still waiting before a role closes. Each one is
 * declined with the club's note and their own first name — the same write,
 * notification and email as a single decline (application-feedback, no model
 * call). A few at a time; returns how many went out and how many failed.
 */
export async function tellWaitingApplicants(
  rows: WaitingApplicant[],
  reason: string,
  noteFor: (firstName: string | null) => string,
): Promise<{ told: number; failed: number }> {
  let told = 0
  let failed = 0
  const queue = [...rows]
  const worker = async () => {
    for (let r = queue.shift(); r; r = queue.shift()) {
      try {
        const { data, error } = await supabase.functions.invoke('application-feedback', {
          body: { mode: 'decline', application_id: r.applicationId, reason, message: noteFor(r.firstName) },
        })
        if (error || !(data as { ok?: boolean } | null)?.ok) throw error ?? new Error('decline_failed')
        told += 1
      } catch {
        failed += 1
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, rows.length) }, worker))
  return { told, failed }
}
