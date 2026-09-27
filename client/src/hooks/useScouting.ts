import { useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { useUndoToast } from '@/lib/undoToast'
import { holdDecision } from '@/lib/pendingDecisions'
import { WITHDRAWN_APPLICATION_MESSAGE } from '@/lib/applicationStatus'
import { reportSupabaseError } from '@/lib/sentryHelpers'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { isRecruitingViewer } from '@/lib/recruiterAccess'
import { playingCategoriesForTarget } from '@/lib/recruitingContext'
import { useRecruitingContext } from '@/hooks/useRecruitingContext'
import { useShortlists } from '@/hooks/useShortlists'
import { markSavedProfileId, unmarkSavedProfileId } from '@/hooks/useSavedProfiles'
import { useBlockedUsers } from '@/hooks/useBlockedUsers'
import type { LeagueInput } from '@/lib/keyFacts'
import type { FitState } from '@/lib/clubRecruiting'
import type { Json } from '@/lib/database.types'
import {
  contextFitTarget,
  shortlistForContext,
  type ContextLike,
  type PoolPlayer,
  type ScoutRow,
} from '@/lib/findPlayers'

/**
 * Data behind Find players (D1.9) and the per-role Shortlist (D1.10).
 *
 * Pool = community_search_members (players only; 18+ with a known date of
 * birth, open-to-play first, test accounts per environment — all enforced
 * server-side) narrowed to the categories the active context accepts. Fit =
 * get_club_fit_batch for the active context (compute_club_fit, cached in
 * club_fit_cache). Clubs and recruiting coaches only.
 */

export interface ClubOpenRole {
  id: string
  title: string
  position: string | null
  gender: string | null
  opportunity_type: string | null
}

const CHUNK = 100

function chunks<T>(list: T[], size = CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

const wantsWomen = (category: string | null | undefined) => category === 'adult_women' || category === 'girls'

type LeagueRow = { id: number; name: string; level_band_global: number | null }
type ClubLeagues = { id: string; men_league_id: number | null; women_league_id: number | null }

interface Enrichment {
  fit: Map<string, { state: FitState; score: number }>
  highlights: Map<string, number>
  ages: Map<string, number>
  leagues: Map<string, LeagueInput | null>
  durations: Map<string, string | null>
  applications: Map<string, string>
}

/**
 * Everything a row needs beyond the pool row, batched: fit, ready highlight
 * counts, server ages, the "plays at" league (club league = verified, else
 * the player's own = self-reported; same rule as player_league()), the
 * availability length and the application to the active role.
 */
async function enrich(players: Pick<PoolPlayer, 'id' | 'current_world_club_id' | 'playing_category'>[], ctx: ContextLike | null, roleId: string | null): Promise<Enrichment> {
  const ids = players.map((p) => p.id)
  const out: Enrichment = { fit: new Map(), highlights: new Map(), ages: new Map(), leagues: new Map(), durations: new Map(), applications: new Map() }
  if (!ids.length) return out
  const idChunks = chunks(ids)
  const target = contextFitTarget(ctx)

  const [fitRes, videoRes, ageRes, profRes, appRes] = await Promise.all([
    ctx && target
      ? Promise.all(idChunks.map((c) => supabase.rpc('get_club_fit_batch', { p_player_ids: c, p_context_id: ctx.id })))
      : Promise.resolve([]),
    Promise.all(idChunks.map((c) => supabase.from('player_videos').select('user_id').in('user_id', c).eq('kind', 'highlight').eq('status', 'ready'))),
    Promise.all(idChunks.map((c) => supabase.rpc('get_profile_ages', { p_ids: c }))),
    Promise.all(idChunks.map((c) => supabase.from('profiles').select('id, mens_league_id, womens_league_id, availability_duration').in('id', c))),
    roleId
      ? supabase.from('opportunity_applications').select('id, applicant_id, status').eq('opportunity_id', roleId).neq('status', 'withdrawn')
      : Promise.resolve({ data: [], error: null }),
  ])

  for (const r of fitRes) {
    if (r.error) { reportSupabaseError('useScouting.fit', r.error); continue }
    for (const row of (r.data ?? []) as { player_id: string; state: string; score: number | string }[]) {
      out.fit.set(row.player_id, { state: row.state as FitState, score: Number(row.score) })
    }
  }
  for (const r of videoRes) {
    for (const v of (r.data ?? []) as { user_id: string }[]) out.highlights.set(v.user_id, (out.highlights.get(v.user_id) ?? 0) + 1)
  }
  for (const r of ageRes) {
    for (const a of (r.data ?? []) as { profile_id: string; age: number | null }[]) if (typeof a.age === 'number') out.ages.set(a.profile_id, a.age)
  }
  const own = new Map<string, { men: number | null; women: number | null }>()
  for (const r of profRes) {
    for (const p of (r.data ?? []) as { id: string; mens_league_id: number | null; womens_league_id: number | null; availability_duration: string | null }[]) {
      own.set(p.id, { men: p.mens_league_id, women: p.womens_league_id })
      out.durations.set(p.id, p.availability_duration ?? null)
    }
  }
  for (const a of (appRes.data ?? []) as { id: string; applicant_id: string }[]) out.applications.set(a.applicant_id, a.id)

  // Leagues: the world club's first (verified), else the player's own (self-reported).
  const clubIds = [...new Set(players.map((p) => p.current_world_club_id).filter((x): x is string => !!x))]
  const clubRes = clubIds.length ? await Promise.all(chunks(clubIds).map((c) => supabase.from('world_clubs').select('id, men_league_id, women_league_id').in('id', c))) : []
  const clubs = new Map<string, ClubLeagues>()
  for (const r of clubRes) for (const c of (r.data ?? []) as ClubLeagues[]) clubs.set(c.id, c)
  const pick = (women: boolean, men: number | null | undefined, wom: number | null | undefined) => (women ? wom ?? men : men ?? wom) ?? null
  const choice = new Map<string, { id: number; source: 'club' | 'self_reported' }>()
  for (const p of players) {
    const w = wantsWomen(p.playing_category)
    const c = p.current_world_club_id ? clubs.get(p.current_world_club_id) : undefined
    const clubLeague = c ? pick(w, c.men_league_id, c.women_league_id) : null
    if (clubLeague) { choice.set(p.id, { id: clubLeague, source: 'club' }); continue }
    const o = own.get(p.id)
    const ownLeague = o ? pick(w, o.men, o.women) : null
    if (ownLeague) choice.set(p.id, { id: ownLeague, source: 'self_reported' })
  }
  const leagueIds = [...new Set([...choice.values()].map((c) => c.id))]
  const leagueRes = leagueIds.length ? await supabase.from('world_leagues').select('id, name, level_band_global').in('id', leagueIds) : { data: [] }
  const leagues = new Map<number, LeagueRow>()
  for (const l of (leagueRes.data ?? []) as LeagueRow[]) leagues.set(l.id, l)
  for (const p of players) {
    const c = choice.get(p.id)
    const l = c ? leagues.get(c.id) : undefined
    out.leagues.set(p.id, c && l ? { name: l.name, source: c.source, levelBand: c.source === 'club' ? l.level_band_global : null } : null)
  }
  return out
}

function toRow(p: PoolPlayer, e: Enrichment): ScoutRow {
  const fit = e.fit.get(p.id)
  return {
    ...p,
    fitState: fit?.state ?? null,
    fitScore: fit?.score ?? null,
    highlights: e.highlights.get(p.id) ?? 0,
    age: e.ages.get(p.id) ?? null,
    league: e.leagues.get(p.id) ?? null,
    availabilityDuration: e.durations.get(p.id) ?? null,
    applicationId: e.applications.get(p.id) ?? null,
  }
}

/** The recruiter's open player roles (for the Ranked for sheet) and the active context's role. */
export function useScoutingContext() {
  const viewer = useAuthStore((s) => s.profile)
  const recruits = isRecruitingViewer(viewer)
  const viewerId = viewer?.id ?? null
  const { active, available, loading, activate, clearActive, activateForOpportunity } = useRecruitingContext()
  const { data: openRoles = [] } = useQuery({
    queryKey: ['scouting', 'open-roles', viewerId],
    enabled: recruits && !!viewerId,
    staleTime: 60_000,
    queryFn: async (): Promise<ClubOpenRole[]> => {
      const { data, error } = await supabase
        .from('opportunities')
        .select('id, title, position, gender, opportunity_type')
        .eq('club_id', viewerId as string)
        .eq('status', 'open')
        .eq('opportunity_type', 'player')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as ClubOpenRole[]
    },
  })
  const roleIds = openRoles.map((r) => r.id)
  const { data: pending = [] } = useQuery({
    queryKey: ['scouting', 'to-review', viewerId, roleIds.join(',')],
    enabled: recruits && roleIds.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase.from('opportunity_applications').select('opportunity_id').in('opportunity_id', roleIds).eq('status', 'pending')
      if (error) throw error
      return ((data ?? []) as { opportunity_id: string }[]).map((a) => a.opportunity_id)
    },
  })
  const roles = useMemo(() => {
    const m = new Map<string, { title: string; toReview: number }>()
    for (const r of openRoles) m.set(r.id, { title: r.title, toReview: pending.filter((id) => id === r.id).length })
    return m
  }, [openRoles, pending])
  const ctx = active as ContextLike | null
  const role = ctx?.opportunity_id ? openRoles.find((r) => r.id === ctx.opportunity_id) ?? null : null
  const roleTitle = ctx?.type === 'opportunity' ? role?.title ?? ctx.label ?? null : null
  return { recruits, viewer, ctx, contexts: available as ContextLike[], loading, openRoles, roles, role, roleTitle, activate, clearActive, activateForOpportunity }
}

/** The club's own league for the active target — named in the notice when it has no level. */
export function useOwnLeague(target: 'Men' | 'Women' | 'Mixed' | null) {
  const viewer = useAuthStore((s) => s.profile)
  const clubId = viewer?.current_world_club_id ?? null
  const { data = null } = useQuery({
    queryKey: ['scouting', 'own-league', clubId, target],
    enabled: !!clubId && !!target,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<{ name: string; band: number | null } | null> => {
      const { data: wc } = await supabase.from('world_clubs').select('men_league_id, women_league_id').eq('id', clubId as string).maybeSingle()
      const c = wc as { men_league_id: number | null; women_league_id: number | null } | null
      const id = c ? (target === 'Women' ? c.women_league_id ?? c.men_league_id : c.men_league_id ?? c.women_league_id) : null
      if (!id) return null
      const { data: lg } = await supabase.from('world_leagues').select('name, level_band_global').eq('id', id).maybeSingle()
      const l = lg as { name: string; level_band_global: number | null } | null
      return l ? { name: l.name, band: l.level_band_global } : null
    },
  })
  return data
}

export function useFindPlayers(ctx: ContextLike | null, roleId: string | null) {
  const viewerId = useAuthStore((s) => s.profile?.id ?? null)
  const { blockedIds } = useBlockedUsers()
  const target = contextFitTarget(ctx)
  const query = useQuery({
    queryKey: ['scouting', 'find', viewerId, ctx?.id ?? null, target, roleId],
    enabled: !!viewerId,
    staleTime: 60_000,
    queryFn: async (): Promise<ScoutRow[]> => {
      const { data, error } = await supabase.rpc('community_search_members', {
        p_role: 'player',
        p_categories: target ? [...playingCategoriesForTarget(target)] : undefined,
        p_limit: 500,
      })
      if (error) throw error
      const pool = (((data ?? {}) as unknown as { results?: PoolPlayer[] }).results ?? []).filter((p) => p.id !== viewerId && p.role === 'player')
      const e = await enrich(pool, ctx, roleId)
      return pool.map((p) => toRow(p, e))
    },
  })
  const rows = useMemo(() => (query.data ?? []).filter((r) => !blockedIds.has(r.id)), [query.data, blockedIds])
  return { rows, loading: query.isLoading, error: query.error ? 'Couldn’t load players. Pull to try again.' : null, refetch: query.refetch }
}

// ── Saved membership + per-role shortlist writes ─────────────────────

interface SavedRow { id: string; saved_profile_id: string; shortlist_id: string | null; note: string | null; created_at: string }

export function useSavedMembership() {
  const viewerId = useAuthStore((s) => s.profile?.id ?? null)
  const { data = [], isLoading } = useQuery({
    queryKey: ['scouting', 'saved', viewerId],
    enabled: !!viewerId,
    staleTime: 30_000,
    queryFn: async (): Promise<SavedRow[]> => {
      const { data: rows, error } = await supabase.from('saved_profiles').select('id, saved_profile_id, shortlist_id, note, created_at').eq('owner_id', viewerId as string)
      if (error) throw error
      return (rows ?? []) as SavedRow[]
    },
  })
  return { saved: data, loading: isLoading }
}

/**
 * + / ✓ on Find players: writes to the shortlist of the active role (a list
 * named after the role, created on first use) or, with no role, the default
 * "Saved players" list (upserted on first save). Nothing is sent to the player.
 */
export function useShortlistWrites(roleTitle: string | null) {
  const viewerId = useAuthStore((s) => s.profile?.id ?? null)
  const addToast = useToastStore((s) => s.addToast)
  const queryClient = useQueryClient()
  const { lists, refresh } = useShortlists()
  const { saved } = useSavedMembership()
  const list = shortlistForContext(lists, roleTitle)
  const savedKey = useMemo(() => ['scouting', 'saved', viewerId], [viewerId])

  const ensureList = useCallback(async (): Promise<{ id: string; name: string } | null> => {
    if (list) return list
    if (!viewerId) return null
    const name = roleTitle?.trim() || 'Saved players'
    const isDefault = !roleTitle
    const { data, error } = await supabase.from('shortlists').insert({ owner_id: viewerId, name, is_default: isDefault }).select('id, name').single()
    if (error) {
      // Another tab created it first (one default per owner): use that one.
      const q = supabase.from('shortlists').select('id, name').eq('owner_id', viewerId)
      const { data: again } = await (isDefault ? q.eq('is_default', true) : q.ilike('name', name)).limit(1).maybeSingle()
      if (again) { void refresh(); return again as { id: string; name: string } }
      reportSupabaseError('useShortlistWrites.ensureList', error)
      return null
    }
    trackDbEvent('shortlist.created', 'shortlist', (data as { id: string }).id, { name, source: 'find_players' })
    void refresh()
    return data as { id: string; name: string }
  }, [list, viewerId, roleTitle, refresh])

  const inList = useCallback((playerId: string) => !!list && saved.some((s) => s.saved_profile_id === playerId && s.shortlist_id === list.id), [list, saved])
  const otherListName = useCallback((playerId: string) => {
    const row = saved.find((s) => s.saved_profile_id === playerId)
    if (!row || (list && row.shortlist_id === list.id)) return null
    return lists.find((l) => l.id === row.shortlist_id)?.name ?? 'another'
  }, [saved, list, lists])

  const add = useCallback(async (playerId: string, firstName: string) => {
    if (!viewerId) return
    const other = otherListName(playerId)
    if (other) { addToast(`${firstName} is already on your “${other}” shortlist`, 'info'); return }
    const target = await ensureList()
    if (!target) { addToast('Couldn’t shortlist. Please try again.', 'error'); return }
    const temp: SavedRow = { id: `tmp-${playerId}`, saved_profile_id: playerId, shortlist_id: target.id, note: null, created_at: new Date().toISOString() }
    queryClient.setQueryData<SavedRow[]>(savedKey, (cur = []) => [...cur, temp])
    const { error } = await supabase.from('saved_profiles').insert({ owner_id: viewerId, saved_profile_id: playerId, shortlist_id: target.id })
    if (error && error.code !== '23505') {
      queryClient.setQueryData<SavedRow[]>(savedKey, (cur = []) => cur.filter((s) => s.id !== temp.id))
      reportSupabaseError('useShortlistWrites.add', error)
      addToast('Couldn’t shortlist. Please try again.', 'error')
      return
    }
    markSavedProfileId(viewerId, playerId)
    if (!error) trackDbEvent('shortlist.item_added', 'shortlist', target.id, { player_id: playerId, source: 'find_players' })
    void queryClient.invalidateQueries({ queryKey: savedKey })
    void queryClient.invalidateQueries({ queryKey: ['scouting', 'shortlist'] })
    void refresh()
  }, [viewerId, otherListName, ensureList, queryClient, savedKey, addToast, refresh])

  const remove = useCallback(async (playerId: string) => {
    if (!viewerId || !list) return
    const prev = queryClient.getQueryData<SavedRow[]>(savedKey)
    queryClient.setQueryData<SavedRow[]>(savedKey, (cur = []) => cur.filter((s) => !(s.saved_profile_id === playerId && s.shortlist_id === list.id)))
    const { error } = await supabase.from('saved_profiles').delete().eq('owner_id', viewerId).eq('saved_profile_id', playerId).eq('shortlist_id', list.id)
    if (error) {
      queryClient.setQueryData(savedKey, prev)
      reportSupabaseError('useShortlistWrites.remove', error)
      addToast('Couldn’t remove. Please try again.', 'error')
      return
    }
    unmarkSavedProfileId(viewerId, playerId)
    trackDbEvent('shortlist.item_removed', 'shortlist', list.id, { player_id: playerId, source: 'find_players' })
    void queryClient.invalidateQueries({ queryKey: ['scouting', 'shortlist'] })
    void refresh()
  }, [viewerId, list, queryClient, savedKey, addToast, refresh])

  return { list, inList, add, remove }
}

// ── Shortlist (D1.10) ────────────────────────────────────────────────

export interface ShortlistEntry extends ScoutRow {
  /** saved_profiles row in this role's list (scouted), if any. */
  savedId: string | null
  savedAt: string | null
  note: string | null
  /** Shortlisted application (applicant), if any — applicants win when both. */
  shortlistedApp: { id: string; position: string | null; at: string | null; metadata: Record<string, unknown> } | null
}

const PROFILE_COLS = 'id, full_name, avatar_url, role, position, secondary_position, nationality_country_id, nationality2_country_id, current_club, current_world_club_id, playing_category, open_to_play, available_from, last_active_at, full_game_video_count, career_entry_count'

export function useRoleShortlist(ctx: ContextLike | null, roleId: string | null, roleTitle: string | null) {
  const viewerId = useAuthStore((s) => s.profile?.id ?? null)
  const { lists, loading: listsLoading } = useShortlists()
  const { blockedIds } = useBlockedUsers()
  const list = shortlistForContext(lists, roleTitle)
  const listId = list?.id ?? null
  const ctxId = ctx?.id ?? null
  const queryKey = useMemo(() => ['scouting', 'shortlist', viewerId, listId, roleId, ctxId] as const, [viewerId, listId, roleId, ctxId])
  const query = useQuery({
    queryKey,
    enabled: !!viewerId && !listsLoading,
    staleTime: 30_000,
    queryFn: async (): Promise<ShortlistEntry[]> => {
      const [savedRes, appsRes] = await Promise.all([
        list
          ? supabase.from('saved_profiles').select('id, saved_profile_id, note, created_at').eq('owner_id', viewerId as string).eq('shortlist_id', list.id)
          : Promise.resolve({ data: [], error: null }),
        roleId
          ? supabase.from('opportunity_applications').select('id, applicant_id, updated_at, metadata, opportunity:opportunities!inner(position, club_id)').eq('opportunity_id', roleId).eq('status', 'shortlisted')
          // No role: one list — every applicant shortlisted on this club's roles (DEV NOTE 332:748).
          : supabase.from('opportunity_applications').select('id, applicant_id, updated_at, metadata, opportunity:opportunities!inner(position, club_id)').eq('opportunity.club_id', viewerId as string).eq('status', 'shortlisted'),
      ])
      if (savedRes.error) throw savedRes.error
      if (appsRes.error) throw appsRes.error
      const saved = (savedRes.data ?? []) as { id: string; saved_profile_id: string; note: string | null; created_at: string }[]
      const apps = (appsRes.data ?? []) as unknown as { id: string; applicant_id: string; updated_at: string | null; metadata: unknown; opportunity: { position: string | null } }[]
      const appIds = apps.map((a) => a.id)
      const hist = appIds.length
        ? await supabase.from('application_status_history').select('application_id, created_at').in('application_id', appIds).eq('new_status', 'shortlisted').order('created_at', { ascending: false })
        : { data: [] }
      const shortlistedAt = new Map<string, string>()
      for (const h of (hist.data ?? []) as { application_id: string; created_at: string }[]) if (!shortlistedAt.has(h.application_id)) shortlistedAt.set(h.application_id, h.created_at)

      const ids = [...new Set([...saved.map((s) => s.saved_profile_id), ...apps.map((a) => a.applicant_id)])]
      if (!ids.length) return []
      const profRes = await Promise.all(chunks(ids).map((c) => supabase.from('profiles').select(PROFILE_COLS).in('id', c)))
      const people = profRes.flatMap((r) => (r.data ?? []) as unknown as PoolPlayer[]).filter((p) => p.role === 'player')
      const e = await enrich(people, ctx, null)
      return people
        .map((p): ShortlistEntry => {
          const s = saved.find((x) => x.saved_profile_id === p.id) ?? null
          const a = apps.find((x) => x.applicant_id === p.id) ?? null
          return {
            ...toRow(p, e),
            savedId: s?.id ?? null,
            savedAt: s?.created_at ?? null,
            note: s?.note ?? null,
            shortlistedApp: a
              ? { id: a.id, position: a.opportunity?.position ?? null, at: shortlistedAt.get(a.id) ?? a.updated_at, metadata: a.metadata && typeof a.metadata === 'object' && !Array.isArray(a.metadata) ? (a.metadata as Record<string, unknown>) : {} }
              : null,
          }
        })
        // Club-facing lists are 18+ only: no known age (no date of birth) or under 18 → never shown.
        .filter((r) => typeof r.age === 'number' && r.age >= 18)
    },
  })
  const rows = useMemo(() => (query.data ?? []).filter((r) => !blockedIds.has(r.id)), [query.data, blockedIds])
  return { list, rows, loading: query.isLoading || listsLoading, error: query.error ? 'Couldn’t load the shortlist.' : null, queryKey }
}

/** Remove from the shortlist (DEV NOTE 332:751) and edit the private note. */
export function useShortlistEntryActions(queryKey: readonly unknown[]) {
  const viewerId = useAuthStore((s) => s.profile?.id ?? null)
  const addToast = useToastStore((s) => s.addToast)
  const showUndo = useUndoToast((s) => s.show)
  const queryClient = useQueryClient()
  const patch = useCallback((fn: (rows: ShortlistEntry[]) => ShortlistEntry[]) => {
    queryClient.setQueryData<ShortlistEntry[]>(queryKey, (cur = []) => fn(cur))
  }, [queryClient, queryKey])

  const remove = useCallback(async (entry: ShortlistEntry) => {
    if (!viewerId) return
    const firstName = entry.full_name?.trim().split(/\s+/)[0] || 'Player'
    const before = queryClient.getQueryData<ShortlistEntry[]>(queryKey)
    if (entry.shortlistedApp) {
      // Applicant → back to Maybe, held for the undo window. Never declines silently.
      const app = entry.shortlistedApp
      patch((rows) => rows.filter((r) => r.id !== entry.id))
      holdDecision({ kind: 'status', applicationId: app.id, status: 'maybe', metadata: { ...app.metadata, status_reason: null } as unknown as Json }, (ok, withdrawn) => {
        if (ok) {
          trackDbEvent('applicant_status_change', 'application', app.id, { new_status: 'maybe', reason: null, source: 'shortlist' })
          void queryClient.invalidateQueries({ queryKey: ['scouting'] })
          return
        }
        queryClient.setQueryData(queryKey, before)
        addToast(withdrawn ? WITHDRAWN_APPLICATION_MESSAGE : 'Couldn’t save that change. Please try again.', withdrawn ? 'info' : 'error')
      })
      showUndo({ applicationId: app.id, text: `${firstName} moved to Maybe`, onUndo: () => queryClient.setQueryData(queryKey, before) })
      return
    }
    if (!entry.savedId) return
    patch((rows) => rows.filter((r) => r.id !== entry.id))
    const { error } = await supabase.from('saved_profiles').delete().eq('id', entry.savedId).eq('owner_id', viewerId)
    if (error) {
      queryClient.setQueryData(queryKey, before)
      reportSupabaseError('useShortlistEntryActions.remove', error)
      addToast('Couldn’t remove. Please try again.', 'error')
      return
    }
    unmarkSavedProfileId(viewerId, entry.id)
    trackDbEvent('shortlist.item_removed', 'shortlist_item', entry.savedId, { source: 'shortlist_v2' })
    void queryClient.invalidateQueries({ queryKey: ['scouting', 'saved', viewerId] })
    addToast(`${firstName} removed from the shortlist`, 'success')
  }, [viewerId, queryClient, queryKey, patch, addToast, showUndo])

  const setNote = useCallback(async (entry: ShortlistEntry, note: string | null) => {
    if (!viewerId || !entry.savedId) return
    const before = queryClient.getQueryData<ShortlistEntry[]>(queryKey)
    patch((rows) => rows.map((r) => (r.id === entry.id ? { ...r, note } : r)))
    const { error } = await supabase.from('saved_profiles').update({ note }).eq('id', entry.savedId).eq('owner_id', viewerId)
    if (error) {
      queryClient.setQueryData(queryKey, before)
      reportSupabaseError('useShortlistEntryActions.setNote', error)
      addToast('Couldn’t save the note.', 'error')
      return
    }
    trackDbEvent('shortlist.note_saved', 'shortlist_item', entry.savedId, { has_note: note != null })
    addToast(note == null ? 'Note cleared' : 'Note saved', 'success')
  }, [viewerId, queryClient, queryKey, patch, addToast])

  return { remove, setNote }
}
