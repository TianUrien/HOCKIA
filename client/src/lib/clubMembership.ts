import { supabase } from '@/lib/supabase'
import { getShareOrigin } from '@/lib/profileShare'

/** Shared result shape for the club-membership RPCs (all return jsonb). */
type RpcResult<T = Record<string, unknown>> = { success: boolean; error?: string } & T

export interface ClubInvitation {
  club_member_id: string
  member_profile_id: string
  full_name: string | null
  avatar_url: string | null
  role: string
  position: string | null
  base_location: string | null
  invited_via: 'direct' | 'link'
  created_at: string
}

export interface MemberSearchResult {
  id: string
  full_name: string | null
  avatar_url: string | null
  role: 'player' | 'coach'
  position: string | null
  base_location: string | null
  current_club: string | null
}

/** Build the shareable URL for a club invite token. */
export function buildClubInviteUrl(token: string): string {
  return `${getShareOrigin()}/invite/club/${token}`
}

export async function inviteClubMember(memberProfileId: string): Promise<RpcResult<{ id?: string }>> {
  const { data, error } = await supabase.rpc('invite_club_member', { p_member_profile_id: memberProfileId })
  if (error) return { success: false, error: error.message }
  return data as unknown as RpcResult<{ id?: string }>
}

export async function removeClubMember(memberProfileId: string): Promise<RpcResult> {
  const { data, error } = await supabase.rpc('remove_club_member', { p_member_profile_id: memberProfileId })
  if (error) return { success: false, error: error.message }
  return data as unknown as RpcResult
}

export async function createClubInviteLink(): Promise<RpcResult<{ token?: string; id?: string }>> {
  const { data, error } = await supabase.rpc('create_club_invite_link')
  if (error) return { success: false, error: error.message }
  return data as unknown as RpcResult<{ token?: string; id?: string }>
}

export async function revokeClubInviteLink(): Promise<RpcResult> {
  const { data, error } = await supabase.rpc('revoke_club_invite_link')
  if (error) return { success: false, error: error.message }
  return data as unknown as RpcResult
}

export async function getClubInvitations(clubProfileId: string): Promise<ClubInvitation[]> {
  const { data, error } = await supabase.rpc('get_club_invitations', { p_club_profile_id: clubProfileId })
  if (error) return []
  const result = data as unknown as RpcResult<{ invitations?: ClubInvitation[] }>
  return result.success ? (result.invitations ?? []) : []
}

/** Search onboarded players & coaches by name to invite (mirrors NewMessageModal). */
export async function searchInvitableMembers(query: string): Promise<MemberSearchResult[]> {
  const trimmed = query.trim()
  if (trimmed.length < 2) return []
  const pattern = `%${trimmed}%`
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, avatar_url, role, position, base_location, current_club')
    .in('role', ['player', 'coach'])
    .eq('onboarding_completed', true)
    .ilike('full_name', pattern)
    .order('full_name', { ascending: true })
    .limit(12)
  if (error || !data) return []
  return data as MemberSearchResult[]
}
