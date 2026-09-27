import { useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { reportSupabaseError } from '@/lib/sentryHelpers'
import { getEnvironment } from '@/lib/appVersion'
import { qk } from '@/lib/queryKeys'
import {
  createClubInviteLink,
  getClubInvitations,
  inviteClubMember,
  removeClubMember,
  revokeClubInviteLink,
} from '@/lib/clubMembership'
import { isInvitable, type SquadPerson } from '@/lib/clubSquad'

/**
 * Data behind Squad — own (Figma 04 Club D1.15, DEV NOTE 338:702).
 *
 *  - Members = get_club_members(me): active club_members + players/coaches
 *    whose current_world_club_id is the club's world club. Never age-filtered
 *    (it is the club's own squad).
 *  - Pending = get_club_invitations(me): club_members rows still `invited`.
 *    Shown grey — the club waits on the invitee (founder ruling 2026-09-26).
 *  - Invite link = club_invite_links (owner-readable) for join_count; the
 *    link itself is created on first Share / Copy (create_club_invite_link),
 *    revoked with revoke_club_invite_link.
 *  - Search → invite_club_member; the invitee answers in Inbox → Requests
 *    (respond_to_club_invite).
 *
 * D4 hook (not built): when a signing is confirmed by both sides
 * (career_history.signed_via_hockia), the server adds the player to
 * club_members as `active`. get_club_members already returns active rows, so
 * this screen shows them with no client change — invalidate
 * qk.clubSquadMembers from wherever D4 confirms the signing.
 */

export interface SquadMember extends SquadPerson {
  is_roster_member: boolean
  is_test_account: boolean
}

export interface SquadInvitation extends SquadPerson {
  club_member_id: string
  invited_via: 'direct' | 'link'
  created_at: string
}

export interface InviteSearchResult extends SquadPerson {
  current_club: string | null
}

export interface InviteLink {
  id: string
  token: string
  join_count: number
}

const MEMBER_LIMIT = 500

type SpecRow = { id: string; coach_specialization: string | null; coach_specialization_custom: string | null }

/** Coach specialty is not on get_club_members / get_club_invitations; fetch it for coaches only. */
async function coachSpecs(ids: string[]): Promise<Map<string, SpecRow>> {
  const out = new Map<string, SpecRow>()
  if (ids.length === 0) return out
  const { data, error } = await supabase
    .from('profiles')
    .select('id, coach_specialization, coach_specialization_custom')
    .in('id', ids)
  if (error) {
    logger.debug('[useClubSquad] coach specialty lookup failed', error)
    return out
  }
  for (const r of (data ?? []) as SpecRow[]) out.set(r.id, r)
  return out
}

/** Staging and test accounts see test members; everyone else does not (same as the v1 Members tab). */
function useShowTestAccounts(): boolean {
  const isTest = useAuthStore((s) => s.profile?.is_test_account ?? false)
  return isTest || getEnvironment() === 'staging'
}

export function useClubSquad(clubId: string | null) {
  const queryClient = useQueryClient()
  const showTest = useShowTestAccounts()

  const membersQuery = useQuery({
    queryKey: qk.clubSquadMembers(clubId),
    enabled: Boolean(clubId),
    staleTime: 30_000,
    queryFn: async (): Promise<SquadMember[]> => {
      const { data, error } = await supabase.rpc('get_club_members', { p_profile_id: clubId!, p_limit: MEMBER_LIMIT, p_offset: 0 })
      if (error) {
        reportSupabaseError('club_squad.members', error, { clubId }, { feature: 'club_squad', operation: 'fetch_members' })
        throw error
      }
      const rows = data ?? []
      const specs = await coachSpecs(rows.filter((r) => r.role === 'coach').map((r) => r.id))
      return rows.map((r) => ({
        id: r.id,
        full_name: r.full_name,
        avatar_url: r.avatar_url,
        role: r.role,
        position: r.position,
        secondary_position: r.secondary_position,
        coach_specialization: specs.get(r.id)?.coach_specialization ?? null,
        coach_specialization_custom: specs.get(r.id)?.coach_specialization_custom ?? null,
        is_roster_member: Boolean(r.is_roster_member),
        is_test_account: Boolean(r.is_test_account),
      }))
    },
  })

  const pendingQuery = useQuery({
    queryKey: qk.clubSquadPending(clubId),
    enabled: Boolean(clubId),
    staleTime: 30_000,
    queryFn: async (): Promise<SquadInvitation[]> => {
      const rows = await getClubInvitations(clubId!)
      const specs = await coachSpecs(rows.filter((r) => r.role === 'coach').map((r) => r.member_profile_id))
      return rows.map((r) => ({
        id: r.member_profile_id,
        club_member_id: r.club_member_id,
        full_name: r.full_name,
        avatar_url: r.avatar_url,
        role: r.role,
        position: r.position,
        secondary_position: null,
        coach_specialization: specs.get(r.member_profile_id)?.coach_specialization ?? null,
        coach_specialization_custom: specs.get(r.member_profile_id)?.coach_specialization_custom ?? null,
        invited_via: r.invited_via,
        created_at: r.created_at,
      }))
    },
  })

  const linkQuery = useQuery({
    queryKey: qk.clubInviteLink(clubId),
    enabled: Boolean(clubId),
    staleTime: 30_000,
    queryFn: async (): Promise<InviteLink | null> => {
      const { data, error } = await supabase
        .from('club_invite_links')
        .select('id, token, join_count, expires_at')
        .eq('club_profile_id', clubId!)
        .is('revoked_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      if (!data) return null
      if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) return null
      return { id: data.id, token: data.token, join_count: data.join_count ?? 0 }
    },
  })

  const members = useMemo(
    () => (membersQuery.data ?? []).filter((m) => showTest || !m.is_test_account),
    [membersQuery.data, showTest],
  )
  const pending = pendingQuery.data ?? []

  const refreshRoster = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: qk.clubSquadMembers(clubId) })
    void queryClient.invalidateQueries({ queryKey: qk.clubSquadPending(clubId) })
    void queryClient.invalidateQueries({ queryKey: qk.clubMemberCount(clubId) })
  }, [queryClient, clubId])

  /** Get-or-create the invite link (Share / Copy). Returns the token or an error. */
  const ensureLink = useCallback(async (): Promise<{ token: string } | { error: string }> => {
    const current = linkQuery.data
    if (current) return { token: current.token }
    const res = await createClubInviteLink()
    if (!res.success || !res.token) return { error: res.error ?? 'Could not create the invite link.' }
    queryClient.setQueryData<InviteLink | null>(qk.clubInviteLink(clubId), { id: res.id ?? '', token: res.token, join_count: 0 })
    return { token: res.token }
  }, [linkQuery.data, queryClient, clubId])

  const revokeLink = useCallback(async (): Promise<boolean> => {
    const res = await revokeClubInviteLink()
    if (!res.success) return false
    queryClient.setQueryData<InviteLink | null>(qk.clubInviteLink(clubId), null)
    return true
  }, [queryClient, clubId])

  const invite = useCallback(async (personId: string) => {
    const res = await inviteClubMember(personId)
    if (res.success) void queryClient.invalidateQueries({ queryKey: qk.clubSquadPending(clubId) })
    return res
  }, [queryClient, clubId])

  /** Removes an active roster member, or cancels a pending invitation. */
  const remove = useCallback(async (personId: string) => {
    const res = await removeClubMember(personId)
    if (res.success) refreshRoster()
    return res
  }, [refreshRoster])

  return {
    members,
    pending,
    link: linkQuery.data ?? null,
    loading: membersQuery.isLoading || pendingQuery.isLoading,
    error: membersQuery.error ? 'Couldn’t load your squad. Please try again.' : null,
    retry: () => { void membersQuery.refetch(); void pendingQuery.refetch() },
    ensureLink,
    revokeLink,
    invite,
    remove,
  }
}

/** "Invite someone on Hockia": onboarded players (18+ by DOB) and coaches by name, never blocked or hidden. */
export function useInviteSearch(clubId: string | null, query: string, blockedIds: ReadonlySet<string>) {
  const showTest = useShowTestAccounts()
  const q = query.trim()
  const enabled = Boolean(clubId) && q.length >= 2
  const result = useQuery({
    queryKey: qk.clubInviteSearch(clubId, q.toLowerCase()),
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<InviteSearchResult[]> => {
      let req = supabase
        .from('profiles')
        .select('id, full_name, avatar_url, role, position, secondary_position, coach_specialization, coach_specialization_custom, current_club, date_of_birth, is_test_account')
        .in('role', ['player', 'coach'])
        .eq('onboarding_completed', true)
        .eq('is_blocked', false)
        .is('frozen_minor_at', null)
        .ilike('full_name', `%${q.replace(/[%_]/g, '')}%`)
        .order('full_name', { ascending: true })
        .limit(30)
      if (!showTest) req = req.eq('is_test_account', false)
      const { data, error } = await req
      if (error) throw error
      return ((data ?? []) as Array<InviteSearchResult & { date_of_birth: string | null }>)
        .filter((p) => p.id !== clubId && isInvitable(p.role, p.date_of_birth))
        .map(({ date_of_birth: _dob, ...p }) => { void _dob; return p })
    },
  })
  const rows = useMemo(() => (result.data ?? []).filter((r) => !blockedIds.has(r.id)), [result.data, blockedIds])
  return { rows, searching: enabled && result.isFetching, error: result.error ? 'Search failed. Please try again.' : null, active: enabled }
}
