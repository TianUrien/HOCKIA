import { useCallback, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { reportSupabaseError } from '@/lib/sentryHelpers'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { isRecruitingViewer } from '@/lib/recruiterAccess'
import {
  OPEN_APPLICATION_STATUSES,
  firstNameOf,
  inviteDailyLimit,
  inviteErrorMessage,
  inviteLimitReason,
  isInvitablePlayer,
  respondErrorMessage,
  type InvitePill,
  type InviteRole,
  type InviteStatus,
} from '@/lib/invites'

/**
 * Data for D3 · Invite to apply. The invite table and its two functions
 * (opportunity_invites, send_invite, respond_invite — Track C) are newer
 * than the generated types, so they go through an untyped client here.
 * RLS lets only the publisher and the invited player read an invite.
 */
const db = supabase as unknown as SupabaseClient

export const INVITES_KEY = ['invites'] as const

export interface OpenInvite { id: string; player_id: string; opportunity_id: string; status: InviteStatus; expires_at: string }

/**
 * Club side: for each player, the pill that replaces Invite — "Applied" when
 * they have an open application to any open role of this club, "Invited"
 * when an invite from this club is still open (DEV NOTE 394:98).
 */
export function useClubInviteStatuses(playerIds: string[]) {
  const viewer = useAuthStore((s) => s.profile)
  const viewerId = viewer?.id ?? null
  const enabled = isRecruitingViewer(viewer) && !!viewerId && playerIds.length > 0
  const ids = useMemo(() => [...new Set(playerIds)].sort(), [playerIds])
  // The club's open player roles: a player who passed on every one of them shows "Passed".
  const { roles } = useInviteRoles('player', enabled)
  const query = useQuery({
    queryKey: [...INVITES_KEY, 'statuses', viewerId, ids.join(',')],
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<{ pills: Record<string, InvitePill>; declined: Record<string, string[]> }> => {
      const pills: Record<string, InvitePill> = {}
      const declined: Record<string, string[]> = {}
      const nowIso = new Date().toISOString()
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100)
        const [inv, apps, passed] = await Promise.all([
          db.from('opportunity_invites').select('player_id').eq('club_id', viewerId as string).eq('status', 'sent').gt('expires_at', nowIso).in('player_id', chunk),
          supabase
            .from('opportunity_applications')
            .select('applicant_id, status, opportunity:opportunities!inner(club_id, status)')
            .in('applicant_id', chunk)
            .eq('opportunity.club_id', viewerId as string)
            .eq('opportunity.status', 'open')
            .in('status', [...OPEN_APPLICATION_STATUSES] as never),
          // Roles the player passed on: never invited to those again (send_invite refuses).
          db.from('opportunity_invites')
            .select('player_id, opportunity_id, opportunity:opportunities!inner(status)')
            .eq('club_id', viewerId as string)
            .eq('status', 'declined')
            .eq('opportunity.status', 'open')
            .in('player_id', chunk),
        ])
        if (inv.error) reportSupabaseError('useInvites.statuses.invites', inv.error)
        if (apps.error) reportSupabaseError('useInvites.statuses.applications', apps.error)
        if (passed.error) reportSupabaseError('useInvites.statuses.declined', passed.error)
        for (const r of (inv.data ?? []) as { player_id: string }[]) pills[r.player_id] = 'invited'
        for (const r of (apps.data ?? []) as unknown as { applicant_id: string }[]) pills[r.applicant_id] = 'applied'
        for (const r of (passed.data ?? []) as { player_id: string; opportunity_id: string }[]) {
          declined[r.player_id] = [...new Set([...(declined[r.player_id] ?? []), r.opportunity_id])]
        }
      }
      return { pills, declined }
    },
  })
  const data = query.data
  const declinedFor = useCallback((id: string): string[] => data?.declined[id] ?? [], [data])
  const pillFor = useCallback((id: string): InvitePill | null => {
    const pill = data?.pills[id]
    if (pill) return pill
    const passed = data?.declined[id] ?? []
    return roles.length > 0 && roles.every((r) => passed.includes(r.id)) ? 'passed' : null
  }, [data, roles])
  return { pillFor, declinedFor, loading: query.isLoading }
}

/** Invites this publisher sent in the last 24 hours vs the daily limit (5 in the first week, else 20). */
export function useInviteAllowance() {
  const viewer = useAuthStore((s) => s.profile)
  const viewerId = viewer?.id ?? null
  const limit = inviteDailyLimit(viewer?.created_at ?? null)
  const query = useQuery({
    queryKey: [...INVITES_KEY, 'allowance', viewerId],
    enabled: isRecruitingViewer(viewer) && !!viewerId,
    staleTime: 30_000,
    queryFn: async (): Promise<number> => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const { count, error } = await db.from('opportunity_invites').select('id', { count: 'exact', head: true }).eq('club_id', viewerId as string).gt('sent_at', since)
      if (error) { reportSupabaseError('useInvites.allowance', error); return 0 }
      return count ?? 0
    },
  })
  const sent = query.data ?? 0
  return { limit, sent, reached: sent >= limit }
}

/** The publisher's open roles of one kind, with what the sheet shows (offer line, draft inputs). */
export function useInviteRoles(kind: 'player' | 'coach' = 'player', enabled = true) {
  const viewer = useAuthStore((s) => s.profile)
  const viewerId = viewer?.id ?? null
  const query = useQuery({
    queryKey: [...INVITES_KEY, 'roles', viewerId, kind],
    enabled: enabled && isRecruitingViewer(viewer) && !!viewerId,
    staleTime: 60_000,
    queryFn: async (): Promise<InviteRole[]> => {
      const { data, error } = await supabase
        .from('opportunities')
        .select('id, title, position, gender, compensation, benefits, opportunity_type')
        .eq('club_id', viewerId as string)
        .eq('status', 'open')
        .eq('opportunity_type', kind)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as InviteRole[]
    },
  })
  return { roles: query.data ?? [], loading: query.isLoading }
}

/** send_invite: toast on success, the server's reason on failure (returned for the sheet to show). */
export function useSendInvite() {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)
  const [sending, setSending] = useState(false)
  const send = useCallback(async (opts: { playerId: string; playerName: string | null; opportunityId: string; note: string }): Promise<string | null> => {
    setSending(true)
    try {
      const note = opts.note.trim()
      const { data, error } = await db.rpc('send_invite', { p_player_id: opts.playerId, p_opportunity_id: opts.opportunityId, p_note: note || null })
      if (error) {
        if (!/can.t be invited|already|limit|not open|500 characters/i.test(error.message ?? '')) reportSupabaseError('useInvites.send', error)
        return inviteErrorMessage(error)
      }
      const res = (data ?? {}) as { invite_id?: string }
      trackDbEvent('invite_sent', 'opportunity', opts.opportunityId, { invite_id: res.invite_id ?? null, player_id: opts.playerId })
      addToast(`Invite sent to ${firstNameOf(opts.playerName, 'the player')}`, 'success')
      void queryClient.invalidateQueries({ queryKey: INVITES_KEY })
      return null
    } catch (err) {
      reportSupabaseError('useInvites.send.exception', err)
      return inviteErrorMessage(err)
    } finally {
      setSending(false)
    }
  }, [queryClient, addToast])
  return { send, sending }
}

// ── The invite card in the chat (D3.3) ──

export interface InviteCardData {
  invite: { id: string; status: InviteStatus; note: string | null; expires_at: string; club_id: string; player_id: string; application_id: string | null }
  role: {
    id: string
    title: string
    position: string | null
    gender: string | null
    status: string | null
    start_date: string | null
    duration_text: string | null
    compensation: string | null
    benefits: string[] | null
    opportunity_type: string | null
    club_id: string
  }
  club: { full_name: string | null; avatar_url: string | null; role: string | null; mens_league_division: string | null; womens_league_division: string | null }
  playerName: string | null
}

export function inviteCardKey(inviteId: string) {
  return [...INVITES_KEY, 'card', inviteId] as const
}

export function useInviteCard(inviteId: string | null, opportunityId: string | null) {
  const query = useQuery({
    queryKey: inviteCardKey(inviteId ?? 'none'),
    enabled: !!inviteId && !!opportunityId,
    staleTime: 30_000,
    queryFn: async (): Promise<InviteCardData | null> => {
      const [{ data: inv, error: invErr }, { data: role, error: roleErr }] = await Promise.all([
        db.from('opportunity_invites').select('id, status, note, expires_at, club_id, player_id, application_id').eq('id', inviteId as string).maybeSingle(),
        supabase.from('opportunities').select('id, title, position, gender, status, start_date, duration_text, compensation, benefits, opportunity_type, club_id').eq('id', opportunityId as string).maybeSingle(),
      ])
      if (invErr) reportSupabaseError('useInvites.card.invite', invErr)
      if (roleErr) reportSupabaseError('useInvites.card.role', roleErr)
      if (!inv || !role) return null
      const invite = inv as InviteCardData['invite']
      const [{ data: club }, { data: player }] = await Promise.all([
        supabase.from('profiles').select('full_name, avatar_url, role, mens_league_division, womens_league_division').eq('id', invite.club_id).maybeSingle(),
        supabase.from('profiles').select('full_name').eq('id', invite.player_id).maybeSingle(),
      ])
      return {
        invite,
        role: role as unknown as InviteCardData['role'],
        club: (club ?? { full_name: null, avatar_url: null, role: null, mens_league_division: null, womens_league_division: null }) as InviteCardData['club'],
        playerName: (player as { full_name: string | null } | null)?.full_name ?? null,
      }
    },
  })
  return { data: query.data ?? null, loading: query.isLoading, refetch: query.refetch }
}

/** respond_invite(decline): the player passes on the role; the club is told by the server. */
export function useDeclineInvite() {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)
  const [busy, setBusy] = useState(false)
  const decline = useCallback(async (inviteId: string): Promise<boolean> => {
    setBusy(true)
    try {
      const { error } = await db.rpc('respond_invite', { p_invite_id: inviteId, p_response: 'decline', p_note: null })
      if (error) {
        addToast(respondErrorMessage(error), 'error')
        void queryClient.invalidateQueries({ queryKey: inviteCardKey(inviteId) })
        return false
      }
      queryClient.setQueryData<InviteCardData | null>(inviteCardKey(inviteId), (d) => (d ? { ...d, invite: { ...d.invite, status: 'declined' } } : d))
      trackDbEvent('invite_declined', 'invite', inviteId, {})
      return true
    } finally {
      setBusy(false)
    }
  }, [queryClient, addToast])
  return { decline, busy }
}

/**
 * The profile's club view (D1.16 + DEV NOTE 394:98: "Same button on Player
 * profile — club view, secondary to Shortlist"): whether to show Invite, the
 * status pill instead, and the daily-limit reason. Age comes from
 * get_profile_ages (the server's age; no date of birth → null → no Invite).
 */
export function useProfileInviteAction(player: { id: string; role: string | null; open_to_play?: boolean | null } | null) {
  const viewer = useAuthStore((s) => s.profile)
  const recruits = isRecruitingViewer(viewer) && !!player && player.role === 'player' && viewer?.id !== player.id
  const ids = useMemo(() => (recruits && player ? [player.id] : []), [recruits, player])
  const statuses = useClubInviteStatuses(ids)
  const allowance = useInviteAllowance()
  const { data: age = null } = useQuery({
    queryKey: [...INVITES_KEY, 'age', player?.id ?? null],
    enabled: recruits,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<number | null> => {
      const { data } = await supabase.rpc('get_profile_ages', { p_ids: [player?.id as string] })
      const row = ((data ?? []) as { profile_id: string; age: number | null }[])[0]
      return typeof row?.age === 'number' ? row.age : null
    },
  })
  if (!recruits || !player) return null
  return {
    pill: statuses.pillFor(player.id),
    invitable: isInvitablePlayer({ role: player.role, open_to_play: player.open_to_play ?? null, age }),
    limitReason: allowance.reached ? inviteLimitReason(allowance.limit) : null,
  }
}
