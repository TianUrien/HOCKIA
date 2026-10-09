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
