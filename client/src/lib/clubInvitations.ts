import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'

/**
 * Squad invitations from the INVITEE's side (Figma D1 DEV NOTE: "invitee
 * accepts in Inbox → Requests"). The club sends one with invite_club_member;
 * the invitee answers with respond_to_club_invite. Both the phone Inbox
 * (Requests + Activity) and the desktop notifications drawer answer through
 * the same store action (useNotificationStore.respondToClubInvite).
 */

export interface MyClubInvitation {
  /** club_members.id — what respond_to_club_invite takes. */
  clubMemberId: string
  createdAt: string
  club: {
    id: string
    fullName: string | null
    username: string | null
    avatarUrl: string | null
    baseLocation: string | null
  }
}

type InvitationRow = {
  id: string
  created_at: string
  club: { id: string; full_name: string | null; username: string | null; avatar_url: string | null; base_location: string | null } | null
}

/**
 * Pending (status 'invited') invitations addressed to the viewer, newest
 * first. RLS on club_members lets the member read their own rows.
 */
export async function fetchMyClubInvitations(viewerId: string): Promise<MyClubInvitation[]> {
  const { data, error } = await supabase
    .from('club_members')
    .select('id, created_at, club:profiles!club_members_club_profile_id_fkey(id, full_name, username, avatar_url, base_location)')
    .eq('member_profile_id', viewerId)
    .eq('status', 'invited')
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) {
    logger.debug('[clubInvitations] pending invitations lookup failed', error)
    throw error
  }
  return ((data ?? []) as unknown as InvitationRow[])
    .filter((row) => row.club)
    .map((row) => ({
      clubMemberId: row.id,
      createdAt: row.created_at,
      club: {
        id: row.club!.id,
        fullName: row.club!.full_name,
        username: row.club!.username,
        avatarUrl: row.club!.avatar_url,
        baseLocation: row.club!.base_location,
      },
    }))
}
