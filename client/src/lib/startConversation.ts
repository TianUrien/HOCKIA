import { supabase } from '@/lib/supabase'

/**
 * Resolve the /messages route for a 1:1 conversation between viewer and target.
 * If a conversation already exists, returns the `?conversation=<id>` route;
 * otherwise the `?new=<targetId>` route (NewMessageModal mode).
 *
 * Mirrors the pattern duplicated across MemberCard, the role dashboards,
 * and the references sections. Extracted so the Community preview modal
 * can reuse the same logic without adding a seventh copy.
 *
 * Throws on supabase error — caller handles the toast.
 */
export async function resolveConversationRoute(
  viewerId: string,
  targetId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from('conversations')
    .select('id')
    .or(
      `and(participant_one_id.eq.${viewerId},participant_two_id.eq.${targetId}),and(participant_one_id.eq.${targetId},participant_two_id.eq.${viewerId})`,
    )
    .maybeSingle()

  if (error) throw error

  return data?.id
    ? `/messages?conversation=${data.id}`
    : `/messages?new=${targetId}`
}
