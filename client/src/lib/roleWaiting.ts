import { supabase } from '@/lib/supabase'
import { WAITING_APPLICATION_STATUSES } from '@/lib/roleLifecycle'

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
