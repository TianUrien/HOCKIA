import { supabase } from '@/lib/supabase'
import { rememberBlockedPair, invalidatePublicProfileCache } from '@/lib/publicProfileCache'
import { notifyBlockListChanged } from '@/hooks/useBlockedUsers'
import { invalidateFriendshipEdges } from '@/hooks/friendshipEdgeCache'

/**
 * Block a member and make it read as immediate everywhere (Apple 1.2): the
 * same follow-up steps ProfileActionMenu runs — remember the pair, bust the
 * cached public profile, re-sync every feed's blocked-id set and the
 * friendship-edge cache (block_user deletes the friendship server-side).
 */
export async function blockMember(viewerId: string, targetId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('block_user', { p_blocked_id: targetId })
  if (error) throw error
  rememberBlockedPair(viewerId, targetId, true)
  invalidatePublicProfileCache({ id: targetId })
  notifyBlockListChanged()
  invalidateFriendshipEdges()
}
