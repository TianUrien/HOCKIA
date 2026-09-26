import { useCallback, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { logger } from '@/lib/logger'
import { useUndoToast } from '@/lib/undoToast'
import { holdDecision } from '@/lib/pendingDecisions'
import { WITHDRAWN_APPLICATION_MESSAGE } from '@/lib/applicationStatus'
import { useShortlists } from '@/hooks/useShortlists'
import { useRecruitingContext } from '@/hooks/useRecruitingContext'
import { markSavedProfileId, useIsProfileSaved } from '@/hooks/useSavedProfiles'
import { isRecruitingViewer } from '@/lib/recruiterAccess'
import { reportSupabaseError } from '@/lib/sentryHelpers'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { DEFAULT_EXPIRY_DAYS, fitTarget, type FitComponents, type FitState } from '@/lib/clubRecruiting'
import type { Json } from '@/lib/database.types'

/**
 * What a club (or a coach who recruits) sees on top of a player's profile
 * (Figma D2.1 club view 395:83):
 *
 *  - roles: the viewer's open roles of the profile's kind (player / coach);
 *  - application: the player's latest application to one of the viewer's roles
 *    ("Applied to …" card — RLS shows clubs the applications to their roles);
 *  - fitRole + fit: compute_club_fit for the role that matters here — the one
 *    applied to, else the active recruiting context's role, else the only open
 *    role. Club viewers only; hidden when grey (the card handles that);
 *  - shortlist(role): Shortlist per role (founder ruling 2026-09-25 #9). The
 *    player applied to that role → shortlist the application (held for the
 *    undo window like Applicant review); otherwise → the club's list named
 *    after the role. No open roles → the default shortlist toggle.
 *
 * Players never reach this hook: it returns nothing unless the viewer
 * recruits (lib/recruiterAccess).
 */
export interface ClubRole {
  id: string
  title: string
  gender: string | null
}

export interface ClubViewApplication {
  id: string
  status: string
  appliedAt: string | null
  metadata: Record<string, unknown>
  role: ClubRole
  expiryDays: number
}

export interface ClubViewFit {
  state: FitState
  components: FitComponents
  playerLeagueBanded: boolean
  clubLeagueBanded: boolean
}

export interface ClubViewPlayer {
  id: string
  role: string | null
  full_name?: string | null
  current_world_club_id?: string | null
}

export function pickFitRole(opts: { application: ClubViewApplication | null; roles: ClubRole[]; activeOpportunityId: string | null }): ClubRole | null {
  if (opts.application) return opts.application.role
  const active = opts.activeOpportunityId ? opts.roles.find((r) => r.id === opts.activeOpportunityId) : null
  if (active) return active
  return opts.roles.length === 1 ? opts.roles[0] : null
}

export function useClubViewOfPlayer(player: ClubViewPlayer | null) {
  const viewer = useAuthStore((s) => s.profile)
  const addToast = useToastStore((s) => s.addToast)
  const showUndo = useUndoToast((s) => s.show)
  const queryClient = useQueryClient()
  const recruits = isRecruitingViewer(viewer) && !!player && viewer?.id !== player.id
  const isClub = recruits && viewer?.role === 'club'
  const viewerId = viewer?.id ?? null
  const playerId = player?.id ?? null
  const kind = player?.role === 'coach' ? 'coach' : 'player'
  const { active: activeContext } = useRecruitingContext()
  const activeOpportunityId = activeContext?.opportunity_id ?? null
  const { lists, create } = useShortlists()
  const saved = useIsProfileSaved(recruits ? playerId : null)
  const [shortlistedRoleIds, setShortlistedRoleIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const { data: roles = [] } = useQuery({
    queryKey: ['club-view', 'roles', viewerId, kind],
    enabled: recruits,
    staleTime: 60_000,
    queryFn: async (): Promise<ClubRole[]> => {
      const { data, error } = await supabase
        .from('opportunities')
        .select('id, title, gender')
        .eq('club_id', viewerId as string)
        .eq('status', 'open')
        .eq('opportunity_type', kind)
        .order('published_at', { ascending: false })
      if (error) throw error
      return (data ?? []).map((r) => ({ id: r.id, title: r.title, gender: r.gender ?? null }))
    },
  })

  const { data: application = null } = useQuery({
    queryKey: ['club-view', 'application', viewerId, playerId],
    enabled: recruits,
    staleTime: 30_000,
    queryFn: async (): Promise<ClubViewApplication | null> => {
      const [{ data, error }, { data: settings }] = await Promise.all([
        supabase
          .from('opportunity_applications')
          .select('id, status, applied_at, metadata, opportunity:opportunities!inner(id, title, gender, club_id)')
          .eq('applicant_id', playerId as string)
          .eq('opportunity.club_id', viewerId as string)
          .neq('status', 'withdrawn')
          .order('applied_at', { ascending: false })
          .limit(1),
        supabase.from('application_response_settings').select('expiry_days').limit(1).maybeSingle(),
      ])
      if (error) throw error
      const row = (data ?? [])[0] as unknown as { id: string; status: string; applied_at: string | null; metadata: unknown; opportunity: { id: string; title: string; gender: string | null } } | undefined
      if (!row) return null
      return {
        id: row.id,
        status: row.status,
        appliedAt: row.applied_at,
        metadata: row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? (row.metadata as Record<string, unknown>) : {},
        role: { id: row.opportunity.id, title: row.opportunity.title, gender: row.opportunity.gender },
        expiryDays: (settings as { expiry_days?: number } | null)?.expiry_days ?? DEFAULT_EXPIRY_DAYS,
      }
    },
  })

  const fitRole = useMemo(() => pickFitRole({ application, roles, activeOpportunityId }), [application, roles, activeOpportunityId])

  const { data: fit = null } = useQuery({
    queryKey: ['club-view', 'fit', viewerId, playerId, fitRole?.id ?? null],
    enabled: isClub && kind === 'player' && !!fitRole && !!fitTarget(fitRole.gender),
    staleTime: 60_000,
    queryFn: async (): Promise<ClubViewFit | null> => {
      const role = fitRole as ClubRole
      const clubLeagueIds = [viewer?.mens_league_id, viewer?.womens_league_id].filter((x): x is number => typeof x === 'number')
      const [{ data: fitData, error }, wc, clubLeagues] = await Promise.all([
        supabase.rpc('compute_club_fit', { p_owner_id: viewerId as string, p_player_id: playerId as string, p_target: fitTarget(role.gender) as string, p_region: null as unknown as string, p_opportunity_id: role.id }),
        player?.current_world_club_id
          ? supabase.from('world_clubs').select('men_league_id, women_league_id').eq('id', player.current_world_club_id).maybeSingle()
          : Promise.resolve({ data: null }),
        clubLeagueIds.length ? supabase.from('world_leagues').select('level_band_global').in('id', clubLeagueIds) : Promise.resolve({ data: [] }),
      ])
      if (error) throw error
      const row = (fitData as { state: FitState; components: FitComponents }[] | null)?.[0]
      if (!row) return null
      // "Can't compare level" unless the player's CLUB has a banded league —
      // a self-reported league never counts (founder ruling 2026-09-26).
      const w = wc.data as { men_league_id: number | null; women_league_id: number | null } | null
      let playerLeagueBanded = false
      const ids = w ? [w.men_league_id, w.women_league_id].filter((x): x is number => typeof x === 'number') : []
      if (ids.length) {
        const { data: lg } = await supabase.from('world_leagues').select('level_band_global').in('id', ids)
        playerLeagueBanded = ((lg ?? []) as { level_band_global: number | null }[]).some((l) => l.level_band_global !== null)
      }
      return {
        state: row.state,
        components: row.components,
        playerLeagueBanded,
        clubLeagueBanded: ((clubLeagues.data ?? []) as { level_band_global: number | null }[]).some((l) => l.level_band_global !== null),
      }
    },
  })

  const firstName = player?.full_name?.trim().split(/\s+/)[0] || 'This player'

  const shortlistForRole = useCallback(async (role: ClubRole) => {
    if (!viewerId || !playerId) return
    // Applied to this role → shortlist the application itself.
    if (application && application.role.id === role.id) {
      if (application.status === 'shortlisted') { addToast(`${firstName} is already shortlisted for ${role.title}`, 'success'); return }
      const prev = application.status
      const metadata = { ...application.metadata, status_reason: null } as unknown as Json
      const key = ['club-view', 'application', viewerId, playerId]
      queryClient.setQueryData<ClubViewApplication | null>(key, (a) => (a ? { ...a, status: 'shortlisted' } : a))
      holdDecision({ kind: 'status', applicationId: application.id, status: 'shortlisted', metadata }, (ok, withdrawn) => {
        if (ok) { trackDbEvent('applicant_status_change', 'application', application.id, { new_status: 'shortlisted', reason: null }); return }
        queryClient.setQueryData<ClubViewApplication | null>(key, (a) => (a ? { ...a, status: prev } : a))
        addToast(withdrawn ? WITHDRAWN_APPLICATION_MESSAGE : 'Couldn’t save that decision. Please try again.', withdrawn ? 'info' : 'error')
      })
      showUndo({
        applicationId: application.id,
        text: `${firstName} shortlisted`,
        onUndo: () => {
          queryClient.setQueryData<ClubViewApplication | null>(key, (a) => (a ? { ...a, status: prev } : a))
          setShortlistedRoleIds((ids) => ids.filter((id) => id !== role.id))
        },
      })
      setShortlistedRoleIds((ids) => [...ids, role.id])
      return
    }
    // Otherwise the club's list for this role (created on first use).
    setBusy(true)
    try {
      const list = lists.find((l) => l.name.trim().toLowerCase() === role.title.trim().toLowerCase()) ?? (await create(role.title))
      if (!list) return
      const { error } = await supabase.from('saved_profiles').insert({ owner_id: viewerId, saved_profile_id: playerId, shortlist_id: list.id })
      if (error && error.code !== '23505') {
        reportSupabaseError('useClubViewOfPlayer.shortlist', error)
        addToast('Couldn’t shortlist. Please try again.', 'error')
        return
      }
      markSavedProfileId(viewerId, playerId)
      if (!error) trackDbEvent('shortlist.item_added', 'shortlist', list.id, { player_id: playerId, source: 'profile_club_view', opportunity_id: role.id })
      setShortlistedRoleIds((ids) => [...ids, role.id])
      addToast(`${firstName} shortlisted for ${role.title}`, 'success')
    } catch (err) {
      logger.error('[useClubViewOfPlayer] shortlist failed', err)
      addToast('Couldn’t shortlist. Please try again.', 'error')
    } finally {
      setBusy(false)
    }
  }, [viewerId, playerId, application, lists, create, addToast, firstName, queryClient, showUndo])

  /** No role picked and no open roles → the default shortlist. */
  const shortlistDefault = useCallback(async () => { await saved.toggle() }, [saved])

  const shortlisted = roles.length === 0
    ? saved.isSaved
    : roles.length === 1
      ? shortlistedRoleIds.includes(roles[0].id) || (application?.role.id === roles[0].id && application.status === 'shortlisted')
      : false

  return {
    enabled: recruits,
    isClub,
    roles,
    application,
    fitRole,
    fit,
    shortlisted,
    shortlistedRoleIds,
    busy: busy || saved.mutating,
    shortlistForRole,
    shortlistDefault,
  }
}
